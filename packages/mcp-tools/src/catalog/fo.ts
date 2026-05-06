import { z } from 'zod';

/**
 * Front Office MCP tool catalog. Sprint 2 W7.
 *
 * These are the canonical definitions consumed by both the in-process tool
 * router (apps/api/src/copilot) and any external MCP clients that connect
 * over stdio/SSE. Each entry declares:
 *
 *  - name: stable tool id (snake_case, used by LLMs and clients).
 *  - description: short, action-oriented sentence Claude can read.
 *  - inputSchema: Zod schema validated before the router executes.
 *  - mutating: when true, the copilot must not auto-execute; it has to
 *    surface a confirmation step to the human operator. Read-only tools
 *    (mutating: false) auto-execute.
 *  - financial: when true, the action affects the folio/balance and is
 *    explicitly gated by ADR-020 ("no auto-execution of financial
 *    actions").
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const guestRef = z.union([
  z.object({ guestId: z.string().uuid() }),
  z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    nationality: z.string().length(2).optional(),
  }),
]);

export const queryAvailabilityInput = z.object({
  propertyId: z.string().uuid(),
  from: isoDate,
  to: isoDate,
  roomTypeId: z.string().uuid().optional(),
});
export type QueryAvailabilityInput = z.infer<typeof queryAvailabilityInput>;

export const createReservationInput = z.object({
  propertyId: z.string().uuid(),
  guest: guestRef,
  arrival: isoDate,
  departure: isoDate,
  roomTypeId: z.string().uuid(),
  ratePlanId: z.string().uuid().optional(),
  occupancy: z.object({
    adults: z.number().int().min(1).max(10),
    children: z.number().int().min(0).max(10).default(0),
  }),
  notes: z.string().max(2000).optional(),
});
export type CreateReservationInput = z.infer<typeof createReservationInput>;

export const checkInInput = z.object({
  reservationId: z.string().uuid(),
  roomId: z.string().uuid().optional(),
});
export type CheckInInput = z.infer<typeof checkInInput>;

export const checkOutInput = z.object({
  reservationId: z.string().uuid(),
  settle: z.boolean().default(false),
});
export type CheckOutInput = z.infer<typeof checkOutInput>;

export const addFolioChargeInput = z.object({
  folioId: z.string().uuid(),
  description: z.string().min(1).max(500),
  amount: z.number().positive(),
  type: z.enum(['CHARGE', 'TAX']).default('CHARGE'),
  idempotencyKey: z.string().min(1).max(120),
});
export type AddFolioChargeInput = z.infer<typeof addFolioChargeInput>;

export const assignRoomInput = z.object({
  reservationId: z.string().uuid(),
  roomId: z.string().uuid(),
});
export type AssignRoomInput = z.infer<typeof assignRoomInput>;

export interface FoToolMeta {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  mutating: boolean;
  financial: boolean;
}

export const foToolCatalog = {
  query_availability: {
    name: 'query_availability',
    description:
      'Returns the (room x day) availability matrix for a property and date range, including occupied dates and reservation codes.',
    inputSchema: queryAvailabilityInput,
    mutating: false,
    financial: false,
  },
  create_reservation: {
    name: 'create_reservation',
    description:
      'Creates a new reservation in PENDING status. Accepts an existing guest by id or inline guest data.',
    inputSchema: createReservationInput,
    mutating: true,
    financial: false,
  },
  check_in: {
    name: 'check_in',
    description:
      'Checks in a reservation, transitioning it to CHECKED_IN and assigning the given room (or its current room).',
    inputSchema: checkInInput,
    mutating: true,
    financial: false,
  },
  check_out: {
    name: 'check_out',
    description:
      'Checks out a reservation, transitioning it to CHECKED_OUT. settle=true also tries to close the folio (requires balance 0).',
    inputSchema: checkOutInput,
    mutating: true,
    financial: true,
  },
  add_folio_charge: {
    name: 'add_folio_charge',
    description:
      'Adds a positive charge or tax line to a folio. Always requires an idempotencyKey; financial action — operator must confirm.',
    inputSchema: addFolioChargeInput,
    mutating: true,
    financial: true,
  },
  assign_room: {
    name: 'assign_room',
    description:
      'Assigns or changes the room of an active reservation. Validates room belongs to the property and matches the booked room type.',
    inputSchema: assignRoomInput,
    mutating: true,
    financial: false,
  },
} as const satisfies Record<string, FoToolMeta>;

export type FoToolName = keyof typeof foToolCatalog;
