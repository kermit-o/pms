'use client';

import { useEffect, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';

/**
 * Modal client-side que abre Stripe Elements para capturar tarjeta.
 * No guarda PAN — todo se tokeniza directamente contra Stripe.
 *
 * El padre setea isOpen=true tras pedirle al backend el SetupIntent
 * (que devuelve clientSecret + publishableKey).
 */
export function StripeCardCapture({
  open,
  clientSecret,
  publishableKey,
  onClose,
  onSuccess,
}: {
  open: boolean;
  clientSecret: string | null;
  publishableKey: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);

  useEffect(() => {
    if (publishableKey) {
      setStripePromise(loadStripe(publishableKey));
    }
  }, [publishableKey]);

  if (!open || !clientSecret || !stripePromise) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-aubergine-700">Capturar tarjeta</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-aubergine-700/60 hover:text-aubergine-700"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-aubergine-700/60">
          La tarjeta se tokeniza en Stripe. No guardamos el número completo.
        </p>
        <Elements
          stripe={stripePromise}
          options={{ clientSecret, appearance: { theme: 'flat' } }}
        >
          <CardForm onSuccess={onSuccess} onClose={onClose} />
        </Elements>
      </div>
    </div>
  );
}

function CardForm({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    try {
      const { error: stripeError, setupIntent } = await stripe.confirmSetup({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
      if (stripeError) {
        setError(stripeError.message ?? 'Error con la tarjeta');
        return;
      }
      if (setupIntent && setupIntent.status === 'succeeded') {
        onSuccess();
      } else {
        setError('Estado inesperado: ' + (setupIntent?.status ?? 'desconocido'));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <PaymentElement />
      {error && (
        <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800 ring-1 ring-rose-200">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-lg bg-white px-4 py-2 text-sm text-aubergine-700 ring-1 ring-aubergine-100 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={busy || !stripe || !elements}
          className="rounded-lg bg-aubergine-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Procesando…' : 'Confirmar tarjeta'}
        </button>
      </div>
    </form>
  );
}
