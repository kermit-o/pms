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
  NightAuditRunStatus,
  NightAuditStep,
  NightAuditStepStatus,
  NightAuditReportType,
  HousekeepingTaskStatus,
  HousekeepingTaskType,
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
  NightAuditRun,
  NightAuditRunStep,
  NightAuditSnapshot,
  CashDrawerReconciliation,
  HousekeepingTask,
} from '@prisma/client';

export { withTenant } from './tenant-context';
export type { TenantContext, TenantPrismaClient } from './tenant-context';
