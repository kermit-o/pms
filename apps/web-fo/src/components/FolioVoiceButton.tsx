'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseVoiceFoCommand, type VoiceFoIntent } from '@/lib/voice-fo-grammar';

/**
 * Voice-first FO para el folio (Sprint 7 W1).
 *
 * La recepcionista pulsa el micro, dicta "carga 35 a la 305" / "cobra 50
 * en efectivo", y el componente pre-rellena el formulario de cargo o pago.
 * Cuesta cero infra — el reconocimiento es Web Speech API local (audio
 * nunca sale del browser, igual que W3 HSK).
 *
 * Pre-llena los inputs por `name` dentro del scope `formScopeSelector`
 * usando un input event nativo — los forms son server actions plain HTML.
 * El operador revisa y pulsa "Añadir cargo / Registrar pago" como
 * siempre (ADR-020 — nada se ejecuta sin confirmación humana).
 */
export function FolioVoiceButton({
  formScopeSelector,
}: {
  formScopeSelector: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [intent, setIntent] = useState<VoiceFoIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const Ctor =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSupported(Boolean(Ctor));
  }, []);

  const start = useCallback(() => {
    setError(null);
    setApplied(null);
    setTranscript('');
    setIntent(null);
    const Ctor =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'es-ES';
    rec.continuous = true;
    rec.interimResults = true;
    let interimText = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      interimText = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const r = event.results[i];
        const t = (r[0]?.transcript ?? '').trim();
        if (r.isFinal) finalText += ' ' + t;
        else interimText += ' ' + t;
      }
      const combined = (transcript + ' ' + finalText + ' ' + interimText).trim();
      setTranscript(combined);
      if (finalText) {
        const parsed = parseVoiceFoCommand(combined);
        if (parsed) setIntent(parsed);
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (event: any) => {
      const code = String(event?.error ?? 'unknown');
      if (code !== 'no-speech') setError(`Voz: ${code}`);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [transcript]);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  function applyToChargeForm() {
    if (!intent || intent.kind !== 'add_charge') return;
    const scope = document.querySelector(formScopeSelector);
    if (!scope) return;
    const chargeForm = scope.querySelector('form[action] input[name="description"]')?.closest('form');
    if (!chargeForm) return;
    fillInput(chargeForm, 'description', intent.description);
    fillInput(chargeForm, 'amount', intent.amount.toFixed(2));
    setApplied('Cargo pre-rellenado. Revisa y pulsa "Añadir cargo".');
  }

  function applyToPaymentForm() {
    if (!intent || intent.kind !== 'add_payment') return;
    const scope = document.querySelector(formScopeSelector);
    if (!scope) return;
    const forms = scope.querySelectorAll('form');
    // La 2ª form en el bloque es la de pagos (la 1ª es cargo).
    const paymentForm = forms[1];
    if (!paymentForm) return;
    fillInput(paymentForm, 'description', intent.description);
    fillInput(paymentForm, 'amount', intent.amount.toFixed(2));
    fillSelect(paymentForm, 'paymentMethod', intent.paymentMethod);
    setApplied('Pago pre-rellenado. Revisa y pulsa "Registrar pago".');
  }

  if (!supported) return null;

  return (
    <div className="rounded-2xl bg-aubergine-50/40 p-3 ring-1 ring-aubergine-100">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={listening ? stop : start}
          aria-label={listening ? 'Detener dictado' : 'Dictar cargo/pago'}
          className={`flex h-12 w-12 items-center justify-center rounded-full text-white shadow-md transition-all ${
            listening ? 'animate-pulse bg-rose-600' : 'bg-aubergine-700 hover:bg-aubergine-800'
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-6 w-6"
          >
            <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z" />
            <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.93V21h-2a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.07A7 7 0 0 0 19 11Z" />
          </svg>
        </button>
        <div className="flex-1 text-xs text-aubergine-700/80">
          {listening
            ? 'Escuchando… di "carga 35 a la 305" o "cobra 50 en efectivo"'
            : 'Dictar cargo o pago'}
        </div>
      </div>
      {transcript && (
        <p className="mt-2 rounded-lg bg-white/70 px-2 py-1 text-xs italic text-aubergine-700/70">
          “{transcript}”
        </p>
      )}
      {error && (
        <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1 text-xs text-rose-700 ring-1 ring-rose-200">
          {error}
        </p>
      )}
      {intent && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-aubergine-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white">
            {intent.kind === 'add_charge' ? 'Cargo' : 'Pago'}
          </span>
          <span className="text-xs text-aubergine-800">
            {intent.amount.toFixed(2)} · {intent.description}
            {intent.kind === 'add_charge' && intent.roomNumber && ` · hab. ${intent.roomNumber}`}
            {intent.kind === 'add_payment' && ` · ${intent.paymentMethod}`}
          </span>
          {intent.kind === 'add_charge' && (
            <button
              type="button"
              onClick={applyToChargeForm}
              className="ml-auto rounded-lg bg-aubergine-700 px-2 py-1 text-[11px] text-white hover:bg-aubergine-800"
            >
              Aplicar al cargo
            </button>
          )}
          {intent.kind === 'add_payment' && (
            <button
              type="button"
              onClick={applyToPaymentForm}
              className="ml-auto rounded-lg bg-emerald-600 px-2 py-1 text-[11px] text-white hover:bg-emerald-700"
            >
              Aplicar al pago
            </button>
          )}
        </div>
      )}
      {applied && (
        <p className="mt-2 rounded-lg bg-emerald-50 px-2 py-1 text-xs text-emerald-800 ring-1 ring-emerald-200">
          ✓ {applied}
        </p>
      )}
    </div>
  );
}

function fillInput(form: Element, name: string, value: string) {
  const el = form.querySelector(`[name="${name}"]`) as HTMLInputElement | null;
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
function fillSelect(form: Element, name: string, value: string) {
  const el = form.querySelector(`[name="${name}"]`) as HTMLSelectElement | null;
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
