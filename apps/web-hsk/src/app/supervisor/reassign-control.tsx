'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Task } from '@/lib/api';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  task: Task;
}

export function ReassignControl({ task }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(task.assignedToUserId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTerminal = task.status === 'COMPLETED' || task.status === 'CANCELLED';
  if (isTerminal) {
    return <span className="text-xs text-aubergine-700/40">—</span>;
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const trimmed = value.trim();
      const assignedToUserId = trimmed === '' ? null : trimmed;
      if (assignedToUserId !== null && !UUID_RE.test(assignedToUserId)) {
        throw new Error('UUID inválido');
      }
      const res = await fetch(`/api/proxy/tasks/${task.id}/reassign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assignedToUserId }),
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error((await res.text()) || `HTTP ${res.status}`);
      }
      setOpen(false);
      router.refresh();
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
        className="rounded-lg bg-aubergine-50 px-3 py-1 text-xs font-medium text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-100"
      >
        Reasignar
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="user UUID o vacío"
          className="w-44 rounded-lg border border-aubergine-100 bg-white px-2 py-1 text-xs focus:border-aubergine-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="rounded-lg bg-aubergine-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          OK
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setValue(task.assignedToUserId ?? '');
            setError(null);
          }}
          className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-aubergine-700 ring-1 ring-aubergine-100"
        >
          ✕
        </button>
      </div>
      {error && <p className="text-[10px] text-red-700">{error}</p>}
    </div>
  );
}
