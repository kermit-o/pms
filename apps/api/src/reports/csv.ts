import type {
  ArrivalsDeparturesReportPayload,
  InHouseReportPayload,
  ManagerReportPayload,
  RevenueReportPayload,
  TaxReportPayload,
} from './types';

/**
 * Tiny CSV helpers. Always quote values; double up internal quotes.
 * Row separator is CRLF (Excel + RFC 4180).
 */
function csvCell(value: unknown): string {
  if (value == null) return '""';
  const s = String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

function build(rows: string[]): string {
  return rows.join('\r\n') + '\r\n';
}

export function managerReportToCsv(p: ManagerReportPayload): string {
  return build([
    csvRow(['key', 'value']),
    csvRow(['businessDate', p.businessDate]),
    csvRow(['totalRooms', p.totalRooms]),
    csvRow(['inHouse', p.inHouse]),
    csvRow(['arrivals', p.arrivals]),
    csvRow(['departures', p.departures]),
    csvRow(['cancellationsToday', p.cancellationsToday]),
    csvRow(['occupancyPct', p.occupancyPct]),
    csvRow(['adr', p.adr]),
    csvRow(['revpar', p.revpar]),
    csvRow(['chargesCount', p.charges.count]),
    csvRow(['chargesTotalAmount', p.charges.totalAmount]),
  ]);
}

export function revenueReportToCsv(p: RevenueReportPayload): string {
  const lines: string[] = [csvRow(['type', 'count', 'totalAmount'])];
  for (const r of p.rows) {
    lines.push(csvRow([r.type, r.count, r.totalAmount]));
  }
  lines.push(csvRow(['TOTAL', '', p.totalAmount]));
  return build(lines);
}

export function taxReportToCsv(p: TaxReportPayload): string {
  const lines: string[] = [csvRow(['description', 'count', 'totalAmount'])];
  for (const r of p.rows) {
    lines.push(csvRow([r.description, r.count, r.totalAmount]));
  }
  lines.push(csvRow(['TOTAL', '', p.totalAmount]));
  return build(lines);
}

export function inHouseReportToCsv(p: InHouseReportPayload): string {
  const lines: string[] = [
    csvRow([
      'code',
      'roomNumber',
      'primaryGuest',
      'arrivalDate',
      'departureDate',
      'adults',
      'children',
      'balance',
      'currency',
    ]),
  ];
  for (const r of p.rows) {
    lines.push(
      csvRow([
        r.code,
        r.roomNumber,
        r.primaryGuest,
        r.arrivalDate,
        r.departureDate,
        r.adults,
        r.children,
        r.balance,
        r.currency,
      ]),
    );
  }
  return build(lines);
}

export function arrivalsDeparturesReportToCsv(p: ArrivalsDeparturesReportPayload): string {
  const lines: string[] = [
    csvRow([
      'list',
      'code',
      'status',
      'roomNumber',
      'primaryGuest',
      'arrivalDate',
      'departureDate',
    ]),
  ];
  for (const r of p.arrivals) {
    lines.push(
      csvRow([
        'arrival',
        r.code,
        r.status,
        r.roomNumber,
        r.primaryGuest,
        r.arrivalDate,
        r.departureDate,
      ]),
    );
  }
  for (const r of p.departures) {
    lines.push(
      csvRow([
        'departure',
        r.code,
        r.status,
        r.roomNumber,
        r.primaryGuest,
        r.arrivalDate,
        r.departureDate,
      ]),
    );
  }
  return build(lines);
}
