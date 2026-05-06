export { ReportsModule } from './reports.module';
export { ReportsService } from './reports.service';
export { generateManagerReport } from './generators/manager-report';
export { generateRevenueReport } from './generators/revenue-report';
export { generateTaxReport } from './generators/tax-report';
export type {
  ManagerReportPayload,
  RevenueReportPayload,
  TaxReportPayload,
  DateRange,
  ReportContext,
} from './types';
