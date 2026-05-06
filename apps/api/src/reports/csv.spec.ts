import { describe, expect, it } from 'vitest';
import {
  arrivalsDeparturesReportToCsv,
  inHouseReportToCsv,
  managerReportToCsv,
  revenueReportToCsv,
  taxReportToCsv,
} from './csv';

describe('CSV serialisers', () => {
  it('quotes every value and escapes embedded quotes', () => {
    const csv = managerReportToCsv({
      businessDate: '2026-06-10',
      totalRooms: 10,
      inHouse: 3,
      arrivals: 2,
      departures: 1,
      cancellationsToday: 0,
      occupancyPct: 0.3,
      adr: '100',
      revpar: '30',
      charges: { count: 4, totalAmount: '500' },
    });
    expect(csv).toContain('"key","value"\r\n');
    expect(csv).toContain('"businessDate","2026-06-10"');
    expect(csv).toContain('"adr","100"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('emits a TOTAL row at the end of revenue + tax', () => {
    const revenue = revenueReportToCsv({
      range: { from: '2026-06-01', to: '2026-06-30' },
      rows: [
        { type: 'CHARGE', count: 10, totalAmount: '1000' },
        { type: 'TAX', count: 10, totalAmount: '100' },
      ],
      totalAmount: '1100',
    });
    expect(revenue.split('\r\n')).toContain('"TOTAL","","1100"');

    const tax = taxReportToCsv({
      range: { from: '2026-06-01', to: '2026-06-30' },
      rows: [{ description: 'Tax (10%)', count: 5, totalAmount: '50' }],
      totalAmount: '50',
    });
    expect(tax).toContain('"TOTAL","","50"');
  });

  it('escapes commas and quotes inside reservation fields for in-house + arrivals', () => {
    const inHouse = inHouseReportToCsv({
      businessDate: '2026-06-10',
      count: 1,
      rows: [
        {
          reservationId: 'r1',
          code: 'BCN-AAA',
          roomNumber: '101',
          primaryGuest: 'García, Ana "test"',
          arrivalDate: '2026-06-09',
          departureDate: '2026-06-12',
          adults: 2,
          children: 1,
          balance: '250',
          currency: 'EUR',
        },
      ],
    });
    expect(inHouse).toContain('"García, Ana ""test"""');

    const ad = arrivalsDeparturesReportToCsv({
      businessDate: '2026-06-10',
      arrivals: [
        {
          reservationId: 'a1',
          code: 'BCN-A1',
          status: 'CONFIRMED',
          arrivalDate: '2026-06-10',
          departureDate: '2026-06-12',
          roomNumber: null,
          primaryGuest: 'X, Y',
        },
      ],
      departures: [],
    });
    expect(ad).toContain('"arrival","BCN-A1","CONFIRMED"');
  });
});
