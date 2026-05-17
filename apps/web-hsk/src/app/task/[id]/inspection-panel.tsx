'use client';

import { useState } from 'react';
import type { InspectionResult } from '@/lib/api';

/**
 * Inspección visual post-limpieza (Sprint 7 W3).
 *
 * La camarera (o el supervisor que abre la tarea ya completada) sube una
 * foto del cuarto limpio. Claude Vision la clasifica `clean | dirty |
 * damaged` con razonamiento y la API guarda el resultado en
 * `housekeeping_tasks.attributes.inspection`. Si `damaged`, la habitación
 * pasa a OOO automáticamente (server-side).
 *
 * No hay flujo offline para esta acción — necesita conexión a Anthropic.
 * Si el operador está sin conexión, el panel muestra el botón pero el
 * fetch fallará y la app reportará el error.
 */
export function InspectionPanel({ taskId }: { taskId: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InspectionResult | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      setError('Foto > 6MB. Reduce calidad o redimensiona.');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setDataUrl(String(reader.result));
    reader.onerror = () => setError('No pude leer el fichero');
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (!dataUrl) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/proxy/tasks/${taskId}/inspect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageBase64: dataUrl }),
        cache: 'no-store',
      });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      const data = (await res.json()) as InspectionResult;
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-aubergine-700">Inspección visual</h3>
        <span className="rounded-full bg-aubergine-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-aubergine-700">
          Claude Vision
        </span>
      </div>
      <p className="text-xs text-aubergine-700/60">
        Sube una foto de la habitación lista. El sistema decide si está
        limpia, sucia o necesita mantenimiento. Si detecta daño, la habitación
        pasa a OOO automáticamente.
      </p>

      <input
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFile}
        className="block w-full text-xs"
      />

      {dataUrl && (
        <img
          src={dataUrl}
          alt="Foto de inspección"
          className="max-h-64 w-full rounded-lg object-contain ring-1 ring-aubergine-100"
        />
      )}

      {error && (
        <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800 ring-1 ring-rose-200">
          {error}
        </div>
      )}

      <button
        type="button"
        disabled={!dataUrl || busy}
        onClick={() => void submit()}
        className="w-full rounded-xl bg-aubergine-700 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Analizando…' : 'Inspeccionar'}
      </button>

      {result && (
        <div
          className={`rounded-xl p-3 text-sm ring-1 ${
            result.verdict === 'clean'
              ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
              : result.verdict === 'dirty'
                ? 'bg-amber-50 text-amber-900 ring-amber-200'
                : 'bg-rose-50 text-rose-900 ring-rose-200'
          }`}
        >
          <p className="text-sm font-semibold capitalize">
            {result.verdict}{' '}
            <span className="text-xs font-normal">({Math.round(result.confidence * 100)}%)</span>
          </p>
          {result.reasoning && <p className="mt-1 text-xs italic">{result.reasoning}</p>}
          {result.issues.length > 0 && (
            <ul className="mt-2 list-disc pl-4 text-xs">
              {result.issues.map((i, n) => (
                <li key={n}>{i}</li>
              ))}
            </ul>
          )}
          {result.verdict === 'damaged' && (
            <p className="mt-2 text-xs font-semibold">
              La habitación ha pasado a OOO. Avisa a mantenimiento.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
