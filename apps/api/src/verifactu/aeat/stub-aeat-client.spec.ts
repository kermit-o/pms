import { describe, expect, it } from 'vitest';
import { StubAeatClient } from './stub-aeat-client';

describe('StubAeatClient', () => {
  const client = new StubAeatClient();

  it('returns an ACCEPTED result with a deterministic CSV', async () => {
    const r1 = await client.submit({
      tenantId: 't1',
      invoiceId: 'i1',
      signedXml: '<Invoice/>',
    });
    const r2 = await client.submit({
      tenantId: 't2',
      invoiceId: 'i2',
      signedXml: '<Invoice/>',
    });

    expect(r1.status).toBe('ACCEPTED');
    if (r1.status === 'ACCEPTED' && r2.status === 'ACCEPTED') {
      expect(r1.csv).toBe(r2.csv);
      expect(r1.csv).toMatch(/^[0-9A-F]{16}$/);
    }
  });

  it('rejects when payload carries the force-reject marker', async () => {
    const r = await client.submit({
      tenantId: 't1',
      invoiceId: 'i1',
      signedXml: '<Invoice><__force_reject/></Invoice>',
    });
    expect(r.status).toBe('REJECTED');
  });

  it('exposes mode = stub', () => {
    expect(client.mode).toBe('stub');
  });
});
