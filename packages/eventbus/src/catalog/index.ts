import type { z } from 'zod';
import { propertyCreatedV1, propertyUpdatedV1 } from './property';

/**
 * Catalogo central de eventos del PMS.
 *
 * Reglas:
 *  - Cada entrada es un evento del dominio. La key es el tipo (subject sufix).
 *  - schema valida el payload con Zod antes de publicar.
 *  - schemaVersion arranca en 1 e incrementa cuando hay breaking change en el
 *    payload. Crear un nuevo entry (p.ej. property.created v2) NO romper el v1.
 *
 * Cuando entren las entidades reales en Sprint 2 (reservations, folio, etc.)
 * se anaden aqui sus eventos. Empieza pequeno a proposito.
 */
export const catalog = {
  'property.created': { schema: propertyCreatedV1, schemaVersion: 1 },
  'property.updated': { schema: propertyUpdatedV1, schemaVersion: 1 },
} as const;

export type CatalogKey = keyof typeof catalog;

export type PayloadOf<K extends CatalogKey> = z.infer<(typeof catalog)[K]['schema']>;

export { propertyCreatedV1, propertyUpdatedV1 } from './property';
export type { PropertyCreatedV1Payload, PropertyUpdatedV1Payload } from './property';
