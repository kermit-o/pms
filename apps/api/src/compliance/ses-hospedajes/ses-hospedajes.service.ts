import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  Prisma,
  ReservationStatus,
  SesSubmissionStatus,
} from '@pms/db';
import { PrismaService } from '../../db';
import { EventbusService } from '../../eventbus';
import type { AuthUser } from '../../auth';
import type { Env } from '../../config/env.schema';
import {
  ListSubmissionsQuery,
  QueueSubmissionDto,
} from './dto';
import { buildSesXml, type SesGuestRecord } from './xml-builder';

const RETRY_DELAYS_MIN = [1, 5, 30, 240, 1440]; // 1m, 5m, 30m, 4h, 24h
const MAX_RETRIES = RETRY_DELAYS_MIN.length;

@Injectable()
export class SesHospedajesService {
  private readonly log = new Logger(SesHospedajesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventbusService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async list(
    user: AuthUser,
    correlationId: string,
    query: ListSubmissionsQuery,
  ): Promise<SesSubmissionDto[]> {
    const ctx = tenantCtx(user, correlationId);
    const where: Prisma.SesHospedajesSubmissionWhereInput = {};
    if (query.propertyId) where.propertyId = query.propertyId;
    if (query.status)
      where.status =
        SesSubmissionStatus[query.status as keyof typeof SesSubmissionStatus];
    if (query.from || query.to) {
      where.businessDate = {};
      if (query.from)
        (where.businessDate as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to)
        (where.businessDate as Prisma.DateTimeFilter).lte = new Date(query.to);
    }

    const rows = await this.prisma.withTenant(ctx, (tx) =>
      tx.sesHospedajesSubmission.findMany({
        where,
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        take: query.limit,
      }),
    );
    return rows.map(toDto);
  }

  async findOne(
    user: AuthUser,
    correlationId: string,
    id: string,
  ): Promise<SesSubmissionDetail> {
    const ctx = tenantCtx(user, correlationId);
    const row = await this.prisma.withTenant(ctx, (tx) =>
      tx.sesHospedajesSubmission.findFirst({ where: { id } }),
    );
    if (!row) throw new NotFoundException(`Submission ${id} not found`);
    return toDetail(row);
  }

  /**
   * Queues (or reuses) a submission for (property, businessDate).
   *
   * Idempotent on (property, businessDate) — calling twice with the same key
   * returns the same row. Re-queuing a FAILED row resets its retry counter.
   */
  async queue(
    user: AuthUser,
    correlationId: string,
    input: QueueSubmissionDto,
  ): Promise<{ submissionId: string; xmlPayload: string; guestCount: number }> {
    const ctx = tenantCtx(user, correlationId);
    const businessDate = new Date(input.businessDate);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: input.propertyId, deletedAt: null },
        select: { id: true, code: true, name: true },
      });
      if (!property) {
        throw new NotFoundException(`Property ${input.propertyId} not found`);
      }

      const guests = await loadGuestsForDate(
        tx,
        input.propertyId,
        businessDate,
      );

      const xml = buildSesXml({
        businessDate: input.businessDate,
        establishment: {
          code: property.code,
          name: property.name,
          cif: null,
          address: null,
          city: null,
          postalCode: null,
        },
        guests,
      });
      const signature = createHash('sha256').update(xml).digest('hex');

      const existing = await tx.sesHospedajesSubmission.findFirst({
        where: {
          propertyId: input.propertyId,
          businessDate,
        },
      });

      let submissionId: string;
      if (existing) {
        if (existing.status === SesSubmissionStatus.SENT) {
          throw new ConflictException(
            `Submission for ${input.businessDate} is already SENT`,
          );
        }
        await tx.sesHospedajesSubmission.update({
          where: { id: existing.id },
          data: {
            status: SesSubmissionStatus.QUEUED,
            xmlPayload: xml,
            xmlSignature: signature,
            retryCount: 0,
            lastError: null,
            nextAttemptAt: null,
          },
        });
        submissionId = existing.id;
      } else {
        const created = await tx.sesHospedajesSubmission.create({
          data: {
            tenantId: user.tenantId,
            propertyId: input.propertyId,
            businessDate,
            status: SesSubmissionStatus.QUEUED,
            xmlPayload: xml,
            xmlSignature: signature,
          },
          select: { id: true },
        });
        submissionId = created.id;
      }

      return { submissionId, xml, guestCount: guests.length };
    });

    await this.events.publish('compliance.ses_submission_queued', ctx, {
      submissionId: result.submissionId,
      propertyId: input.propertyId,
      businessDate: input.businessDate,
      guestCount: result.guestCount,
    });

    return {
      submissionId: result.submissionId,
      xmlPayload: result.xml,
      guestCount: result.guestCount,
    };
  }

  /**
   * Sends the XML to the configured SES endpoint.
   *
   * If `SES_HOSPEDAJES_ENDPOINT` is unset (e.g. dev / test), the call is a
   * no-op that marks the row as SENT with response_code = 200 — handy for
   * local development and integration tests, while keeping the production
   * code path identical.
   */
  async send(
    user: AuthUser,
    correlationId: string,
    submissionId: string,
  ): Promise<{ submissionId: string; status: SesSubmissionStatus }> {
    const ctx = tenantCtx(user, correlationId);
    const endpoint = this.config.get('SES_HOSPEDAJES_ENDPOINT', { infer: true });
    const apiKey = this.config.get('SES_HOSPEDAJES_API_KEY', { infer: true });

    const submission = await this.prisma.withTenant(ctx, (tx) =>
      tx.sesHospedajesSubmission.findFirst({ where: { id: submissionId } }),
    );
    if (!submission) {
      throw new NotFoundException(`Submission ${submissionId} not found`);
    }
    if (submission.status === SesSubmissionStatus.SENT) {
      return { submissionId, status: SesSubmissionStatus.SENT };
    }
    if (submission.status === SesSubmissionStatus.DEAD_LETTER) {
      throw new ConflictException(
        `Submission ${submissionId} is in DEAD_LETTER`,
      );
    }
    if (!submission.xmlPayload) {
      throw new ConflictException(
        `Submission ${submissionId} has no XML payload`,
      );
    }

    let responseCode: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;
    try {
      if (!endpoint) {
        responseCode = 200;
        responseBody = 'no-endpoint-configured (dev mode)';
      } else {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/xml',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: submission.xmlPayload,
        });
        responseCode = res.status;
        responseBody = (await res.text()).slice(0, 4000);
        if (!res.ok) {
          error = `HTTP ${res.status}: ${responseBody}`;
        }
      }
    } catch (err) {
      error = (err as Error).message;
    }

    if (!error) {
      const submittedAt = new Date();
      await this.prisma.withTenant(ctx, (tx) =>
        tx.sesHospedajesSubmission.update({
          where: { id: submissionId },
          data: {
            status: SesSubmissionStatus.SENT,
            submittedAt,
            responseCode,
            responseBody,
            lastError: null,
            nextAttemptAt: null,
          },
        }),
      );
      await this.events.publish('compliance.ses_submission_sent', ctx, {
        submissionId,
        propertyId: submission.propertyId,
        businessDate: submission.businessDate.toISOString().slice(0, 10),
        responseCode: responseCode ?? 200,
        submittedAt: submittedAt.toISOString(),
      });
      return { submissionId, status: SesSubmissionStatus.SENT };
    }

    const retryCount = submission.retryCount + 1;
    const dead = retryCount >= MAX_RETRIES;
    const nextAttemptAt = dead
      ? null
      : new Date(Date.now() + RETRY_DELAYS_MIN[retryCount]! * 60_000);

    await this.prisma.withTenant(ctx, (tx) =>
      tx.sesHospedajesSubmission.update({
        where: { id: submissionId },
        data: {
          status: dead
            ? SesSubmissionStatus.DEAD_LETTER
            : SesSubmissionStatus.FAILED,
          retryCount,
          lastError: error,
          responseCode,
          responseBody,
          nextAttemptAt,
        },
      }),
    );
    await this.events.publish('compliance.ses_submission_failed', ctx, {
      submissionId,
      propertyId: submission.propertyId,
      businessDate: submission.businessDate.toISOString().slice(0, 10),
      retryCount,
      error,
      deadLetter: dead,
    });

    return {
      submissionId,
      status: dead
        ? SesSubmissionStatus.DEAD_LETTER
        : SesSubmissionStatus.FAILED,
    };
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

async function loadGuestsForDate(
  tx: Prisma.TransactionClient,
  propertyId: string,
  businessDate: Date,
): Promise<SesGuestRecord[]> {
  const reservations = await tx.reservation.findMany({
    where: {
      propertyId,
      deletedAt: null,
      status: {
        in: [ReservationStatus.CHECKED_IN, ReservationStatus.CHECKED_OUT],
      },
      arrivalDate: { lte: businessDate },
      departureDate: { gt: businessDate },
    },
    select: {
      arrivalDate: true,
      departureDate: true,
      guests: {
        where: { isPrimary: true },
        select: {
          guest: {
            select: {
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              documentType: true,
              documentNumber: true,
              nationality: true,
            },
          },
        },
      },
    },
  });

  const records: SesGuestRecord[] = [];
  for (const r of reservations) {
    for (const link of r.guests) {
      const g = link.guest;
      records.push({
        documentType: g.documentType ?? null,
        documentNumber: g.documentNumber ?? null,
        firstName: g.firstName,
        lastName: g.lastName,
        birthDate: g.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        nationality: g.nationality,
        arrivalDate: r.arrivalDate.toISOString().slice(0, 10),
        departureDate: r.departureDate.toISOString().slice(0, 10),
      });
    }
  }
  return records;
}

export interface SesSubmissionDto {
  id: string;
  propertyId: string;
  businessDate: string;
  status: SesSubmissionStatus;
  submittedAt: string | null;
  retryCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SesSubmissionDetail = SesSubmissionDto & {
  xmlPayload: string | null;
  xmlSignature: string | null;
  responseCode: number | null;
  responseBody: string | null;
};

function toDto(row: {
  id: string;
  propertyId: string;
  businessDate: Date;
  status: SesSubmissionStatus;
  submittedAt: Date | null;
  retryCount: number;
  lastError: string | null;
  nextAttemptAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): SesSubmissionDto {
  return {
    id: row.id,
    propertyId: row.propertyId,
    businessDate: row.businessDate.toISOString().slice(0, 10),
    status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    retryCount: row.retryCount,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: {
  id: string;
  propertyId: string;
  businessDate: Date;
  status: SesSubmissionStatus;
  submittedAt: Date | null;
  retryCount: number;
  lastError: string | null;
  nextAttemptAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  xmlPayload: string | null;
  xmlSignature: string | null;
  responseCode: number | null;
  responseBody: string | null;
}): SesSubmissionDetail {
  return {
    ...toDto(row),
    xmlPayload: row.xmlPayload,
    xmlSignature: row.xmlSignature,
    responseCode: row.responseCode,
    responseBody: row.responseBody,
  };
}
