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
  SesSubmissionStatus,
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
  SesHospedajesSubmission,
} from '@prisma/client';

export { withTenant } from './tenant-context';
export type { TenantContext, TenantPrismaClient } from './tenant-context';
