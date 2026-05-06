import { ConflictException, NotFoundException } from '@nestjs/common';
import { SesSubmissionStatus } from '@pms/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../auth';
import { SesHospedajesService } from './ses-hospedajes.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';
const SUBMISSION_ID = '44444444-4444-4444-4444-444444444444';

const user: AuthUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  email: 'auditor@hotel.test',
  roles: ['night_auditor'],
};

const sampleProperty = { id: PROPERTY_ID, code: 'BCN', name: 'Hotel BCN' };

const sampleReservations = [
  {
    arrivalDate: new Date('2026-06-09'),
    departureDate: new Date('2026-06-12'),
    guests: [
      {
        guest: {
          firstName: 'Ana',
          lastName: 'García',
          dateOfBirth: new Date('1990-05-01'),
          documentType: 'DNI',
          documentNumber: '12345678Z',
          nationality: 'ES',
        },
      },
    ],
  },
];

interface SubmissionRow {
  id: string;
  propertyId: string;
  businessDate: Date;
  status: SesSubmissionStatus;
  retryCount: number;
  xmlPayload: string | null;
  submittedAt: Date | null;
  lastError: string | null;
  nextAttemptAt: Date | null;
  responseCode: number | null;
  responseBody: string | null;
}

function buildService(opts: {
  property?: typeof sampleProperty | null;
  existingSubmission?: SubmissionRow | null;
  endpoint?: string;
}) {
  const propertyFindFirst = vi.fn().mockResolvedValue(opts.property ?? null);
  const reservationFindMany = vi.fn().mockResolvedValue(sampleReservations);
  const submissionFindFirst = vi.fn().mockResolvedValue(opts.existingSubmission ?? null);
  const submissionCreate = vi.fn().mockResolvedValue({ id: SUBMISSION_ID });
  const submissionUpdate = vi.fn().mockResolvedValue({});
  const submissionFindMany = vi.fn().mockResolvedValue([]);

  const tx = {
    property: { findFirst: propertyFindFirst },
    reservation: { findMany: reservationFindMany },
    sesHospedajesSubmission: {
      findFirst: submissionFindFirst,
      findMany: submissionFindMany,
      create: submissionCreate,
      update: submissionUpdate,
    },
  };
  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const events = { publish: vi.fn().mockResolvedValue({ id: 'evt' }) };
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'SES_HOSPEDAJES_ENDPOINT') return opts.endpoint;
      return undefined;
    }),
  };

  const service = new SesHospedajesService(prisma as never, events as never, config as never);
  return { service, tx, events };
}

describe('SesHospedajesService.queue', () => {
  it('builds XML, persists submission and emits ses_submission_queued', async () => {
    const { service, tx, events } = buildService({ property: sampleProperty });
    const out = await service.queue(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
    });
    expect(out.guestCount).toBe(1);
    expect(out.xmlPayload).toContain('<comunicacion');
    expect(out.xmlPayload).toContain('<numeroDocumento>12345678Z</numeroDocumento>');
    expect(tx.sesHospedajesSubmission.create).toHaveBeenCalledOnce();
    expect(events.publish.mock.calls[0]![0]).toBe('compliance.ses_submission_queued');
  });

  it('reuses existing FAILED submission and resets retry counter', async () => {
    const { service, tx } = buildService({
      property: sampleProperty,
      existingSubmission: {
        id: SUBMISSION_ID,
        propertyId: PROPERTY_ID,
        businessDate: new Date('2026-06-10'),
        status: SesSubmissionStatus.FAILED,
        retryCount: 3,
        xmlPayload: 'old',
        submittedAt: null,
        lastError: 'previous',
        nextAttemptAt: null,
        responseCode: 500,
        responseBody: null,
      },
    });
    await service.queue(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
    });
    expect(tx.sesHospedajesSubmission.update).toHaveBeenCalledOnce();
    const data = tx.sesHospedajesSubmission.update.mock.calls[0]![0].data;
    expect(data.status).toBe(SesSubmissionStatus.QUEUED);
    expect(data.retryCount).toBe(0);
    expect(data.lastError).toBeNull();
  });

  it('rejects re-queue of an already-SENT submission', async () => {
    const { service } = buildService({
      property: sampleProperty,
      existingSubmission: {
        id: SUBMISSION_ID,
        propertyId: PROPERTY_ID,
        businessDate: new Date('2026-06-10'),
        status: SesSubmissionStatus.SENT,
        retryCount: 0,
        xmlPayload: 'x',
        submittedAt: new Date(),
        lastError: null,
        nextAttemptAt: null,
        responseCode: 200,
        responseBody: null,
      },
    });
    await expect(
      service.queue(user, 'corr', {
        propertyId: PROPERTY_ID,
        businessDate: '2026-06-10',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException when property is missing', async () => {
    const { service } = buildService({ property: null });
    await expect(
      service.queue(user, 'corr', {
        propertyId: PROPERTY_ID,
        businessDate: '2026-06-10',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SesHospedajesService.send', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function existing(overrides: Partial<SubmissionRow> = {}): SubmissionRow {
    return {
      id: SUBMISSION_ID,
      propertyId: PROPERTY_ID,
      businessDate: new Date('2026-06-10'),
      status: SesSubmissionStatus.QUEUED,
      retryCount: 0,
      xmlPayload: '<comunicacion/>',
      submittedAt: null,
      lastError: null,
      nextAttemptAt: null,
      responseCode: null,
      responseBody: null,
      ...overrides,
    };
  }

  it('marks SENT in dev mode (no endpoint configured)', async () => {
    const { service, tx, events } = buildService({
      existingSubmission: existing(),
    });
    const out = await service.send(user, 'corr', SUBMISSION_ID);
    expect(out.status).toBe(SesSubmissionStatus.SENT);
    const data = tx.sesHospedajesSubmission.update.mock.calls[0]![0].data;
    expect(data.status).toBe(SesSubmissionStatus.SENT);
    expect(data.responseCode).toBe(200);
    expect(events.publish.mock.calls[0]![0]).toBe('compliance.ses_submission_sent');
  });

  it('marks SENT when endpoint returns 200', async () => {
    const { service } = buildService({
      existingSubmission: existing(),
      endpoint: 'https://ses.test/api',
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ack',
    });
    const out = await service.send(user, 'corr', SUBMISSION_ID);
    expect(out.status).toBe(SesSubmissionStatus.SENT);
  });

  it('marks FAILED with retry when endpoint returns 503', async () => {
    const { service, tx, events } = buildService({
      existingSubmission: existing(),
      endpoint: 'https://ses.test/api',
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'busy',
    });
    const out = await service.send(user, 'corr', SUBMISSION_ID);
    expect(out.status).toBe(SesSubmissionStatus.FAILED);
    const data = tx.sesHospedajesSubmission.update.mock.calls[0]![0].data;
    expect(data.retryCount).toBe(1);
    expect(data.nextAttemptAt).toBeInstanceOf(Date);
    expect(events.publish.mock.calls[0]![0]).toBe('compliance.ses_submission_failed');
    const payload = events.publish.mock.calls[0]![2] as { deadLetter: boolean };
    expect(payload.deadLetter).toBe(false);
  });

  it('moves to DEAD_LETTER after exhausting retries', async () => {
    const { service, tx, events } = buildService({
      existingSubmission: existing({ retryCount: 4 }),
      endpoint: 'https://ses.test/api',
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'error',
    });
    const out = await service.send(user, 'corr', SUBMISSION_ID);
    expect(out.status).toBe(SesSubmissionStatus.DEAD_LETTER);
    const data = tx.sesHospedajesSubmission.update.mock.calls[0]![0].data;
    expect(data.status).toBe(SesSubmissionStatus.DEAD_LETTER);
    expect(data.nextAttemptAt).toBeNull();
    const payload = events.publish.mock.calls[0]![2] as { deadLetter: boolean };
    expect(payload.deadLetter).toBe(true);
  });

  it('returns SENT idempotently on already-sent submission', async () => {
    const { service, tx } = buildService({
      existingSubmission: existing({ status: SesSubmissionStatus.SENT }),
    });
    const out = await service.send(user, 'corr', SUBMISSION_ID);
    expect(out.status).toBe(SesSubmissionStatus.SENT);
    expect(tx.sesHospedajesSubmission.update).not.toHaveBeenCalled();
  });

  it('rejects send on DEAD_LETTER submission', async () => {
    const { service } = buildService({
      existingSubmission: existing({ status: SesSubmissionStatus.DEAD_LETTER }),
    });
    await expect(service.send(user, 'corr', SUBMISSION_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
