import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../db';
import type { AuthUser } from '../auth';
import {
  AssignRoomDto,
  CancelReservationDto,
  CheckInDto,
  CheckOutDto,
  CreateReservationDto,
  PatchReservationDto,
} from './dto';

/**
 * Skeleton for Sprint 2 reservations domain.
 *
 * Each method outlines the contract (signature + tenant scoping + state
 * machine entry point). Bodies are intentionally not implemented yet — they
 * land week by week per docs/SPRINT-2-PLAN.md §6.
 */
@Injectable()
export class ReservationsService {
  private readonly log = new Logger(ReservationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(
    _user: AuthUser,
    _correlationId: string,
    _input: CreateReservationDto,
  ): Promise<{ id: string }> {
    throw new NotImplementedException('reservations.create — Sprint 2 W1');
  }

  async createWalkIn(
    _user: AuthUser,
    _correlationId: string,
    _input: CreateReservationDto,
  ): Promise<{ id: string }> {
    throw new NotImplementedException('reservations.createWalkIn — Sprint 2 W1');
  }

  async list(
    _user: AuthUser,
    _correlationId: string,
    _query: { from?: string; to?: string; status?: string; cursor?: string },
  ): Promise<{ items: unknown[]; nextCursor: string | null }> {
    throw new NotImplementedException('reservations.list — Sprint 2 W1');
  }

  async findOne(
    _user: AuthUser,
    _correlationId: string,
    _id: string,
  ): Promise<unknown> {
    throw new NotImplementedException('reservations.findOne — Sprint 2 W1');
  }

  async patch(
    _user: AuthUser,
    _correlationId: string,
    _id: string,
    _input: PatchReservationDto,
  ): Promise<unknown> {
    throw new NotImplementedException('reservations.patch — Sprint 2 W2');
  }

  async cancel(
    _user: AuthUser,
    _correlationId: string,
    _id: string,
    _input: CancelReservationDto,
  ): Promise<{ id: string }> {
    throw new NotImplementedException('reservations.cancel — Sprint 2 W1');
  }

  async checkIn(
    _user: AuthUser,
    _correlationId: string,
    _id: string,
    _input: CheckInDto,
  ): Promise<{ id: string; roomId: string }> {
    throw new NotImplementedException('reservations.checkIn — Sprint 2 W2');
  }

  async checkOut(
    _user: AuthUser,
    _correlationId: string,
    _id: string,
    _input: CheckOutDto,
  ): Promise<{ id: string; balance: number }> {
    throw new NotImplementedException('reservations.checkOut — Sprint 2 W3');
  }

  async assignRoom(
    _user: AuthUser,
    _correlationId: string,
    _id: string,
    _input: AssignRoomDto,
  ): Promise<{ id: string; roomId: string }> {
    throw new NotImplementedException('reservations.assignRoom — Sprint 2 W2');
  }
}
