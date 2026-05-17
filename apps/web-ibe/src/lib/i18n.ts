/**
 * i18n minimalista (Sprint 8 W2).
 *
 * Sin libs externas — un diccionario por locale + helper `t(locale, key)`.
 * El locale se resuelve por searchParam `?lang=` o cookie `ibe_lang`,
 * default `es`. Cuando el catálogo crezca migramos a `next-intl`.
 */
export type Locale = 'es' | 'en';

export const LOCALES: Locale[] = ['es', 'en'];
export const DEFAULT_LOCALE: Locale = 'es';

type Dict = Record<string, string>;

const ES: Dict = {
  'site.tagline': 'Reserva directa, mejor precio',
  'site.poweredBy': 'Aubergine PMS',
  'search.title': 'Busca tu estancia',
  'search.arrival': 'Llegada',
  'search.departure': 'Salida',
  'search.adults': 'Adultos',
  'search.children': 'Niños',
  'search.cta': 'Buscar disponibilidad',
  'search.lang': 'Idioma',
  'avail.title': 'Disponibilidad',
  'avail.nights': 'noches',
  'avail.perNight': '/noche',
  'avail.total': 'Total estancia',
  'avail.book': 'Reservar',
  'avail.empty': 'No hay habitaciones disponibles para esas fechas. Prueba otras.',
  'avail.maxOccupancy': 'Hasta',
  'avail.pax': 'personas',
  'manage.title': 'Gestiona tu reserva',
  'manage.code': 'Código de reserva',
  'manage.lastName': 'Apellido',
  'manage.lookup': 'Ver mi reserva',
  'errors.invalidRange': 'La fecha de salida debe ser posterior a la llegada.',
  'errors.fetch': 'No pudimos cargar los datos. Reintenta en unos segundos.',
  'errors.unknownHotel': 'Hotel no encontrado o aún no publicado.',
  'footer.legal': 'Aviso legal',
  'footer.privacy': 'Privacidad',
};

const EN: Dict = {
  'site.tagline': 'Direct booking, best price',
  'site.poweredBy': 'Aubergine PMS',
  'search.title': 'Find your stay',
  'search.arrival': 'Check-in',
  'search.departure': 'Check-out',
  'search.adults': 'Adults',
  'search.children': 'Children',
  'search.cta': 'Search availability',
  'search.lang': 'Language',
  'avail.title': 'Availability',
  'avail.nights': 'nights',
  'avail.perNight': '/night',
  'avail.total': 'Stay total',
  'avail.book': 'Book',
  'avail.empty': 'No rooms available for these dates. Try different ones.',
  'avail.maxOccupancy': 'Up to',
  'avail.pax': 'guests',
  'manage.title': 'Manage your reservation',
  'manage.code': 'Booking code',
  'manage.lastName': 'Last name',
  'manage.lookup': 'View my booking',
  'errors.invalidRange': 'Check-out must be after check-in.',
  'errors.fetch': 'Could not load. Try again in a moment.',
  'errors.unknownHotel': 'Hotel not found or not yet published.',
  'footer.legal': 'Legal',
  'footer.privacy': 'Privacy',
};

const DICTS: Record<Locale, Dict> = { es: ES, en: EN };

export function t(locale: Locale, key: keyof typeof ES): string {
  return DICTS[locale][key] ?? DICTS[DEFAULT_LOCALE][key] ?? key;
}

export function resolveLocale(searchParams: { lang?: string } | undefined): Locale {
  const v = searchParams?.lang;
  if (v === 'en' || v === 'es') return v;
  return DEFAULT_LOCALE;
}
