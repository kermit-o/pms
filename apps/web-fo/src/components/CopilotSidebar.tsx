'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CopilotSession } from '@/lib/api';

/**
 * Aubergine FO copilot. The component owns its own session lifecycle:
 *  - on first open, posts /api/copilot/sessions and stores the id locally;
 *  - sends the operator message to /api/copilot/sessions/:id/messages;
 *  - renders pending-tool cards with Approve / Reject buttons that call
 *    /api/copilot/sessions/:id/confirm-tool.
 *
 * The component is intentionally simple — pollute-free state, no client
 * deps beyond React. Production hardening (streaming, retries, persistence
 * across reloads) is a follow-up task.
 */
export default function CopilotSidebar() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<CopilotSession | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (session) return session.sessionId;
    setBusy(true);
    try {
      const res = await fetch('/api/copilot/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { sessionId: string };
      const empty: CopilotSession = {
        sessionId: data.sessionId,
        propertyId: null,
        createdAt: new Date().toISOString(),
        messages: [],
        pendingTools: [],
      };
      setSession(empty);
      return data.sessionId;
    } finally {
      setBusy(false);
    }
  }, [session]);

  // Open with Cmd+K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function send(): Promise<void> {
    if (!draft.trim() || busy) return;
    setError(null);
    setBusy(true);
    try {
      const sessionId = await ensureSession();
      const res = await fetch(`/api/copilot/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: draft.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = (await res.json()) as CopilotSession;
      setSession(updated);
      setDraft('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(pendingToolId: string, decision: 'approve' | 'reject'): Promise<void> {
    if (!session || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/copilot/sessions/${session.sessionId}/confirm-tool`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pendingToolId, decision }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = (await res.json()) as CopilotSession;
      setSession(updated);

      // Si el tool aprobado creó una reserva, salta al detalle.
      if (decision === 'approve') {
        const pending = updated.pendingTools.find((p) => p.id === pendingToolId);
        if (pending?.tool === 'create_reservation' && pending.status === 'approved') {
          // El último mensaje contiene el id de la reserva creada en su JSON.
          const last = updated.messages[updated.messages.length - 1];
          const m = last?.content.match(/"id"\s*:\s*"([0-9a-f-]{36})"/i);
          if (m) {
            window.location.href = `/reservations/${m[1]}`;
            return;
          }
        }
      }
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
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-aubergine-700 px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:bg-aubergine-900"
        aria-label="Abrir copiloto"
      >
        <span aria-hidden>✦</span> Copilot
        <kbd className="rounded bg-white/20 px-1 text-[10px]">⌘K</kbd>
      </button>

      {open && (
        <aside
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-aubergine-100 bg-white shadow-2xl"
          aria-label="Aubergine copilot"
        >
          <header className="flex items-start justify-between border-b border-aubergine-100 p-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">Aubergine</p>
              <h2 className="text-lg font-semibold text-aubergine-700">Copilot</h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg bg-aubergine-50 px-2 py-1 text-xs font-medium text-aubergine-700 hover:bg-aubergine-100"
            >
              Cerrar
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
            {!session && (
              <p className="text-aubergine-700/60">
                Pregúntame por disponibilidad, asignación de habitación o check-in. Las acciones
                financieras siempre requieren tu confirmación.
              </p>
            )}
            {session?.messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === 'user'
                    ? 'ml-8 rounded-2xl rounded-br-sm bg-aubergine-600 px-3 py-2 text-white'
                    : 'mr-8 rounded-2xl rounded-bl-sm bg-aubergine-50 px-3 py-2 text-aubergine-900'
                }
              >
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                  {m.content}
                </pre>
                {m.pendingToolId && (
                  <PendingToolCard
                    pending={session.pendingTools.find((p) => p.id === m.pendingToolId)}
                    onApprove={() => decide(m.pendingToolId!, 'approve')}
                    onReject={() => decide(m.pendingToolId!, 'reject')}
                    busy={busy}
                  />
                )}
              </div>
            ))}
            {error && (
              <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800 ring-1 ring-rose-100">
                {error}
              </div>
            )}
          </div>

          <form
            className="border-t border-aubergine-100 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Pregunta o instrucción…"
              rows={2}
              className="w-full resize-none rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="mt-2 flex justify-between text-xs text-aubergine-700/60">
              <span>Enter para enviar · ⇧+Enter salto de línea</span>
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="rounded-lg bg-aubergine-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-aubergine-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Enviar
              </button>
            </div>
          </form>
        </aside>
      )}
    </>
  );
}

function PendingToolCard({
  pending,
  onApprove,
  onReject,
  busy,
}: {
  pending:
    | {
        id: string;
        tool: string;
        input: unknown;
        financial: boolean;
        status: string;
      }
    | undefined;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  if (!pending) return null;
  const decided = pending.status !== 'pending';
  return (
    <div
      className={`mt-2 rounded-xl p-3 text-xs ring-1 ${
        pending.financial ? 'bg-amber-50 ring-amber-200' : 'bg-white ring-aubergine-100'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] font-semibold text-aubergine-700">{pending.tool}</p>
          {pending.financial && (
            <p className="text-[10px] uppercase tracking-wide text-amber-700">acción financiera</p>
          )}
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            pending.status === 'approved'
              ? 'bg-emerald-100 text-emerald-800'
              : pending.status === 'rejected'
                ? 'bg-rose-100 text-rose-800'
                : pending.status === 'failed'
                  ? 'bg-rose-200 text-rose-900'
                  : 'bg-aubergine-100 text-aubergine-700'
          }`}
        >
          {pending.status}
        </span>
      </div>
      <ToolInputSummary tool={pending.tool} input={pending.input} />
      {!decided && (
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-50 disabled:opacity-50"
          >
            Rechazar
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="rounded-lg bg-aubergine-700 px-2 py-1 text-xs font-medium text-white hover:bg-aubergine-900 disabled:opacity-50"
          >
            Aprobar
          </button>
        </div>
      )}
    </div>
  );
}

// Renderizado natural del tool input para que el operador entienda qué se
// va a ejecutar sin leer JSON. Si el shape no encaja, cae a JSON crudo.
function ToolInputSummary({ tool, input }: { tool: string; input: unknown }) {
  const obj = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;
  const rows: Array<[string, string]> = [];

  if (tool === 'create_reservation') {
    const guest = obj.guest as Record<string, unknown> | undefined;
    const occ = obj.occupancy as Record<string, unknown> | undefined;
    if (obj.arrival && obj.departure) {
      const nights = nightsBetween(obj.arrival as string, obj.departure as string);
      rows.push(['Estancia', `${obj.arrival} → ${obj.departure} · ${nights} noches`]);
    }
    if (occ) {
      const adults = Number(occ.adults ?? 0);
      const children = Number(occ.children ?? 0);
      rows.push(['Huéspedes', `${adults} adultos${children ? ` + ${children} niños` : ''}`]);
    }
    if (guest) {
      if (guest.firstName || guest.lastName) {
        rows.push(['Huésped', `${guest.firstName ?? ''} ${guest.lastName ?? ''}`.trim()]);
      }
      if (guest.email) rows.push(['Email', String(guest.email)]);
      if (guest.phone) rows.push(['Teléfono', String(guest.phone)]);
    }
    if (obj.roomTypeId) {
      rows.push(['Tipo habitación', String(obj.roomTypeId).slice(0, 8) + '…']);
    }
  } else if (tool === 'create_reservation_group') {
    if (obj.name) rows.push(['Grupo', String(obj.name)]);
    const reservations = Array.isArray(obj.reservations) ? obj.reservations : [];
    if (reservations.length > 0) {
      rows.push(['Reservas', `${reservations.length}`]);
      const byType = new Map<string, number>();
      for (const r of reservations as Record<string, unknown>[]) {
        const rt = String(r.roomTypeId ?? '???').slice(0, 8);
        byType.set(rt, (byType.get(rt) ?? 0) + 1);
      }
      rows.push([
        'Distribución',
        Array.from(byType.entries())
          .map(([k, v]) => `${v}×${k}…`)
          .join(' · '),
      ]);
      const firstArrival = (reservations[0] as Record<string, unknown>).arrival;
      const firstDeparture = (reservations[0] as Record<string, unknown>).departure;
      if (firstArrival && firstDeparture) {
        rows.push(['Fechas', `${firstArrival} → ${firstDeparture}`]);
      }
    }
    if (obj.organizerName) rows.push(['Organizador', String(obj.organizerName)]);
  } else if (tool === 'check_in' || tool === 'check_out') {
    if (obj.reservationId) rows.push(['Reserva', String(obj.reservationId).slice(0, 8) + '…']);
    if (obj.roomId) rows.push(['Habitación', String(obj.roomId).slice(0, 8) + '…']);
  } else if (tool === 'add_folio_charge') {
    if (obj.folioId) rows.push(['Folio', String(obj.folioId).slice(0, 8) + '…']);
    if (obj.description) rows.push(['Concepto', String(obj.description)]);
    if (obj.amount !== undefined) rows.push(['Importe', `${obj.amount} EUR`]);
    if (obj.type) rows.push(['Tipo', String(obj.type)]);
  } else if (tool === 'assign_room') {
    if (obj.reservationId) rows.push(['Reserva', String(obj.reservationId).slice(0, 8) + '…']);
    if (obj.roomId) rows.push(['Habitación', String(obj.roomId).slice(0, 8) + '…']);
  } else if (tool === 'hsk_assign_task') {
    if (obj.taskId) rows.push(['Tarea', String(obj.taskId).slice(0, 8) + '…']);
    if (obj.assignedToUserId)
      rows.push(['Asignar a', String(obj.assignedToUserId).slice(0, 8) + '…']);
  }

  if (rows.length === 0) {
    return (
      <pre className="mt-2 overflow-auto rounded bg-aubergine-50/80 p-2 text-[11px] text-aubergine-900">
        {JSON.stringify(input, null, 2)}
      </pre>
    );
  }

  return (
    <div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded bg-aubergine-50/80 p-2 text-[11px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-medium text-aubergine-700/70">{k}</dt>
            <dd className="text-aubergine-900">{v}</dd>
          </div>
        ))}
      </dl>
      <details className="mt-1">
        <summary className="cursor-pointer text-[10px] text-aubergine-700/60 hover:text-aubergine-700">
          Ver JSON crudo
        </summary>
        <pre className="mt-1 overflow-auto rounded bg-aubergine-50/40 p-2 text-[10px] text-aubergine-900">
          {JSON.stringify(input, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function nightsBetween(arrival: string, departure: string): number {
  const a = new Date(arrival);
  const d = new Date(departure);
  return Math.max(1, Math.round((d.getTime() - a.getTime()) / 86_400_000));
}
