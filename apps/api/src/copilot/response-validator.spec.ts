import { describe, expect, it } from 'vitest';
import { validateAssistantText } from './response-validator';

describe('validateAssistantText', () => {
  // ---------------------------------------------------------------------------
  // Cases that MUST be flagged (alucinaciones reales que se han visto en
  // producción o son fáciles de generar por el LLM bajo presión).
  // ---------------------------------------------------------------------------

  it('flags "desde más €" — el caso exacto del incidente BBM01', () => {
    const out = validateAssistantText('| Junior Suite | Mayor confort | **desde más €** |');
    expect(out.ok).toBe(false);
    expect(out.violations[0]).toMatch(/desde más/);
    expect(out.sanitized).toContain('[precio no consultado]');
    expect(out.sanitized).not.toMatch(/desde más/i);
  });

  it('flags "a partir de €" sin número', () => {
    const out = validateAssistantText('La habitación cuesta a partir de € por noche.');
    expect(out.ok).toBe(false);
    expect(out.sanitized).not.toMatch(/a partir de €/i);
  });

  it('flags "precio a consultar"', () => {
    const out = validateAssistantText('Junior Suite: precio a consultar con el hotel.');
    expect(out.ok).toBe(false);
    expect(out.sanitized).toContain('[precio no consultado]');
  });

  it('flags "varía según temporada"', () => {
    const out = validateAssistantText('El precio varía según temporada y disponibilidad.');
    expect(out.ok).toBe(false);
  });

  it('flags un € huérfano en tabla markdown', () => {
    const out = validateAssistantText('| Suite | Máximo lujo | € |');
    expect(out.ok).toBe(false);
    expect(out.violations).toContain('moneda sin cifra (€/$/£ huérfano)');
  });

  it('sustituye en TODAS las ocurrencias, no sólo la primera', () => {
    const out = validateAssistantText('| Doble | desde más € | | Twin | desde más € |');
    expect(out.ok).toBe(false);
    expect(out.sanitized.match(/\[precio no consultado\]/g)).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // Cases that MUST NOT be flagged (falsos positivos a evitar).
  // ---------------------------------------------------------------------------

  it('no flag: precio real con número antes', () => {
    const out = validateAssistantText('La doble cuesta 95 € por noche.');
    expect(out.ok).toBe(true);
    expect(out.sanitized).toBe('La doble cuesta 95 € por noche.');
  });

  it('no flag: número pegado al símbolo (95€)', () => {
    const out = validateAssistantText('95€/noche');
    expect(out.ok).toBe(true);
  });

  it('no flag: códigos ISO (EUR, USD, GBP)', () => {
    const out = validateAssistantText('Total: EUR 285 (3 noches × 95).');
    expect(out.ok).toBe(true);
  });

  it('no flag: tabla legítima sin placeholders', () => {
    const out = validateAssistantText(`
| Tipo            | Precio   |
| --------------- | -------- |
| Doble Estándar  | 95 €     |
| Doble Superior  | 130 €    |
    `);
    expect(out.ok).toBe(true);
  });

  // (Nota: un € huérfano en frase abstracta como "la divisa es el €" sí se
  // saneará. Es aceptable: el Copilot de un PMS no habla de divisas en
  // abstracto, siempre cita precios — la utilidad de cazar alucinaciones
  // pesa más que ese caso teórico.)

  // ---------------------------------------------------------------------------
  // Contrato.
  // ---------------------------------------------------------------------------

  it('respuesta vacía es válida (no flag)', () => {
    const out = validateAssistantText('');
    expect(out.ok).toBe(true);
    expect(out.sanitized).toBe('');
  });

  it('sanitized === input cuando ok=true', () => {
    const original = 'Doble disponible a 95 €.';
    const out = validateAssistantText(original);
    expect(out.ok).toBe(true);
    expect(out.sanitized).toBe(original);
  });
});
