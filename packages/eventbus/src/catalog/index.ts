import type { z } from 'zod';
import { businessDayClosedV1, businessDayReopenedV1 } from './business-day';
import { cashReconciliationCreatedV1, cashReconciliationDiscrepancyV1 } from './cash';
import { sesSubmissionFailedV1, sesSubmissionQueuedV1, sesSubmissionSentV1 } from './compliance';
import {
  housekeepingTaskAssignedV1,
  housekeepingTaskCancelledV1,
  housekeepingTaskCompletedV1,
  housekeepingTaskStartedV1,
} from './housekeeping';
import {
  nightAuditRunCompletedV1,
  nightAuditRunStartedV1,
  nightAuditStepCompletedV1,
  nightAuditStepFailedV1,
} from './night-audit';
import {
  folioChargeAddedV1,
  folioClosedV1,
  folioPaymentReceivedV1,
  folioReopenedV1,
} from './folio';
import { guestCreatedV1, guestErasedV1, guestMergedV1, guestUpdatedV1 } from './guest';
import { propertyCreatedV1, propertyUpdatedV1 } from './property';
import { roomStatusChangedV1 } from './room';
import {
  reservationCancelledV1,
  reservationCheckedInV1,
  reservationCheckedOutV1,
  reservationCreatedV1,
  reservationGroupCreatedV1,
  reservationNoShowV1,
  reservationRoomAssignedV1,
  reservationUpdatedV1,
} from './reservation';

/**
 * Catalogo central de eventos del PMS.
 *
 * Reglas:
 *  - Cada entrada es un evento del dominio. La key es el tipo (subject sufix).
 *  - schema valida el payload con Zod antes de publicar.
 *  - schemaVersion arranca en 1 e incrementa cuando hay breaking change en el
 *    payload. Crear un nuevo entry (p.ej. property.created v2) NO romper el v1.
 */
export const catalog = {
  'property.created': { schema: propertyCreatedV1, schemaVersion: 1 },
  'property.updated': { schema: propertyUpdatedV1, schemaVersion: 1 },
  'reservation.created': { schema: reservationCreatedV1, schemaVersion: 1 },
  'reservation.updated': { schema: reservationUpdatedV1, schemaVersion: 1 },
  'reservation.cancelled': { schema: reservationCancelledV1, schemaVersion: 1 },
  'reservation.checked_in': { schema: reservationCheckedInV1, schemaVersion: 1 },
  'reservation.checked_out': { schema: reservationCheckedOutV1, schemaVersion: 1 },
  'reservation.no_show': { schema: reservationNoShowV1, schemaVersion: 1 },
  'reservation.room_assigned': {
    schema: reservationRoomAssignedV1,
    schemaVersion: 1,
  },
  'reservation.group_created': {
    schema: reservationGroupCreatedV1,
    schemaVersion: 1,
  },
  'folio.charge_added': { schema: folioChargeAddedV1, schemaVersion: 1 },
  'folio.payment_received': {
    schema: folioPaymentReceivedV1,
    schemaVersion: 1,
  },
  'folio.closed': { schema: folioClosedV1, schemaVersion: 1 },
  'folio.reopened': { schema: folioReopenedV1, schemaVersion: 1 },
  'guest.created': { schema: guestCreatedV1, schemaVersion: 1 },
  'guest.updated': { schema: guestUpdatedV1, schemaVersion: 1 },
  'guest.erased': { schema: guestErasedV1, schemaVersion: 1 },
  'guest.merged': { schema: guestMergedV1, schemaVersion: 1 },
  'room.status_changed': { schema: roomStatusChangedV1, schemaVersion: 1 },
  'business_day.closed': { schema: businessDayClosedV1, schemaVersion: 1 },
  'business_day.reopened': { schema: businessDayReopenedV1, schemaVersion: 1 },
  'compliance.ses_submission_queued': {
    schema: sesSubmissionQueuedV1,
    schemaVersion: 1,
  },
  'compliance.ses_submission_sent': {
    schema: sesSubmissionSentV1,
    schemaVersion: 1,
  },
  'compliance.ses_submission_failed': {
    schema: sesSubmissionFailedV1,
    schemaVersion: 1,
  },
  'night_audit.run_started': { schema: nightAuditRunStartedV1, schemaVersion: 1 },
  'night_audit.step_completed': {
    schema: nightAuditStepCompletedV1,
    schemaVersion: 1,
  },
  'night_audit.step_failed': {
    schema: nightAuditStepFailedV1,
    schemaVersion: 1,
  },
  'night_audit.run_completed': {
    schema: nightAuditRunCompletedV1,
    schemaVersion: 1,
  },
  'cash.reconciliation_created': {
    schema: cashReconciliationCreatedV1,
    schemaVersion: 1,
  },
  'cash.reconciliation_discrepancy': {
    schema: cashReconciliationDiscrepancyV1,
    schemaVersion: 1,
  },
  'housekeeping.task_assigned': {
    schema: housekeepingTaskAssignedV1,
    schemaVersion: 1,
  },
  'housekeeping.task_started': {
    schema: housekeepingTaskStartedV1,
    schemaVersion: 1,
  },
  'housekeeping.task_completed': {
    schema: housekeepingTaskCompletedV1,
    schemaVersion: 1,
  },
  'housekeeping.task_cancelled': {
    schema: housekeepingTaskCancelledV1,
    schemaVersion: 1,
  },
} as const;

export type CatalogKey = keyof typeof catalog;

export type PayloadOf<K extends CatalogKey> = z.infer<(typeof catalog)[K]['schema']>;

export { propertyCreatedV1, propertyUpdatedV1 } from './property';
export type { PropertyCreatedV1Payload, PropertyUpdatedV1Payload } from './property';

export {
  reservationCancelledV1,
  reservationCheckedInV1,
  reservationCheckedOutV1,
  reservationCreatedV1,
  reservationGroupCreatedV1,
  reservationNoShowV1,
  reservationRoomAssignedV1,
  reservationUpdatedV1,
} from './reservation';
export type {
  ReservationCancelledV1Payload,
  ReservationCheckedInV1Payload,
  ReservationCheckedOutV1Payload,
  ReservationCreatedV1Payload,
  ReservationGroupCreatedV1Payload,
  ReservationNoShowV1Payload,
  ReservationRoomAssignedV1Payload,
  ReservationUpdatedV1Payload,
} from './reservation';

export {
  folioChargeAddedV1,
  folioClosedV1,
  folioPaymentReceivedV1,
  folioReopenedV1,
} from './folio';
export type {
  FolioChargeAddedV1Payload,
  FolioClosedV1Payload,
  FolioPaymentReceivedV1Payload,
  FolioReopenedV1Payload,
} from './folio';

export { guestCreatedV1, guestErasedV1, guestMergedV1, guestUpdatedV1 } from './guest';
export type {
  GuestCreatedV1Payload,
  GuestErasedV1Payload,
  GuestMergedV1Payload,
  GuestUpdatedV1Payload,
} from './guest';

export { roomStatusChangedV1 } from './room';
export type { RoomStatusChangedV1Payload } from './room';

export { businessDayClosedV1, businessDayReopenedV1 } from './business-day';
export type { BusinessDayClosedV1Payload, BusinessDayReopenedV1Payload } from './business-day';

export { sesSubmissionFailedV1, sesSubmissionQueuedV1, sesSubmissionSentV1 } from './compliance';
export type {
  SesSubmissionFailedV1Payload,
  SesSubmissionQueuedV1Payload,
  SesSubmissionSentV1Payload,
} from './compliance';

export {
  nightAuditRunCompletedV1,
  nightAuditRunStartedV1,
  nightAuditStepCompletedV1,
  nightAuditStepFailedV1,
} from './night-audit';
export type {
  NightAuditRunCompletedV1Payload,
  NightAuditRunStartedV1Payload,
  NightAuditStepCompletedV1Payload,
  NightAuditStepFailedV1Payload,
} from './night-audit';

export { cashReconciliationCreatedV1, cashReconciliationDiscrepancyV1 } from './cash';
export type {
  CashReconciliationCreatedV1Payload,
  CashReconciliationDiscrepancyV1Payload,
} from './cash';

export {
  housekeepingTaskAssignedV1,
  housekeepingTaskCancelledV1,
  housekeepingTaskCompletedV1,
  housekeepingTaskStartedV1,
} from './housekeeping';
export type {
  HousekeepingTaskAssignedV1Payload,
  HousekeepingTaskCancelledV1Payload,
  HousekeepingTaskCompletedV1Payload,
  HousekeepingTaskStartedV1Payload,
} from './housekeeping';
