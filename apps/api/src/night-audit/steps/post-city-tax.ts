import { Logger } from '@nestjs/common';
import { FolioStatus, NightAuditStep, Prisma, ReservationStatus, TaxCategory } from '@pms/db';
import { computeCityTax } from '../../folio/tax-calculator';
import type { StepContext, StepResult, StepRunner } from '../step';

const log = new Logger('PostCityTaxStep');

/**
 * RFC-001 §3.3 — postea una entrada CITY_TAX por reserva CHECKED_IN
 * para el business date, según la regla CityTaxRule de la property.
 *
 * Funciona "por noche":
 *   - amount = ruleAmountPerNight × chargeablePax (TaxCalculator).
 *   - chargeablePax = adultos (si appliesToAdults) + niños cobrables.
 *     children edad >= rule.childAgeThreshold cuando appliesToChildren.
 *   - cap: se cuenta cuántas entradas previas con
 *     idempotencyKey LIKE 'na:city-tax:%:<reservationId>' existen.
 *     Si >= rule.maxNights (cuando > 0), se skipea.
 *
 * Sin children detail por reserva (sólo `children: int`), asumimos
 * todos > threshold (V1). Cuando exista cardex con edades reales se
 * sustituye.
 *
 * Idempotency: na:city-tax:<businessDate>:<reservationId>.
 */
export class PostCityTaxStep implements StepRunner {
  readonly step = NightAuditStep.POST_CITY_TAX;

  async run(ctx: StepContext): Promise<StepResult> {
    const rule = await ctx.tx.cityTaxRule.findUnique({
      where: { propertyId: ctx.propertyId },
    });
    if (!rule || rule.amountPerNight.isZero()) {
      log.log(`property=${ctx.propertyId} no city tax rule active — skipped all`);
      return { result: { posted: 0, skipped: 0, reason: 'no_rule' } };
    }

    const reservations = await ctx.tx.reservation.findMany({
      where: {
        propertyId: ctx.propertyId,
        deletedAt: null,
        status: { in: [ReservationStatus.CHECKED_IN] },
        arrivalDate: { lte: ctx.businessDateAsDate },
        departureDate: { gt: ctx.businessDateAsDate },
      },
      select: {
        id: true,
        currency: true,
        adults: true,
        children: true,
        folio: { select: { id: true, status: true } },
      },
    });

    let posted = 0;
    let skippedCap = 0;
    let skippedNoFolio = 0;
    let amountTotal = new Prisma.Decimal(0);

    for (const r of reservations) {
      if (!r.folio || r.folio.status !== FolioStatus.OPEN) {
        skippedNoFolio += 1;
        continue;
      }

      // Cuenta noches previas de city tax cargadas a esta reserva. La
      // regla devuelve maxNights=0 cuando "sin cap" (raro) — saltamos
      // el check en ese caso.
      if (rule.maxNights > 0) {
        const prior = await ctx.tx.folioEntry.count({
          where: {
            folioId: r.folio.id,
            taxCategory: TaxCategory.CITY_TAX,
            idempotencyKey: {
              startsWith: 'na:city-tax:',
              endsWith: `:${r.id}`,
            },
          },
        });
        if (prior >= rule.maxNights) {
          skippedCap += 1;
          continue;
        }
      }

      const childrenAges: { age: number }[] = Array.from({ length: r.children }, () => ({
        age: rule.childAgeThreshold,
      }));
      const calc = computeCityTax({
        rule: {
          amountPerNight: rule.amountPerNight,
          appliesToAdults: rule.appliesToAdults,
          appliesToChildren: rule.appliesToChildren,
          childAgeThreshold: rule.childAgeThreshold,
          maxNights: rule.maxNights,
        },
        adults: r.adults,
        children: childrenAges,
        nights: 1,
      });

      if (calc.perNight.isZero()) {
        // pax cobrable = 0 (p.ej. familia con sólo niños y rule
        // appliesToChildren=false).
        continue;
      }

      const idempotencyKey = `na:city-tax:${ctx.businessDate}:${r.id}`;
      try {
        await ctx.tx.folioEntry.create({
          data: {
            tenantId: ctx.user.tenantId,
            folioId: r.folio.id,
            type: 'CHARGE',
            description: `City tax ${ctx.businessDate} (${calc.chargeablePax} pax)`,
            amount: calc.perNight,
            netAmount: calc.perNight,
            taxRate: new Prisma.Decimal(0),
            taxAmount: new Prisma.Decimal(0),
            taxCategory: TaxCategory.CITY_TAX,
            currency: r.currency,
            postedBy: ctx.user.sub,
            idempotencyKey,
            attributes: {
              chargeablePax: calc.chargeablePax,
              region: rule.region,
            },
          },
        });
        await ctx.tx.folio.update({
          where: { id: r.folio.id },
          data: { balance: { increment: calc.perNight } },
        });
        posted += 1;
        amountTotal = amountTotal.plus(calc.perNight);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Duplicate idempotency — esta noche ya estaba posteada.
          continue;
        }
        throw err;
      }
    }

    log.log(
      `posted=${posted} skipped_cap=${skippedCap} skipped_no_folio=${skippedNoFolio} ` +
        `total=${amountTotal.toString()}`,
    );

    return {
      result: {
        posted,
        skippedCap,
        skippedNoFolio,
        amountTotal: amountTotal.toString(),
      },
      totals: {
        cityTaxPosted: posted,
        cityTaxAmount: amountTotal.toString(),
      },
    };
  }
}
