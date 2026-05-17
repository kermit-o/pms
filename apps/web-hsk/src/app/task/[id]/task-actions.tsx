'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Task } from '@/lib/api';
import { bootstrap, enqueue, flush, size, subscribe } from '@/lib/offline-queue';
import { InspectionPanel } from './inspection-panel';
import { VoiceButton } from './voice-button';
import type { RoomStatusKeyword } from './voice-keywords';

interface Props {
  task: Task;
}

type Online = boolean;

const ROOM_STATUSES = [
  { value: 'CLEAN', label: 'Limpia' },
  { value: 'INSPECTED', label: 'Inspeccionada' },
  { value: 'DIRTY', label: 'Sucia' },
  { value: 'OUT_OF_ORDER', label: 'Avería (OOO)' },
] as const;

export function TaskActions({ task }: Props) {
  const router = useRouter();
  const [online, setOnline] = useState<Online>(true);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [resultingRoomStatus, setResultingRoomStatus] = useState<string>('CLEAN');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bootstrap();
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    void size().then(setPending);
    const unsub = subscribe(() => {
      void size().then(setPending);
    });
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      unsub();
    };
  }, []);

  async function run(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      if (navigator.onLine) {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store',
        });
        if (!res.ok && res.status !== 409) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        await flush(); // opportunistically drain anything else.
        router.refresh();
      } else {
        await enqueue({ url, method: 'POST', body });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isPending = task.status === 'PENDING';
  const isInProgress = task.status === 'IN_PROGRESS';
  const isTerminal = task.status === 'COMPLETED' || task.status === 'CANCELLED';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs">
        <span
          className={`rounded-full px-2 py-1 font-medium ${
            online ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
          }`}
        >
          {online ? 'En línea' : 'Sin conexión'}
        </span>
        {pending > 0 && (
          <span className="rounded-full bg-aubergine-100 px-2 py-1 text-aubergine-700">
            {pending} pend. de sincronizar
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      {isPending && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(`/api/proxy/tasks/${task.id}/start`, {})}
          className="w-full rounded-xl bg-aubergine-600 py-4 text-base font-semibold text-white disabled:opacity-50"
        >
          Empezar limpieza
        </button>
      )}

      {isInProgress && (
        <>
          <VoiceButton
            onTranscript={(text) => setNotes((prev) => (prev ? `${prev} ${text}` : text))}
            onStatusKeyword={(status: RoomStatusKeyword) => setResultingRoomStatus(status)}
          />
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(`/api/proxy/tasks/${task.id}/complete`, {
              resultingRoomStatus,
              notes: notes.trim() || undefined,
            });
          }}
        >
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
              Estado de la habitación
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {ROOM_STATUSES.map((s) => (
                <label
                  key={s.value}
                  className={`flex cursor-pointer items-center justify-center rounded-lg border px-3 py-3 text-sm font-medium ${
                    resultingRoomStatus === s.value
                      ? 'border-aubergine-600 bg-aubergine-600 text-white'
                      : 'border-aubergine-100 bg-white text-aubergine-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="status"
                    value={s.value}
                    checked={resultingRoomStatus === s.value}
                    onChange={() => setResultingRoomStatus(s.value)}
                    className="sr-only"
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            Notas (opcional)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base focus:border-aubergine-500 focus:outline-none"
              placeholder="Discrepancias, avisos…"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-aubergine-700 py-4 text-base font-semibold text-white disabled:opacity-50"
          >
            Finalizar y reportar
          </button>
        </form>
        </>
      )}

      {isTerminal && (
        <>
          <p className="rounded-xl bg-aubergine-50 p-4 text-center text-sm text-aubergine-700">
            Tarea {task.status === 'COMPLETED' ? 'completada' : 'cancelada'}.
          </p>
          {task.status === 'COMPLETED' && <InspectionPanel taskId={task.id} />}
        </>
      )}
    </div>
  );
}
