import type { z } from 'zod';
import {
  folioChargeAddedV1,
  folioClosedV1,
  folioPaymentReceivedV1,
  folioReopenedV1,
} from './folio';
import {
  guestCreatedV1,
  guestErasedV1,
  guestMergedV1,
  guestUpdatedV1,
} from './guest';
import { propertyCreatedV1, propertyUpdatedV1 } from './property';
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

export {
  guestCreatedV1,
  guestErasedV1,
  guestMergedV1,
  guestUpdatedV1,
} from './guest';
export type {
  GuestCreatedV1Payload,
  GuestErasedV1Payload,
  GuestMergedV1Payload,
  GuestUpdatedV1Payload,
} from './guest';
