export {
  Prisma,
  PrismaClient,
  TenantStatus,
  UserStatus,
  AuditOperation,
  ReservationStatus,
  ReservationSource,
  RoomStatus,
  FolioStatus,
  BusinessDayStatus,
} from '@prisma/client';

export type {
  Tenant,
  User,
  Property,
  AuditLog,
  Reservation,
  ReservationGuest,
  Room,
  RoomType,
  Guest,
  RatePlan,
  Folio,
  FolioEntry,
  BusinessDayState,
} from '@prisma/client';

export { withTenant } from './tenant-context';
export type { TenantContext, TenantPrismaClient } from './tenant-context';
