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
    expect(extractWidgetFromTool('check_in', {}, {})).toBeNull();
    expect(extractWidgetFromTool('forecast_demand', {}, [])).toBeNull();
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

  // ---------------------------------------------------------------------------
  // get_reservation widget.
  // ---------------------------------------------------------------------------

  const sampleReservation = {
    id: 'r-1',
    code: 'BBM01-AB12',
    status: 'CHECKED_IN',
    arrivalDate: '2026-05-20T00:00:00.000Z',
    departureDate: '2026-05-22T00:00:00.000Z',
    adults: 2,
    children: 0,
    roomTypeId: 'rt-dbl',
    roomTypeCode: 'DBL',
    roomTypeName: 'Doble Estándar',
    roomNumber: '203',
    roomId: 'room-203',
    totalAmount: '190.00',
    currency: 'EUR',
    guaranteeStatus: 'SECURED',
    guaranteeType: 'CARD_ON_FILE',
    stripeCardBrand: 'visa',
    stripeCardLast4: '4242',
    folio: { id: 'f-1', status: 'OPEN', balance: '95.00', currency: 'EUR' },
    guests: [
      {
        isPrimary: true,
        guest: {
          id: 'g-1',
          firstName: 'María',
          lastName: 'Pérez',
          email: 'maria@example.com',
          phone: '+34 600 111 222',
        },
      },
    ],
  };

  it('builds a reservation widget from get_reservation result', () => {
    const widget = extractWidgetFromTool('get_reservation', {}, sampleReservation);
    expect(widget).not.toBeNull();
    expect(widget!.kind).toBe('reservation');
    if (widget!.kind === 'reservation') {
      expect(widget!.data.reservationCode).toBe('BBM01-AB12');
      expect(widget!.data.nights).toBe(2);
      expect(widget!.data.roomNumber).toBe('203');
      expect(widget!.data.guest?.firstName).toBe('María');
      expect(widget!.data.cardLast4).toBe('4242');
      expect(widget!.data.folio?.balance).toBe('95.00');
    }
  });

  it('reservation widget handles missing optional fields (no primary guest, no card, no room)', () => {
    const sparse = {
      ...sampleReservation,
      guests: [],
      stripeCardBrand: null,
      stripeCardLast4: null,
      roomNumber: null,
      folio: null,
    };
    const widget = extractWidgetFromTool('get_reservation', {}, sparse);
    expect(widget).not.toBeNull();
    if (widget?.kind === 'reservation') {
      expect(widget.data.guest).toBeNull();
      expect(widget.data.cardLast4).toBeNull();
      expect(widget.data.roomNumber).toBeNull();
      expect(widget.data.folio).toBeNull();
    }
  });

  it('returns null when reservation result is missing required fields', () => {
    expect(extractWidgetFromTool('get_reservation', {}, null)).toBeNull();
    expect(extractWidgetFromTool('get_reservation', {}, { id: 'r-1' })).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // hsk_list_today widget.
  // ---------------------------------------------------------------------------

  const sampleTasks = [
    {
      id: 't-1',
      propertyId: 'p-1',
      roomId: 'room-203',
      roomNumber: '203',
      roomFloor: '2',
      businessDate: '2026-05-22',
      taskType: 'CHECKOUT_CLEAN',
      status: 'PENDING',
      assignedToUserId: 'u-1',
      assigneeName: 'Camila R.',
      assignedAt: null,
      startedAt: null,
      completedAt: null,
      durationMin: null,
      scheduledFor: null,
      notes: null,
      createdAt: '2026-05-22T07:00:00Z',
      updatedAt: '2026-05-22T07:00:00Z',
    },
    {
      id: 't-2',
      propertyId: 'p-1',
      roomId: 'room-205',
      roomNumber: '205',
      roomFloor: '2',
      businessDate: '2026-05-22',
      taskType: 'STAYOVER_CLEAN',
      status: 'IN_PROGRESS',
      assignedToUserId: 'u-2',
      assigneeName: 'Lupita M.',
      assignedAt: null,
      startedAt: '2026-05-22T09:00:00Z',
      completedAt: null,
      durationMin: null,
      scheduledFor: null,
      notes: 'cliente sale tarde',
      createdAt: '2026-05-22T07:00:00Z',
      updatedAt: '2026-05-22T09:00:00Z',
    },
    {
      id: 't-3',
      propertyId: 'p-1',
      roomId: 'room-110',
      roomNumber: '110',
      roomFloor: '1',
      businessDate: '2026-05-22',
      taskType: 'CHECKOUT_CLEAN',
      status: 'DONE',
      assignedToUserId: 'u-1',
      assigneeName: 'Camila R.',
      assignedAt: null,
      startedAt: '2026-05-22T08:00:00Z',
      completedAt: '2026-05-22T08:45:00Z',
      durationMin: 45,
      scheduledFor: null,
      notes: null,
      createdAt: '2026-05-22T07:00:00Z',
      updatedAt: '2026-05-22T08:45:00Z',
    },
  ];

  it('builds an hsk_tasks widget from hsk_list_today result', () => {
    const widget = extractWidgetFromTool(
      'hsk_list_today',
      { propertyId: 'p-1', businessDate: '2026-05-22' },
      sampleTasks,
    );
    expect(widget).not.toBeNull();
    if (widget?.kind === 'hsk_tasks') {
      expect(widget.data.businessDate).toBe('2026-05-22');
      expect(widget.data.rows).toHaveLength(3);
      expect(widget.data.counts).toEqual({ PENDING: 1, IN_PROGRESS: 1, DONE: 1, BLOCKED: 0 });
      expect(widget.data.rows[0]!.roomNumber).toBe('203');
      expect(widget.data.rows[1]!.assigneeName).toBe('Lupita M.');
    }
  });

  it('hsk_tasks widget se emite también con array vacío (confirma 0 tareas)', () => {
    const widget = extractWidgetFromTool(
      'hsk_list_today',
      { propertyId: 'p-1', businessDate: '2026-05-22' },
      [],
    );
    expect(widget).not.toBeNull();
    if (widget?.kind === 'hsk_tasks') {
      expect(widget.data.rows).toHaveLength(0);
      expect(widget.data.counts).toEqual({ PENDING: 0, IN_PROGRESS: 0, DONE: 0, BLOCKED: 0 });
    }
  });

  it('hsk_tasks widget tolera tareas sin habitación asignada o sin asignatario', () => {
    const sparse = [
      {
        id: 't-x',
        taskType: 'INSPECTION',
        status: 'PENDING',
        // No roomNumber, no assigneeName.
      },
    ];
    const widget = extractWidgetFromTool('hsk_list_today', {}, sparse);
    if (widget?.kind === 'hsk_tasks') {
      expect(widget.data.rows[0]!.roomNumber).toBeNull();
      expect(widget.data.rows[0]!.assigneeName).toBeNull();
    }
  });

  it('hsk_tasks widget rechaza filas sin id/taskType/status', () => {
    const broken = [{ id: 't-1', taskType: 'INSPECTION' }]; // sin status
    expect(extractWidgetFromTool('hsk_list_today', {}, broken)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // list_movements widget (arrivals / departures).
  // ---------------------------------------------------------------------------

  const sampleMovement = {
    direction: 'arrival',
    date: '2026-05-22',
    items: [
      {
        id: 'r-1',
        code: 'BBM01-AB12',
        status: 'CONFIRMED',
        arrivalDate: '2026-05-22',
        departureDate: '2026-05-24',
        adults: 2,
        children: 0,
        roomTypeId: 'rt-dbl',
        roomTypeCode: 'DBL',
        roomTypeName: 'Doble',
        roomNumber: '203',
        totalAmount: '190.00',
        currency: 'EUR',
        guaranteeStatus: 'SECURED',
        folioBalance: '190.00',
        primaryGuest: {
          id: 'g-1',
          firstName: 'María',
          lastName: 'Pérez',
          email: 'm@example.com',
          phone: null,
          membershipLevel: null,
        },
      },
      {
        id: 'r-2',
        code: 'BBM01-CD34',
        status: 'PENDING',
        arrivalDate: '2026-05-22',
        departureDate: '2026-05-23',
        adults: 1,
        children: 0,
        roomTypeId: 'rt-ind',
        roomTypeCode: 'IND',
        roomTypeName: 'Individual',
        roomNumber: null,
        totalAmount: '60.00',
        currency: 'EUR',
        guaranteeStatus: 'PENDING',
        folioBalance: '60.00',
        primaryGuest: {
          id: 'g-2',
          firstName: 'Pedro',
          lastName: 'Gómez',
          email: null,
          phone: null,
          membershipLevel: null,
        },
      },
    ],
  };

  it('builds a movements widget para arrival', () => {
    const widget = extractWidgetFromTool('list_movements', {}, sampleMovement);
    expect(widget).not.toBeNull();
    if (widget?.kind === 'movements') {
      expect(widget.data.direction).toBe('arrival');
      expect(widget.data.businessDate).toBe('2026-05-22');
      expect(widget.data.rows).toHaveLength(2);
      expect(widget.data.rows[0]!.guestLastName).toBe('Pérez');
      expect(widget.data.rows[0]!.roomNumber).toBe('203');
      expect(widget.data.rows[1]!.roomNumber).toBeNull();
    }
  });

  it('movements widget también funciona para departure', () => {
    const widget = extractWidgetFromTool('list_movements', {}, {
      ...sampleMovement,
      direction: 'departure',
    });
    if (widget?.kind === 'movements') {
      expect(widget.data.direction).toBe('departure');
    }
  });

  it('movements widget acepta items vacío (confirma 0 llegadas)', () => {
    const widget = extractWidgetFromTool('list_movements', {}, {
      direction: 'arrival',
      date: '2026-05-22',
      items: [],
    });
    if (widget?.kind === 'movements') {
      expect(widget.data.rows).toHaveLength(0);
    }
  });

  it('movements widget rechaza direction inválida', () => {
    const broken = { ...sampleMovement, direction: 'sideways' };
    expect(extractWidgetFromTool('list_movements', {}, broken)).toBeNull();
  });

  it('movements widget rechaza items sin id/code/status', () => {
    const broken = {
      ...sampleMovement,
      items: [{ id: 'r-x', code: 'X' }], // sin status
    };
    expect(extractWidgetFromTool('list_movements', {}, broken)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // hsk_suggest_assignments widget.
  // ---------------------------------------------------------------------------

  const sampleSuggest = {
    propertyId: 'p-1',
    businessDate: '2026-05-22',
    shiftCapacityMin: 420,
    defaultDurationMin: 30,
    candidates: [
      {
        userId: 'u-1',
        userName: 'Camila R.',
        totalAssignedMin: 180,
        taskCount: 6,
        remainingMin: 240,
      },
      {
        userId: 'u-2',
        userName: 'Lupita M.',
        totalAssignedMin: 120,
        taskCount: 4,
        remainingMin: 300,
      },
    ],
    suggestions: [
      {
        taskId: 't-1',
        roomId: 'r-203',
        roomNumber: '203',
        floor: '2',
        taskType: 'CHECKOUT_CLEAN',
        currentlyAssignedToUserId: null,
        suggestedUserId: 'u-1',
        suggestedUserName: 'Camila R.',
        predictedMin: 30,
      },
      {
        taskId: 't-2',
        roomId: 'r-205',
        roomNumber: '205',
        floor: '2',
        taskType: 'STAYOVER_CLEAN',
        currentlyAssignedToUserId: 'u-2',
        suggestedUserId: 'u-2',
        suggestedUserName: 'Lupita M.',
        predictedMin: 15,
      },
    ],
    unmatched: [
      {
        taskId: 't-3',
        roomNumber: '101',
        floor: '1',
        taskType: 'MAINTENANCE',
        predictedMin: 60,
        reason: 'capacity_exhausted',
      },
    ],
  };

  it('builds hsk_suggest widget con candidates + suggestions + unmatched', () => {
    const widget = extractWidgetFromTool('hsk_suggest_assignments', {}, sampleSuggest);
    expect(widget).not.toBeNull();
    if (widget?.kind === 'hsk_suggest') {
      expect(widget.data.businessDate).toBe('2026-05-22');
      expect(widget.data.candidates).toHaveLength(2);
      expect(widget.data.candidates[0]!.userName).toBe('Camila R.');
      expect(widget.data.suggestions).toHaveLength(2);
      expect(widget.data.suggestions[0]!.suggestedUserName).toBe('Camila R.');
      expect(widget.data.unmatched).toHaveLength(1);
      expect(widget.data.unmatched[0]!.reason).toBe('capacity_exhausted');
    }
  });

  it('hsk_suggest widget devuelve null si faltan campos clave', () => {
    expect(extractWidgetFromTool('hsk_suggest_assignments', {}, null)).toBeNull();
    expect(
      extractWidgetFromTool('hsk_suggest_assignments', {}, { businessDate: '2026-05-22' }),
    ).toBeNull();
  });
});
