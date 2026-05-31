import { describe, expect, it } from 'vitest';
import { computeHuella, formatFechaExpedicion } from './huella';

const baseInput = {
  emisorNif: 'B12345678',
  numSerieFactura: 'A-43',
  fechaExpedicionFactura: '30-05-2026',
  tipoFactura: 'F1',
  cuotaTotal: '10.00',
  importeTotal: '110.00',
};

describe('computeHuella', () => {
  it('returns a deterministic 64-char hex SHA-256', () => {
    const h = computeHuella(baseInput, null);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(computeHuella(baseInput, null));
  });

  it('differs when the previous huella changes (chain dependency)', () => {
    const h1 = computeHuella(baseInput, null);
    const h2 = computeHuella(baseInput, 'a'.repeat(64));
    expect(h1).not.toBe(h2);
  });

  it('differs when any identifying field changes', () => {
    const base = computeHuella(baseInput, null);
    expect(computeHuella({ ...baseInput, importeTotal: '120.00' }, null)).not.toBe(base);
    expect(computeHuella({ ...baseInput, numSerieFactura: 'A-44' }, null)).not.toBe(base);
    expect(computeHuella({ ...baseInput, emisorNif: 'B99999999' }, null)).not.toBe(base);
    expect(computeHuella({ ...baseInput, tipoFactura: 'F2' }, null)).not.toBe(base);
  });
});

describe('formatFechaExpedicion', () => {
  it('produces DD-MM-YYYY in UTC', () => {
    expect(formatFechaExpedicion(new Date('2026-01-05T00:00:00Z'))).toBe('05-01-2026');
    expect(formatFechaExpedicion(new Date('2026-12-31T23:59:00Z'))).toBe('31-12-2026');
  });
});
