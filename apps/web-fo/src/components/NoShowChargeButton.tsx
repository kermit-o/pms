'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NoShowChargeResult } from '@/lib/api';

/**
 * Stripe Fase 2 — cobro off-session de no-show contra la tarjeta tokenizada
 * en Fase 1. Solo aparece cuando la reserva está NO_SHOW y tiene tarjeta
 * (stripeCardLast4 + guarantee SECURED).
 *
 * Idempotente server-side: re-pulsar el botón no duplica el cargo.
 */
export function NoShowChargeButton({
  reservationId,
  defaultAmount,
  currency,
  cardBrand,
  cardLast4,
}: {
  reservationId: string;
  defaultAmount: number;
  currency: string;
  cardBrand: string | null;
  cardLast4: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>(defaultAmount.toFixed(2));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NoShowChargeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/payments/charge-no-show/${reservationId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: Number(amount),
          description: `Cobro no-show ${currency}`,
        }),
      });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      const data = (await res.json()) as NoShowChargeResult;
      setResult(data);
      if (data.status === 'succeeded' || data.status === 'already_charged') {
        // Refresca el folio en la página.
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800"
      >
        💳 Cobrar no-show ({currency})
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-rose-200"
    >
      <p className="text-xs text-aubergine-700/70">
        Cargar a {cardBrand ? `${cardBrand} ` : 'tarjeta '}
        ****{cardLast4 ?? '----'}. El cargo es off-session — si el banco pide SCA
        el operador deberá retomar en presencia del huésped.
      </p>
      <label className="block text-xs text-aubergine-700">
        Importe ({currency})
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="block w-full rounded-lg ring-1 ring-aubergine-100 px-2 py-1 text-sm"
        />
      </label>
      {error && (
        <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800 ring-1 ring-rose-200">
          {error}
        </div>
      )}
      {result && (
        <div
          className={`rounded-lg p-2 text-xs ring-1 ${
            result.status === 'succeeded'
              ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
              : result.status === 'already_charged'
                ? 'bg-aubergine-50 text-aubergine-800 ring-aubergine-200'
                : 'bg-rose-50 text-rose-800 ring-rose-200'
          }`}
        >
          {result.status === 'succeeded' && `✓ Cobrado. PaymentIntent ${result.paymentIntentId}`}
          {result.status === 'already_charged' && '✓ Ya cobrado previamente (idempotente).'}
          {result.status === 'requires_action' &&
            'El banco pide autenticación adicional (SCA). Toma la tarjeta in-person.'}
          {result.status === 'failed' && `Falló: ${result.error}`}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
            setError(null);
          }}
          disabled={busy}
          className="rounded-lg bg-white px-3 py-1.5 text-xs text-aubergine-700 ring-1 ring-aubergine-100 disabled:opacity-50"
        >
          Cerrar
        </button>
        <button
          type="submit"
          disabled={busy || !amount || Number(amount) <= 0}
          className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Cobrando…' : 'Confirmar cobro'}
        </button>
      </div>
    </form>
  );
}
