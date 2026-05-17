/**
 * Voice grammar para el front office (Sprint 7 W1).
 *
 * Parsea frases en `es-ES` a intents que el UI usa para pre-rellenar
 * formularios. Es funcion pura — testable, sin dependencias.
 *
 * El reconocimiento es laxo: WebSpeech mete acentos a veces y los
 * recepcionistas hablan rapido. Normalizamos lowercase + sin acentos y
 * compactamos numeros expresados en palabras.
 *
 * Intents V1:
 *   add_charge   "carga 35 a la 305" / "cargo de 50 por limpieza"
 *   add_payment  "cobra 100 en efectivo" / "pago de 50 con tarjeta"
 *   set_room     "marca la 305 como sucia"   (futuro)
 *
 * Decisiones:
 *  - Si no detecta intent claro -> null. El UI mostrara el transcript
 *    crudo y dejara que el operador escriba.
 *  - Los montos pueden ser "35", "35 euros", "35€", "treinta y cinco".
 *    Convertimos palabras a numero solo para 0-99 (basta para hoteles).
 */

export type VoiceFoIntent =
  | {
      kind: 'add_charge';
      amount: number;
      description: string;
      roomNumber: string | null;
    }
  | {
      kind: 'add_payment';
      amount: number;
      description: string;
      paymentMethod: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';
    };

export function parseVoiceFoCommand(raw: string): VoiceFoIntent | null {
  const text = normalize(raw);
  if (!text) return null;

  // --- add_payment primero (verbos cobrar/pagar son inequívocos) -----------
  if (/\b(cobr|pago|pag[oa])\b/.test(text)) {
    const amount = extractAmount(text);
    if (amount === null) return null;
    return {
      kind: 'add_payment',
      amount,
      description: extractPaymentDescription(text),
      paymentMethod: extractPaymentMethod(text),
    };
  }

  // --- add_charge --------------------------------------------------------
  if (/\b(carg|cobr de|cuenta|anad|añad|sum)\b/.test(text)) {
    const amount = extractAmount(text);
    if (amount === null) return null;
    return {
      kind: 'add_charge',
      amount,
      description: extractChargeDescription(text),
      roomNumber: extractRoom(text),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/€/g, ' euros ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAmount(text: string): number | null {
  // Numero arabe primero: "35", "35.50", "1234"
  const numMatch = text.match(/\b(\d+(?:[.,]\d{1,2})?)\b/);
  if (numMatch) {
    return parseFloat(numMatch[1]!.replace(',', '.'));
  }
  // Numeros 0-99 en palabras (V1, mas que suficiente para hoteles).
  return wordsToNumber(text);
}

const UNITS: Record<string, number> = {
  cero: 0, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22,
  veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70,
  ochenta: 80, noventa: 90,
};

function wordsToNumber(text: string): number | null {
  const tokens = text.split(/\s+/);
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (UNITS[t] !== undefined) return UNITS[t]!;
    if (TENS[t] !== undefined) {
      // "treinta y cinco"
      if (tokens[i + 1] === 'y' && tokens[i + 2] && UNITS[tokens[i + 2]!] !== undefined) {
        return TENS[t]! + UNITS[tokens[i + 2]!]!;
      }
      return TENS[t]!;
    }
  }
  return null;
}

function extractRoom(text: string): string | null {
  // "la 305", "a la 105", "habitacion 7"
  const m = text.match(/\b(?:habitaci?on|hab|la|a la)\s+(\d{1,4})\b/);
  if (m) return m[1]!;
  // fallback: numero solo de 3-4 digitos al final (asumimos numero habitacion)
  const m2 = text.match(/\b(\d{3,4})\b/);
  return m2 ? m2[1]! : null;
}

function extractChargeDescription(text: string): string {
  // "carga 35 a la 305 por limpieza" -> "limpieza"
  // "cargo de 50 desayuno" -> "desayuno"
  const por = text.match(/\bpor ([\w\s]+?)$/);
  if (por) return capitalize(por[1]!.trim());
  // Quitamos verbos y monto/habitacion
  const cleaned = text
    .replace(/\b(carg(a|o)|de|a la|habitaci?on|hab|euros?)\b/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? capitalize(cleaned) : 'Cargo';
}

function extractPaymentDescription(text: string): string {
  const por = text.match(/\bpor ([\w\s]+?)$/);
  if (por) return capitalize(por[1]!.trim());
  return 'Pago';
}

function extractPaymentMethod(text: string): 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'OTHER' {
  if (/\b(efectivo|cash|caja)\b/.test(text)) return 'CASH';
  if (/\b(tarjeta|card|visa|mastercard|amex)\b/.test(text)) return 'CARD';
  if (/\b(transferencia|bizum|bank)\b/.test(text)) return 'BANK_TRANSFER';
  return 'OTHER';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
