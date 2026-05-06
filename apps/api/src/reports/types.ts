/**
 * Shared types for report generators.
 *
 * Each generator is a pure async function that takes a Prisma transaction
 * client (already wrapped in withTenant), a tenant scope and a query, and
 * returns a serialisable payload. Decimals are returned as strings so the
 * reports survive JSON serialisation without precision loss.
 */
import type { Prisma } from '@pms/db';

export interface ReportContext {
  tx: Prisma.TransactionClient;
  tenantId: string;
}

export interface DateRange {
  /** YYYY-MM-DD inclusive */
  from: string;
  /** YYYY-MM-DD inclusive */
  to: string;
}

export interface ManagerReportPayload {
  businessDate: string;
  totalRooms: number;
  inHouse: number;
  arrivals: number;
  departures: number;
  cancellationsToday: number;
  occupancyPct: number;
  /** Average daily rate over the day's room charges. */
  adr: string;
  /** Revenue per available room. */
  revpar: string;
  charges: {
    count: number;
    totalAmount: string;
  };
}

export interface RevenueReportRow {
  type: string;
  count: number;
  totalAmount: string;
}

export interface RevenueReportPayload {
  range: DateRange;
  rows: RevenueReportRow[];
  totalAmount: string;
}

export interface TaxReportPayload {
  range: DateRange;
  rows: Array<{
    description: string;
    count: number;
    totalAmount: string;
  }>;
  totalAmount: string;
}
