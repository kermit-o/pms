import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  type AddFolioChargeInput,
  type AssignRoomInput,
  type CheckInInput,
  type CheckOutInput,
  type CreateReservationInput,
  type CreateReservationGroupInput,
  type ForecastDemandInput,
  type FoToolName,
  type GenerateReportInput,
  type QueryAvailabilityInput,
  type ListRoomTypesInput,
  type RecallGuestHistoryInput,
  type SearchAvailabilityByTypeInput,
  foToolCatalog,
} from '@pms/mcp-tools';
import type { AuthUser } from '../auth';
import { FolioService } from '../folio';
import { MemoryService } from './memory/memory.service';
import { ForecastService } from '../night-audit/forecast.service';
import { ReportsService } from '../reports';
import { ReservationsService } from '../reservations';
import { RoomsService } from '../rooms';

/**
 * Maps FO tool calls to existing domain services.
 *
 * Each method:
 *  - Re-validates input against the tool's Zod schema (defence in depth: the
 *    LLM may produce odd shapes).
 *  - Forwards `tenantId` from the human's JWT — the LLM cannot fabricate it.
 *  - Goes through the same service that REST handlers use, so RLS + audit +
 *    event publishing are identical.
 *
 * Permission gating mirrors the REST routes:
 *  - read-only tools (`mutating: false`) auto-execute.
 *  - mutating tools require human confirmation (handled by CopilotService).
 *  - financial tools (`financial: true`) additionally must NOT execute
 *    without an explicit "approve" decision.
 */
@Injectable()
export class FoToolRouter {
  private readonly log = new Logger(FoToolRouter.name);

  constructor(
    private readonly reservations: ReservationsService,
    private readonly rooms: RoomsService,
    private readonly folio: FolioService,
    private readonly reports: ReportsService,
    private readonly forecast: ForecastService,
    private readonly memory: MemoryService,
  ) {}

  isMutating(name: FoToolName): boolean {
    return foToolCatalog[name].mutating;
  }

  isFinancial(name: FoToolName): boolean {
    return foToolCatalog[name].financial;
  }

  async execute(
    name: FoToolName,
    rawInput: unknown,
    user: AuthUser,
    correlationId: string,
  ): Promise<unknown> {
    const meta = foToolCatalog[name];
    if (!meta) {
      throw new ForbiddenException(`Unknown tool: ${name}`);
    }
    const input = meta.inputSchema.parse(rawInput);

    switch (name) {
      case 'query_availability': {
        const i = input as QueryAvailabilityInput;
        return this.rooms.availability(user, correlationId, i);
      }
      case 'list_room_types': {
        const i = input as ListRoomTypesInput;
        return this.rooms.listRoomTypes(user, correlationId, i.propertyId);
      }
      case 'search_availability_by_type': {
        const i = input as SearchAvailabilityByTypeInput;
        return this.rooms.searchAvailabilityByType(user, correlationId, i);
      }
      case 'create_reservation': {
        const i = input as CreateReservationInput;
        const guest = i.guest;
        return this.reservations.create(user, correlationId, {
          propertyId: i.propertyId,
          arrival: i.arrival,
          departure: i.departure,
          roomTypeId: i.roomTypeId,
          ratePlanId: i.ratePlanId,
          occupancy: i.occupancy,
          notes: i.notes,
          currency: 'EUR',
          walkIn: false,
          ...('guestId' in guest
            ? { guestId: guest.guestId }
            : {
                guestData: {
                  firstName: guest.firstName,
                  lastName: guest.lastName,
                  email: guest.email,
                  phone: guest.phone,
                  nationality: guest.nationality,
                },
              }),
        });
      }
      case 'create_reservation_group': {
        const i = input as CreateReservationGroupInput;
        return this.reservations.createGroup(user, correlationId, {
          propertyId: i.propertyId,
          name: i.name,
          code: i.code,
          organizerName: i.organizerName,
          organizerEmail: i.organizerEmail,
          organizerPhone: i.organizerPhone,
          notes: i.notes,
          reservations: i.reservations.map((r) => {
            const guest = r.guest;
            return {
              arrival: r.arrival,
              departure: r.departure,
              roomTypeId: r.roomTypeId,
              ratePlanId: r.ratePlanId,
              occupancy: r.occupancy,
              notes: r.notes,
              currency: 'EUR',
              walkIn: false,
              ...('guestId' in guest
                ? { guestId: guest.guestId }
                : {
                    guestData: {
                      firstName: guest.firstName,
                      lastName: guest.lastName,
                      email: guest.email,
                      phone: guest.phone,
                      nationality: guest.nationality,
                    },
                  }),
            };
          }),
        });
      }
      case 'check_in': {
        const i = input as CheckInInput;
        return this.reservations.checkIn(user, correlationId, i.reservationId, {
          roomId: i.roomId,
        });
      }
      case 'check_out': {
        const i = input as CheckOutInput;
        return this.reservations.checkOut(user, correlationId, i.reservationId, {
          settle: i.settle,
        });
      }
      case 'add_folio_charge': {
        const i = input as AddFolioChargeInput;
        return this.folio.addCharge(user, correlationId, i.folioId, {
          description: i.description,
          amount: i.amount,
          type: i.type,
          idempotencyKey: i.idempotencyKey,
        });
      }
      case 'assign_room': {
        const i = input as AssignRoomInput;
        return this.reservations.assignRoom(user, correlationId, i.reservationId, {
          roomId: i.roomId,
        });
      }
      case 'generate_report': {
        const i = input as GenerateReportInput;
        const manager = await this.reports.manager(user, correlationId, {
          propertyId: i.propertyId,
          businessDate: i.businessDate,
        });
        const summary = renderNarrative(i.businessDate, i.focus, manager);
        return { focus: i.focus, manager, summary };
      }
      case 'forecast_demand': {
        const i = input as ForecastDemandInput;
        return this.forecast.forecast(user, correlationId, {
          propertyId: i.propertyId,
          horizon: i.horizon,
          metric: i.metric,
        });
      }
      case 'recall_guest_history': {
        const i = input as RecallGuestHistoryInput;
        return this.memory.recall(user, correlationId, {
          guestId: i.guestId,
          query: i.query,
          limit: i.limit,
        });
      }
    }
  }
}

/**
 * Tiny deterministic narrative built from the Manager Report. Real LLM
 * narratives ship behind the same contract once the Anthropic adapter is
 * wired in (ADR-020); the read-only nature stays the same.
 */
function renderNarrative(
  businessDate: string,
  focus: GenerateReportInput['focus'],
  m: Awaited<ReturnType<ReportsService['manager']>>,
): string {
  const occ = `${Math.round(m.occupancyPct * 1000) / 10}%`;
  const head = `Día ${businessDate}: ${m.inHouse}/${m.totalRooms} habitaciones ocupadas (${occ}).`;

  switch (focus) {
    case 'revenue':
      return `${head} Cargos posteados: ${m.charges.count} entradas por un total de ${m.charges.totalAmount} EUR. ADR ${m.adr} EUR · RevPAR ${m.revpar} EUR.`;
    case 'occupancy':
      return `${head} Llegadas: ${m.arrivals}. Salidas: ${m.departures}. Cancelaciones del día: ${m.cancellationsToday}.`;
    case 'incidents':
      return `${head} Cancelaciones: ${m.cancellationsToday}. (Detalles operacionales en logs y audit_log.)`;
    case 'overview':
    default:
      return `${head} Llegadas: ${m.arrivals}, salidas: ${m.departures}. ADR ${m.adr} EUR · RevPAR ${m.revpar} EUR.`;
  }
}
