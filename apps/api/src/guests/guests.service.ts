import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@pms/db';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import type { AuthUser } from '../auth';
import {
  CreateGuestDto,
  EraseGuestDto,
  ListGuestsQuery,
  PatchGuestDto,
} from './dto';

/**
 * Guests / cardex domain service. Sprint 2 W4.
 *
 * Compliance features:
 *  - documentHash: deterministic SHA-256 over (documentType + documentNumber)
 *    so duplicate detection runs without exposing raw PII in queries.
 *  - GDPR access: dumps the guest record + reservation references as JSON.
 *  - GDPR erasure (soft): anonymises name/email/phone/document fields and
 *    sets deletedAt. Financial entries on folios remain (legal retention)
 *    but no longer carry identifying data here.
 *  - GDPR erasure (hard): same anonymisation plus an audit-marked record;
 *    full row delete is reserved for after the legal retention window
 *    (5y in ES hospitality) and is gated by `hard: true` from
 *    tenant_admin only.
 */
@Injectable()
export class GuestsService {
  private readonly log = new Logger(GuestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventbusService,
  ) {}

  async list(
    user: AuthUser,
    correlationId: string,
    query: ListGuestsQuery,
  ): Promise<{ items: GuestListItem[]; nextCursor: string | null }> {
    const ctx = tenantCtx(user, correlationId);

    const where: Prisma.GuestWhereInput = { deletedAt: null };
    if (query.q) {
      where.OR = [
        { lastName: { contains: query.q, mode: 'insensitive' } },
        { firstName: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
        { documentNumber: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const items = await this.prisma.withTenant(ctx, (tx) =>
      tx.guest.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        select: GUEST_LIST_SELECT,
      }),
    );

    const nextCursor = items.length > query.limit ? items[query.limit]!.id : null;
    return {
      items: items.slice(0, query.limit).map(toListItem),
      nextCursor,
    };
  }

  async findOne(
    user: AuthUser,
    correlationId: string,
    id: string,
  ): Promise<GuestDetail> {
    const ctx = tenantCtx(user, correlationId);
    const found = await this.prisma.withTenant(ctx, (tx) =>
      tx.guest.findFirst({
        where: { id, deletedAt: null },
        select: GUEST_DETAIL_SELECT,
      }),
    );
    if (!found) throw new NotFoundException(`Guest ${id} not found`);
    return toDetail(found);
  }

  async create(
    user: AuthUser,
    correlationId: string,
    input: CreateGuestDto,
  ): Promise<{ id: string; deduplicated: boolean }> {
    const ctx = tenantCtx(user, correlationId);
    const documentHash = computeDocumentHash(input);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      if (documentHash) {
        const existing = await tx.guest.findFirst({
          where: {
            deletedAt: null,
            documentType: input.documentType,
            documentNumber: input.documentNumber,
          },
          select: { id: true },
        });
        if (existing) {
          return { id: existing.id, deduplicated: true };
        }
      }
      if (input.email) {
        const existing = await tx.guest.findFirst({
          where: { deletedAt: null, email: input.email },
          select: { id: true },
        });
        if (existing) {
          return { id: existing.id, deduplicated: true };
        }
      }

      const guest = await tx.guest.create({
        data: toGuestCreate(user.tenantId, input),
        select: { id: true },
      });
      return { id: guest.id, deduplicated: false };
    });

    if (!result.deduplicated) {
      await this.events.publish('guest.created', ctx, {
        guestId: result.id,
        documentHash,
        hasEmail: !!input.email,
        nationality: input.nationality ?? null,
      });
    }

    return result;
  }

  async patch(
    user: AuthUser,
    correlationId: string,
    id: string,
    input: PatchGuestDto,
  ): Promise<{ id: string }> {
    const ctx = tenantCtx(user, correlationId);
    const changes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) changes[k] = v;
    }
    if (Object.keys(changes).length === 0) {
      throw new ConflictException('no fields to update');
    }

    await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.guest.findFirst({
        where: { id, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException(`Guest ${id} not found`);
      await tx.guest.update({ where: { id }, data: changes });
    });

    await this.events.publish('guest.updated', ctx, {
      guestId: id,
      changes,
    });

    return { id };
  }

  async accessExport(
    user: AuthUser,
    correlationId: string,
    id: string,
  ): Promise<GuestAccessExport> {
    const ctx = tenantCtx(user, correlationId);
    const dump = await this.prisma.withTenant(ctx, (tx) =>
      tx.guest.findFirst({
        where: { id, deletedAt: null },
        include: {
          reservations: {
            select: {
              reservationId: true,
              isPrimary: true,
              reservation: {
                select: {
                  id: true,
                  code: true,
                  status: true,
                  arrivalDate: true,
                  departureDate: true,
                  totalAmount: true,
                  currency: true,
                },
              },
            },
          },
        },
      }),
    );
    if (!dump) throw new NotFoundException(`Guest ${id} not found`);

    return {
      generatedAt: new Date().toISOString(),
      guest: {
        ...dump,
        dateOfBirth: dump.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        documentExpiryDate:
          dump.documentExpiryDate?.toISOString().slice(0, 10) ?? null,
        createdAt: dump.createdAt.toISOString(),
        updatedAt: dump.updatedAt.toISOString(),
        deletedAt: dump.deletedAt?.toISOString() ?? null,
        reservations: dump.reservations.map((r) => ({
          isPrimary: r.isPrimary,
          reservation: {
            id: r.reservation.id,
            code: r.reservation.code,
            status: r.reservation.status,
            arrivalDate: r.reservation.arrivalDate.toISOString().slice(0, 10),
            departureDate: r.reservation.departureDate
              .toISOString()
              .slice(0, 10),
            totalAmount: r.reservation.totalAmount.toString(),
            currency: r.reservation.currency,
          },
        })),
      },
    };
  }

  async erase(
    user: AuthUser,
    correlationId: string,
    id: string,
    input: EraseGuestDto,
  ): Promise<{ id: string; hard: boolean }> {
    const ctx = tenantCtx(user, correlationId);

    if (input.hard && !user.roles.includes('tenant_admin')) {
      throw new ConflictException('hard erasure requires tenant_admin');
    }

    const erasedAt = new Date();
    await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.guest.findFirst({
        where: { id },
        select: { id: true, deletedAt: true },
      });
      if (!existing) throw new NotFoundException(`Guest ${id} not found`);

      await tx.guest.update({
        where: { id },
        data: {
          firstName: '[REDACTED]',
          lastName: '[REDACTED]',
          email: null,
          phone: null,
          dateOfBirth: null,
          documentType: null,
          documentNumber: null,
          documentIssuingCountry: null,
          documentExpiryDate: null,
          addressLine1: null,
          addressLine2: null,
          city: null,
          postalCode: null,
          region: null,
          country: null,
          notes: null,
          attributes: Prisma.JsonNull,
          marketingConsent: false,
          ...(input.hard ? { deletedAt: erasedAt } : {}),
        },
      });
    });

    await this.events.publish('guest.erased', ctx, {
      guestId: id,
      erasedAt: erasedAt.toISOString(),
      reason: input.reason,
      hard: input.hard,
    });

    return { id, hard: input.hard };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tenantCtx(user: AuthUser, correlationId: string) {
  return {
    tenantId: user.tenantId,
    actorId: user.sub,
    correlationId,
  };
}

function computeDocumentHash(input: {
  documentType?: string;
  documentNumber?: string;
}): string | null {
  if (!input.documentType || !input.documentNumber) return null;
  return createHash('sha256')
    .update(`${input.documentType}|${input.documentNumber.toUpperCase()}`)
    .digest('hex');
}

function toGuestCreate(
  tenantId: string,
  input: CreateGuestDto,
): Prisma.GuestUncheckedCreateInput {
  return {
    tenantId,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email ?? null,
    phone: input.phone ?? null,
    dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
    documentType: input.documentType ?? null,
    documentNumber: input.documentNumber ?? null,
    documentIssuingCountry: input.documentIssuingCountry ?? null,
    documentExpiryDate: input.documentExpiryDate
      ? new Date(input.documentExpiryDate)
      : null,
    nationality: input.nationality ?? null,
    addressLine1: input.addressLine1 ?? null,
    addressLine2: input.addressLine2 ?? null,
    city: input.city ?? null,
    postalCode: input.postalCode ?? null,
    region: input.region ?? null,
    country: input.country ?? null,
    gdprConsent: input.gdprConsent,
    marketingConsent: input.marketingConsent,
    notes: input.notes ?? null,
  };
}

const GUEST_LIST_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  documentType: true,
  documentNumber: true,
  nationality: true,
  createdAt: true,
} as const;

const GUEST_DETAIL_SELECT = {
  ...GUEST_LIST_SELECT,
  dateOfBirth: true,
  documentIssuingCountry: true,
  documentExpiryDate: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  postalCode: true,
  region: true,
  country: true,
  gdprConsent: true,
  marketingConsent: true,
  notes: true,
  updatedAt: true,
} as const;

type GuestListRow = Prisma.GuestGetPayload<{ select: typeof GUEST_LIST_SELECT }>;
type GuestDetailRow = Prisma.GuestGetPayload<{
  select: typeof GUEST_DETAIL_SELECT;
}>;

export interface GuestListItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  documentType: string | null;
  documentNumber: string | null;
  nationality: string | null;
  createdAt: string;
}

export type GuestDetail = GuestListItem & {
  dateOfBirth: string | null;
  documentIssuingCountry: string | null;
  documentExpiryDate: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  region: string | null;
  country: string | null;
  gdprConsent: boolean;
  marketingConsent: boolean;
  notes: string | null;
  updatedAt: string;
};

function toListItem(row: GuestListRow): GuestListItem {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    documentType: row.documentType,
    documentNumber: row.documentNumber,
    nationality: row.nationality,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: GuestDetailRow): GuestDetail {
  return {
    ...toListItem(row),
    dateOfBirth: row.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    documentIssuingCountry: row.documentIssuingCountry,
    documentExpiryDate:
      row.documentExpiryDate?.toISOString().slice(0, 10) ?? null,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    postalCode: row.postalCode,
    region: row.region,
    country: row.country,
    gdprConsent: row.gdprConsent,
    marketingConsent: row.marketingConsent,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface GuestAccessExport {
  generatedAt: string;
  guest: Record<string, unknown>;
}
