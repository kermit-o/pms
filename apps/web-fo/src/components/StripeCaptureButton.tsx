'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { StripeCardCapture } from './StripeCardCapture';

export function StripeCaptureButton({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCapture() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/payments/setup-intent/${reservationId}`, { method: 'POST' });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      const data = (await res.json()) as { clientSecret: string; publishableKey: string };
      setClientSecret(data.clientSecret);
      setPublishableKey(data.publishableKey);
      setOpen(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={startCapture}
        disabled={busy}
        className="rounded-lg bg-aubergine-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-aubergine-800 disabled:opacity-50"
      >
        {busy ? 'Cargando…' : '💳 Capturar tarjeta (Stripe)'}
      </button>
      {error && (
        <p className="mt-1 text-[10px] text-rose-700">
          {error}
          {error.includes('STRIPE') && (
            <>
              {' '}— marca manual abajo o configura{' '}
              <code>STRIPE_SECRET_KEY</code> en el servidor.
            </>
          )}
        </p>
      )}
      <StripeCardCapture
        open={open}
        clientSecret={clientSecret}
        publishableKey={publishableKey}
        onClose={() => setOpen(false)}
        onSuccess={() => {
          setOpen(false);
          // Webhook actualizará el estado SECURED. Refrescamos para verlo.
          router.refresh();
        }}
      />
    </>
  );
}
