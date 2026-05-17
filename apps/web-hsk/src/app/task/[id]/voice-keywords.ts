/**
 * Voice keyword parser para Sprint 6 W3.
 *
 * Mapea fragmentos de transcript (`es-ES`) a un room status. Devuelve
 * null si no hay coincidencia. Es funcion pura — la testeamos sin
 * tocar Web Speech API.
 *
 * El reconocimiento es laxo a proposito: la ASR de WebSpeech mete
 * acentos a veces, otras no, y los hablantes nativos usan plural,
 * singular y diminutivos. Comparamos contra normalizacion (lowercase
 * + sin acentos).
 */
export type RoomStatusKeyword = 'CLEAN' | 'DIRTY' | 'INSPECTED' | 'OUT_OF_ORDER';

const RULES: Array<{ status: RoomStatusKeyword; patterns: RegExp[] }> = [
  {
    status: 'OUT_OF_ORDER',
    patterns: [
      /\baveria(s)?\b/,
      /\bfuera de servicio\b/,
      /\bo\.?o\.?o\b/,
      /\bout of order\b/,
      /\bdaniad[ao]\b/,
      /\brot[ao]\b/,
    ],
  },
  {
    status: 'INSPECTED',
    patterns: [/\binspeccion(ada|ado|es)?\b/, /\binspecion(ada|ado)?\b/, /\bsupervisada\b/, /\brevisada\b/],
  },
  {
    status: 'DIRTY',
    patterns: [/\bsuci[ao]s?\b/, /\bdirty\b/, /\bpor limpiar\b/, /\bsin limpiar\b/],
  },
  {
    status: 'CLEAN',
    patterns: [/\blimpi[ao]s?\b/, /\blista\b/, /\bclean\b/, /\bok\b/],
  },
];

export function parseRoomStatusKeyword(text: string): RoomStatusKeyword | null {
  const norm = normalize(text);
  for (const rule of RULES) {
    for (const re of rule.patterns) {
      if (re.test(norm)) return rule.status;
    }
  }
  return null;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
