import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { PreprodAeatClient } from './preprod-aeat-client';

function makeConfig(endpoint: string | undefined, timeoutMs = 15_000) {
  return {
    get: (key: keyof Env) => {
      if (key === 'VERIFACTU_AEAT_ENDPOINT') return endpoint;
      if (key === 'VERIFACTU_AEAT_TIMEOUT_MS') return timeoutMs;
      return undefined;
    },
  } as unknown as ConfigService<Env, true>;
}

const REQ = {
  tenantId: 't1',
  invoiceId: 'i1',
  signedXml: '<RegFactuSistemaFacturacion><RegistroAlta/></RegFactuSistemaFacturacion>',
};

function mockFetch(impl: typeof fetch): void {
  vi.stubGlobal('fetch', impl);
}

describe('PreprodAeatClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws on construction when endpoint is missing', () => {
    expect(() => new PreprodAeatClient(makeConfig(undefined))).toThrow(/VERIFACTU_AEAT_ENDPOINT/);
  });

  it('returns ACCEPTED + extracts CSV when AEAT responds 200 with <CSV>', async () => {
    const client = new PreprodAeatClient(makeConfig('https://aeat.test/verifactu'));
    mockFetch(
      vi.fn(
        async () =>
          new Response('<RespuestaSuministro><CSV>ABCDEF0123456789</CSV></RespuestaSuministro>', {
            status: 200,
          }),
      ) as unknown as typeof fetch,
    );
    const r = await client.submit(REQ);
    expect(r.status).toBe('ACCEPTED');
    if (r.status === 'ACCEPTED') {
      expect(r.csv).toBe('ABCDEF0123456789');
      expect(r.responseCode).toBe(200);
    }
  });

  it('returns ACCEPTED with a namespaced <ns:Csv> tag too', async () => {
    const client = new PreprodAeatClient(makeConfig('https://aeat.test/verifactu'));
    mockFetch(
      vi.fn(
        async () => new Response('<R><suministro:Csv>XYZ123</suministro:Csv></R>', { status: 200 }),
      ) as unknown as typeof fetch,
    );
    const r = await client.submit(REQ);
    expect(r.status).toBe('ACCEPTED');
    if (r.status === 'ACCEPTED') expect(r.csv).toBe('XYZ123');
  });

  it('returns REJECTED on HTTP 422 + extracts CodigoErrorRegistro', async () => {
    const client = new PreprodAeatClient(makeConfig('https://aeat.test/verifactu'));
    mockFetch(
      vi.fn(
        async () =>
          new Response(
            '<E><CodigoErrorRegistro>4102</CodigoErrorRegistro><DescripcionErrorRegistro>NIF inválido</DescripcionErrorRegistro></E>',
            { status: 422 },
          ),
      ) as unknown as typeof fetch,
    );
    const r = await client.submit(REQ);
    expect(r.status).toBe('REJECTED');
    if (r.status === 'REJECTED') {
      expect(r.responseCode).toBe(422);
      expect(r.errorMessage).toBe('4102 — NIF inválido');
    }
  });

  it('returns REJECTED on 200 without CSV (business-level reject)', async () => {
    const client = new PreprodAeatClient(makeConfig('https://aeat.test/verifactu'));
    mockFetch(
      vi.fn(
        async () =>
          new Response('<R><CodigoErrorRegistro>9001</CodigoErrorRegistro></R>', { status: 200 }),
      ) as unknown as typeof fetch,
    );
    const r = await client.submit(REQ);
    expect(r.status).toBe('REJECTED');
    if (r.status === 'REJECTED') expect(r.errorMessage).toContain('9001');
  });

  it('throws on HTTP 5xx so the worker treats it as transitorio', async () => {
    const client = new PreprodAeatClient(makeConfig('https://aeat.test/verifactu'));
    mockFetch(
      vi.fn(async () => new Response('upstream down', { status: 503 })) as unknown as typeof fetch,
    );
    await expect(client.submit(REQ)).rejects.toThrow(/503/);
  });

  it('throws on network failure', async () => {
    const client = new PreprodAeatClient(makeConfig('https://aeat.test/verifactu'));
    mockFetch(
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch,
    );
    await expect(client.submit(REQ)).rejects.toThrow(/ECONNRESET/);
  });

  it('aborts via AbortController if timeout fires', async () => {
    const client = new PreprodAeatClient(makeConfig('https://aeat.test/verifactu', 10));
    mockFetch(
      vi.fn(async (_url, init?: RequestInit) => {
        // Resolve once the signal aborts.
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
        return new Response('never', { status: 200 });
      }) as unknown as typeof fetch,
    );
    await expect(client.submit(REQ)).rejects.toThrow(/aborted/);
  });

  it('exposes mode = preprod', () => {
    const client = new PreprodAeatClient(makeConfig('https://aeat.test/verifactu'));
    expect(client.mode).toBe('preprod');
  });
});
