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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

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

export const listRoomTypesInput = z.object({
  propertyId: z.string().uuid(),
});
export type ListRoomTypesInput = z.infer<typeof listRoomTypesInput>;

export const searchAvailabilityByTypeInput = z.object({
  propertyId: z.string().uuid(),
  arrival: isoDate,
  departure: isoDate,
});
export type SearchAvailabilityByTypeInput = z.infer<typeof searchAvailabilityByTypeInput>;

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

export const generateReportInput = z.object({
  propertyId: z.string().uuid(),
  businessDate: isoDate,
  focus: z.enum(['overview', 'revenue', 'occupancy', 'incidents']).default('overview'),
});
export type GenerateReportInput = z.infer<typeof generateReportInput>;

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
  list_room_types: {
    name: 'list_room_types',
    description:
      'Lists all room types of a property with code (e.g. "DBL"), name, capacity, defaultRate and roomTypeId UUID. Call this when the user mentions a room type by name (e.g. "doble estandar", "suite") to resolve the UUID before creating a reservation.',
    inputSchema: listRoomTypesInput,
    mutating: false,
    financial: false,
  },
  search_availability_by_type: {
    name: 'search_availability_by_type',
    description:
      'Aggregated availability summary per room type for a stay window. Returns available rooms count, totalRooms, pricePerNight and totalForStay. Use this when user wants to book and you need to know how many of each type are free + price.',
    inputSchema: searchAvailabilityByTypeInput,
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
  generate_report: {
    name: 'generate_report',
    description:
      'Returns a narrative summary of a business date by reading the night-audit snapshots and the live Manager / Revenue / Tax / In-house reports. Read-only; no side effects.',
    inputSchema: generateReportInput,
    mutating: false,
    financial: false,
  },
} as const satisfies Record<string, FoToolMeta>;

export type FoToolName = keyof typeof foToolCatalog;
