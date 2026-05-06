'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  initialTenantId: string;
  initialCode: string;
}

export function LoginQrForm({ initialTenantId, initialCode }: Props) {
  const router = useRouter();
  const [tenantId, setTenantId] = useState(initialTenantId);
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanCode = code.replace(/[-\s]/g, '').toUpperCase();
    if (!UUID_RE.test(tenantId.trim())) {
      setError('Tenant inválido');
      return;
    }
    if (!/^[A-Z0-9]{12}$/.test(cleanCode)) {
      setError('El código son 12 caracteres');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/proxy/pairings/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId: tenantId.trim(), code: cleanCode }),
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error((await res.text()) || `HTTP ${res.status}`);
      }
      router.push('/');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100"
    >
      <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
        Tenant (UUID)
        <input
          type="text"
          required
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          placeholder="UUID"
          className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 font-mono text-sm focus:border-aubergine-500 focus:outline-none"
        />
      </label>
      <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
        Código
        <input
          type="text"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD-EFGH-JKLM"
          className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-3 text-center font-mono text-2xl tracking-[0.3em] focus:border-aubergine-500 focus:outline-none"
        />
      </label>
      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-aubergine-600 py-4 text-base font-semibold text-white disabled:opacity-50"
      >
        Iniciar turno
      </button>
    </form>
  );
}
