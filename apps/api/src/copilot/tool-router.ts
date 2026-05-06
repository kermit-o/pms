import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  type AddFolioChargeInput,
  type AssignRoomInput,
  type CheckInInput,
  type CheckOutInput,
  type CreateReservationInput,
  type FoToolName,
  type QueryAvailabilityInput,
  foToolCatalog,
} from '@pms/mcp-tools';
import type { AuthUser } from '../auth';
import { FolioService } from '../folio';
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
      case 'check_in': {
        const i = input as CheckInInput;
        return this.reservations.checkIn(user, correlationId, i.reservationId, {
          roomId: i.roomId,
        });
      }
      case 'check_out': {
        const i = input as CheckOutInput;
        return this.reservations.checkOut(
          user,
          correlationId,
          i.reservationId,
          { settle: i.settle },
        );
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
        return this.reservations.assignRoom(
          user,
          correlationId,
          i.reservationId,
          { roomId: i.roomId },
        );
      }
    }
  }
}
