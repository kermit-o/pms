/**
 * Sprint 13 — Post-LLM validator: detecta y sanea respuestas del Copilot
 * con placeholders monetarios alucinados (ej. "desde más €", precio sin
 * número). Pura — sin I/O, sin dependencias, fácil de cubrir con tests.
 *
 * Incidente que lo motiva: el LLM devolvió una tabla con cinco filas,
 * pero sólo había datos reales para tres. Las dos últimas tenían
 * "**desde más €**" y se mostraron al recepcionista como si fueran
 * precios. Esto es inaceptable en producción.
 *
 * Estrategia:
 *  1. Buscar frases vagas conocidas ("desde más €", "precio a consultar",
 *     "a partir de €" sin número, etc.).
 *  2. Buscar símbolos de moneda sin número adyacente (€ huérfano).
 *  3. Si encontramos alguna violación: reemplazar el fragmento por
 *     `[precio no consultado]`, log y devolver flag para que el
 *     adapter pueda decidir si reintentar al LLM con un mensaje de
 *     corrección o devolver la versión saneada.
 */

export interface ValidationResult {
  /** true si la respuesta es válida tal cual. */
  ok: boolean;
  /** Frases concretas detectadas; sirven para log + retry prompt. */
  violations: string[];
  /** Texto seguro de mostrar al usuario (igual que input si ok=true). */
  sanitized: string;
}

const VAGUE_PRICE_PHRASES: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /desde\s+m[áa]s\s*[€$£]/gi,
    reason: '"desde más €" (placeholder sin cifra)',
  },
  {
    pattern: /a\s+partir\s+de\s+[€$£](?!\s*\d)/gi,
    reason: '"a partir de €" sin número',
  },
  {
    pattern: /precio\s+a\s+consultar/gi,
    reason: '"precio a consultar" (LLM se rinde sin pedir el tool)',
  },
  {
    pattern: /consultar\s+precio/gi,
    reason: '"consultar precio"',
  },
  {
    pattern: /var[íi]a\s+seg[uú]n\s+(la\s+)?(temporada|fecha|ocupaci[oó]n)/gi,
    reason: '"varía según temporada/fecha/ocupación" (evasiva)',
  },
  {
    pattern: /precio\s+orientativo/gi,
    reason: '"precio orientativo"',
  },
];

// Símbolo de moneda no precedido por dígito en la misma "celda" textual.
// Cubre patrones como "| €  |" en tablas markdown, "el precio es €" o
// "**€**" sin cifra antes. NO marca casos legítimos como "5 €", "10€",
// "EUR 95", "el € es la divisa local".
const ORPHAN_CURRENCY = /(?<![\d.,]\s?)(€|\$|£)(?!\d|UR|SD|BP|\s*[A-Z])/g;

const PLACEHOLDER = '[precio no consultado]';

export function validateAssistantText(text: string): ValidationResult {
  const violations: string[] = [];
  let sanitized = text;

  for (const { pattern, reason } of VAGUE_PRICE_PHRASES) {
    if (pattern.test(sanitized)) {
      violations.push(reason);
      // Reset lastIndex (RegExp global) antes de replace.
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, PLACEHOLDER);
    }
  }

  // Huérfanos sólo si no se reemplazó ya por una frase anterior.
  if (ORPHAN_CURRENCY.test(sanitized)) {
    violations.push('moneda sin cifra (€/$/£ huérfano)');
    ORPHAN_CURRENCY.lastIndex = 0;
    sanitized = sanitized.replace(ORPHAN_CURRENCY, PLACEHOLDER);
  }

  if (violations.length === 0) {
    return { ok: true, violations, sanitized: text };
  }
  return {
    ok: false,
    violations,
    sanitized,
  };
}

/**
 * Mensaje meta que se prepende a una respuesta saneada para que el
 * recepcionista sepa que algo no estaba verificado. Localizado en ES
 * porque toda la UI del Copilot está en español.
 */
export const SANITIZED_WARNING =
  '⚠ Hay datos no verificados en mi respuesta. Pídeme que los consulte de nuevo si necesitas el detalle.';
