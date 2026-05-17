'use client';

import { useEffect, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';

/**
 * Captura de tarjeta (SetupIntent) desde el IBE público.
 * Reusa el flow del back-office vía API pública. Idéntico a web-fo
 * salvo que aquí la verificación es `code + lastName` (no auth).
 *
 * Audio jamás-pero-aquí-data: el PAN nunca toca nuestros servidores.
 * Stripe Elements tokeniza directamente.
 */
export function StripeCardCapture({
  slug,
  code,
  lastName,
  lang,
}: {
  slug: string;
  code: string;
  lastName: string;
  lang: 'es' | 'en';
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ brand: string | null; last4: string | null } | null>(null);

  useEffect(() => {
    if (publishableKey) setStripePromise(loadStripe(publishableKey));
  }, [publishableKey]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/setup-intent?slug=${encodeURIComponent(slug)}&code=${encodeURIComponent(code)}&lastName=${encodeURIComponent(lastName)}`,
        { method: 'POST' },
      );
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      const data = (await res.json()) as { clientSecret: string; publishableKey: string };
      setClientSecret(data.clientSecret);
      setPublishableKey(data.publishableKey);
      setOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">
        ✓{' '}
        {lang === 'es' ? 'Tarjeta guardada' : 'Card on file'}{' '}
        {success.brand ? `· ${success.brand}` : ''}
        {success.last4 ? ` **** ${success.last4}` : ''}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="rounded-xl bg-aubergine-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-aubergine-800 disabled:opacity-50"
      >
        {busy
          ? lang === 'es'
            ? 'Cargando…'
            : 'Loading…'
          : lang === 'es'
            ? '💳 Capturar tarjeta'
            : '💳 Add card'}
      </button>
      {error && (
        <p className="mt-2 text-xs text-rose-700">{error}</p>
      )}
      {open && clientSecret && stripePromise && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-aubergine-700">
                {lang === 'es' ? 'Tu tarjeta' : 'Your card'}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-aubergine-700/60 hover:text-aubergine-700"
              >
                ✕
              </button>
            </div>
            <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'flat' } }}>
              <CardForm
                slug={slug}
                code={code}
                lastName={lastName}
                lang={lang}
                onSuccess={(brand, last4) => {
                  setSuccess({ brand, last4 });
                  setOpen(false);
                }}
                onClose={() => setOpen(false)}
              />
            </Elements>
          </div>
        </div>
      )}
    </>
  );
}

function CardForm({
  slug,
  code,
  lastName,
  lang,
  onSuccess,
  onClose,
}: {
  slug: string;
  code: string;
  lastName: string;
  lang: 'es' | 'en';
  onSuccess: (brand: string | null, last4: string | null) => void;
  onClose: () => void;
}) {
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
        setError(stripeError.message ?? 'Error');
        return;
      }
      if (setupIntent?.status === 'succeeded') {
        const res = await fetch(
          `/api/confirm-setup-intent?slug=${encodeURIComponent(slug)}&code=${encodeURIComponent(code)}&lastName=${encodeURIComponent(lastName)}`,
          { method: 'POST' },
        );
        if (!res.ok) {
          setError(await res.text());
          return;
        }
        const data = (await res.json()) as { brand: string | null; last4: string | null };
        onSuccess(data.brand, data.last4);
      } else {
        setError(`Estado inesperado: ${setupIntent?.status ?? '?'}`);
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
        <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800 ring-1 ring-rose-200">{error}</div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-lg bg-white px-4 py-2 text-sm text-aubergine-700 ring-1 ring-aubergine-100 disabled:opacity-50"
        >
          {lang === 'es' ? 'Cancelar' : 'Cancel'}
        </button>
        <button
          type="submit"
          disabled={busy || !stripe || !elements}
          className="rounded-lg bg-aubergine-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? (lang === 'es' ? 'Procesando…' : 'Processing…') : lang === 'es' ? 'Confirmar' : 'Confirm'}
        </button>
      </div>
    </form>
  );
}
