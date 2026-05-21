import { describe, expect, it } from 'vitest';
import { extractWidgetFromTool } from './widgets';

const sampleInput = {
  propertyId: 'p-1',
  arrival: '2026-05-26',
  departure: '2026-05-27',
  adults: 2,
};

const sampleRow = {
  roomTypeId: 'rt-dbl',
  code: 'DBL',
  name: 'Doble Estándar',
  description: 'Cama de matrimonio',
  baseOccupancy: 2,
  maxOccupancy: 2,
  totalRooms: 12,
  availableRooms: 8,
  pricePerNight: '95',
  totalForStay: '95',
  nights: 1,
  defaultCurrency: 'EUR',
};

describe('extractWidgetFromTool', () => {
  it('builds an availability widget from search_availability_by_type result', () => {
    const widget = extractWidgetFromTool(
      'search_availability_by_type',
      sampleInput,
      [sampleRow, { ...sampleRow, roomTypeId: 'rt-sup', code: 'SUP', pricePerNight: '130', totalForStay: '130' }],
    );
    expect(widget).not.toBeNull();
    expect(widget!.kind).toBe('availability');
    if (widget!.kind === 'availability') {
      expect(widget!.data.arrival).toBe('2026-05-26');
      expect(widget!.data.departure).toBe('2026-05-27');
      expect(widget!.data.nights).toBe(1);
      expect(widget!.data.rows).toHaveLength(2);
      // Renombramos availableRooms→available para el cliente.
      expect(widget!.data.rows[0]!.available).toBe(8);
      expect(widget!.data.rows[0]!.pricePerNight).toBe('95');
      expect(widget!.data.rows[0]!.currency).toBe('EUR');
    }
  });

  it('returns null for unknown tool', () => {
    expect(extractWidgetFromTool('hsk_list_today', {}, [])).toBeNull();
  });

  it('returns null when tool result is empty array', () => {
    expect(
      extractWidgetFromTool('search_availability_by_type', sampleInput, []),
    ).toBeNull();
  });

  it('returns null when tool result is not an array', () => {
    expect(
      extractWidgetFromTool('search_availability_by_type', sampleInput, { error: 'x' }),
    ).toBeNull();
  });

  it('returns null when row is missing required fields (forward-compat defense)', () => {
    const broken = { ...sampleRow };
    // @ts-expect-error simulamos un cambio futuro del tool sin el campo
    delete broken.pricePerNight;
    expect(
      extractWidgetFromTool('search_availability_by_type', sampleInput, [broken]),
    ).toBeNull();
  });

  it('falls back to EUR when defaultCurrency missing', () => {
    const noCurrency = { ...sampleRow };
    // @ts-expect-error legit en tests
    delete noCurrency.defaultCurrency;
    const widget = extractWidgetFromTool(
      'search_availability_by_type',
      sampleInput,
      [noCurrency],
    );
    if (widget?.kind === 'availability') {
      expect(widget.data.rows[0]!.currency).toBe('EUR');
    }
  });

  it('returns null when input is missing arrival/departure', () => {
    expect(
      extractWidgetFromTool('search_availability_by_type', {}, [sampleRow]),
    ).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // get_folio widget.
  // ---------------------------------------------------------------------------

  const sampleFolioResult = {
    id: 'f-1',
    reservationId: 'r-1',
    reservationCode: 'BBM01-AB12',
    status: 'OPEN',
    balance: '285.00',
    currency: 'EUR',
    closedAt: null,
    createdAt: '2026-05-20T10:00:00Z',
    updatedAt: '2026-05-21T10:00:00Z',
    entries: [
      {
        id: 'e-1',
        type: 'CHARGE',
        description: 'Habitación Doble — 3 noches × 95€',
        amount: '285.00',
        currency: 'EUR',
        postedAt: '2026-05-20T10:00:00Z',
        postedBy: 'admin@hotel.test',
        attributes: null,
      },
    ],
  };

  it('builds a folio widget from get_folio result', () => {
    const widget = extractWidgetFromTool('get_folio', { reservationCode: 'BBM01-AB12' }, sampleFolioResult);
    expect(widget).not.toBeNull();
    expect(widget!.kind).toBe('folio');
    if (widget!.kind === 'folio') {
      expect(widget!.data.reservationCode).toBe('BBM01-AB12');
      expect(widget!.data.balance).toBe('285.00');
      expect(widget!.data.entries).toHaveLength(1);
      expect(widget!.data.entries[0]!.type).toBe('CHARGE');
    }
  });

  it('returns null when folio result is malformed', () => {
    expect(extractWidgetFromTool('get_folio', {}, null)).toBeNull();
    expect(extractWidgetFromTool('get_folio', {}, { id: 'f-1' })).toBeNull();
    // Missing required field on entry.
    const broken = {
      ...sampleFolioResult,
      entries: [{ id: 'e-1', type: 'CHARGE' }],
    };
    expect(extractWidgetFromTool('get_folio', {}, broken)).toBeNull();
  });
});
