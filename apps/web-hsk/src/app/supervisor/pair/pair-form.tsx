'use client';

import { useState } from 'react';

interface MintedPairing {
  code: string;
  tenantId: string;
  expiresAt: string;
  qrPayload: string;
  deepLink: string;
  qrSvg: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function PairForm() {
  const [targetUserId, setTargetUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<MintedPairing | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!UUID_RE.test(targetUserId.trim())) {
      setError('UUID inválido');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/proxy/pairings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetUserId: targetUserId.trim() }),
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error((await res.text()) || `HTTP ${res.status}`);
      }
      setMinted((await res.json()) as MintedPairing);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={onSubmit}
        className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100"
      >
        <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Camarera (user UUID)
          <input
            type="text"
            value={targetUserId}
            onChange={(e) => setTargetUserId(e.target.value)}
            placeholder="UUID"
            className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 font-mono text-sm focus:border-aubergine-500 focus:outline-none"
          />
        </label>
        {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-aubergine-600 py-3 text-base font-semibold text-white disabled:opacity-50"
        >
          Generar código
        </button>
      </form>

      {minted && (
        <section className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100">
          <p className="text-xs uppercase tracking-wide text-aubergine-500">
            Apunta la cámara del móvil de la camarera (válido hasta{' '}
            {new Date(minted.expiresAt).toLocaleTimeString('es-ES')})
          </p>

          <div
            className="mx-auto aspect-square w-full max-w-[280px] rounded-xl bg-white p-3 ring-1 ring-aubergine-100 [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: minted.qrSvg }}
          />

          <p className="select-all rounded-xl bg-aubergine-50 p-3 text-center font-mono text-2xl font-semibold tracking-[0.4em] text-aubergine-700">
            {minted.code.slice(0, 4)}-{minted.code.slice(4, 8)}-{minted.code.slice(8, 12)}
          </p>

          <div className="space-y-1 text-xs text-aubergine-700/70">
            <p>
              ¿Cámara fallando? La camarera puede teclear el código en{' '}
              <code className="rounded bg-aubergine-50 px-1 py-0.5 font-mono">/login/qr</code>.
            </p>
            <p className="break-all font-mono text-[10px]">
              <a href={minted.deepLink} className="text-aubergine-600 underline">
                {minted.deepLink}
              </a>
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
