import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import {
  ApiError,
  listCopilotSessionUsers,
  listCopilotSessions,
  type CopilotSessionSummary,
  type CopilotSessionUser,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    userId?: string;
    from?: string;
    to?: string;
    before?: string;
  }>;
}

/**
 * Sprint 13 — Vista admin del Copilot: lista de sesiones recientes
 * del tenant para depurar prompt drift y revisar qué consulta el
 * operador con más frecuencia. Sólo `tenant_admin`.
 *
 * Filtros V1: userId, ventana from/to, cursor `before` (paginación
 * hacia atrás).
 */
export default async function CopilotSessionsAdminPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const session = await auth();
  if (!session?.accessToken) redirect('/admin/copilot/sessions');
  if (!session.roles?.includes('tenant_admin')) {
    return notFound();
  }

  const filters = {
    limit: 50,
    userId: sp.userId || undefined,
    from: sp.from ? `${sp.from}T00:00:00Z` : undefined,
    to: sp.to ? `${sp.to}T23:59:59Z` : undefined,
    before: sp.before || undefined,
  };

  let sessions: CopilotSessionSummary[];
  let users: CopilotSessionUser[];
  try {
    [sessions, users] = await Promise.all([
      listCopilotSessions(session.accessToken, filters),
      listCopilotSessionUsers(session.accessToken),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return notFound();
    }
    throw err;
  }

  // Cursor para "older →": último timestamp de la página actual.
  const olderCursor =
    sessions.length === filters.limit
      ? sessions[sessions.length - 1]!.lastActivityAt
      : null;
  const hasActiveFilter = Boolean(sp.userId || sp.from || sp.to || sp.before);

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Admin
        </p>
        <h1 className="text-3xl font-semibold text-aubergine-700">Copilot · Sesiones</h1>
        <p className="mt-1 text-sm text-aubergine-700/70">
          Historial reciente de conversaciones del asistente. Útil para auditar
          la operativa, detectar consultas frecuentes y depurar respuestas raras
          del modelo.
        </p>
      </header>

      <form
        action="/admin/copilot/sessions"
        method="get"
        className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-aubergine-100"
      >
        <label className="text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Desde
          <input
            name="from"
            type="date"
            defaultValue={sp.from ?? ''}
            className="mt-1 block rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
          />
        </label>
        <label className="text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Hasta
          <input
            name="to"
            type="date"
            defaultValue={sp.to ?? ''}
            className="mt-1 block rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
          />
        </label>
        <label className="text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Operador
          <select
            name="userId"
            defaultValue={sp.userId ?? ''}
            className="mt-1 block w-64 rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
          >
            <option value="">— todos —</option>
            {users.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.fullName ?? u.email ?? u.userId.slice(0, 8)} ({u.messageCount})
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg bg-aubergine-700 px-3 py-2 text-sm font-semibold text-white hover:bg-aubergine-800"
        >
          Filtrar
        </button>
        {hasActiveFilter && (
          <Link
            href="/admin/copilot/sessions"
            className="rounded-lg bg-white px-3 py-2 text-sm text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-50"
          >
            Limpiar
          </Link>
        )}
      </form>

      {sessions.length === 0 ? (
        <p className="rounded-xl bg-aubergine-50 px-4 py-6 text-sm text-aubergine-700/70">
          Aún no hay conversaciones registradas en este tenant.
        </p>
      ) : (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100">
          <table className="w-full text-sm">
            <thead className="bg-aubergine-50 text-left text-xs uppercase tracking-wide text-aubergine-500">
              <tr>
                <th className="px-4 py-2">Última actividad</th>
                <th className="px-4 py-2">Primer mensaje</th>
                <th className="px-4 py-2 text-right">Mensajes</th>
                <th className="px-4 py-2 text-right">Widgets</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-aubergine-100/70">
              {sessions.map((s) => (
                <tr key={s.sessionId} className="hover:bg-aubergine-50/40">
                  <td className="px-4 py-2 align-top text-aubergine-700/80">
                    <p>{formatDateTime(s.lastActivityAt)}</p>
                    <p className="text-[10px] text-aubergine-700/40">
                      Inicio: {formatDateTime(s.firstMessageAt)}
                    </p>
                  </td>
                  <td className="px-4 py-2 align-top">
                    {s.firstMessage ? (
                      <p className="text-aubergine-900">{s.firstMessage}</p>
                    ) : (
                      <p className="italic text-aubergine-700/50">
                        (sin mensaje del operador)
                      </p>
                    )}
                    <p className="mt-0.5 font-mono text-[10px] text-aubergine-700/40">
                      {s.sessionId.slice(0, 8)} · usuario {s.userId.slice(0, 8)}
                    </p>
                  </td>
                  <td className="px-4 py-2 text-right align-top font-mono text-aubergine-700/70">
                    {s.messageCount}
                  </td>
                  <td className="px-4 py-2 text-right align-top">
                    {s.widgetCount > 0 ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-mono text-emerald-700">
                        {s.widgetCount}
                      </span>
                    ) : (
                      <span className="text-aubergine-700/30">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right align-top">
                    <Link
                      href={`/admin/copilot/sessions/${s.sessionId}`}
                      className="text-xs text-aubergine-700 hover:underline"
                    >
                      Ver →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-aubergine-700/40">
          Página de 50 sesiones. Persistido en `copilot_messages` (mensajes +
          widgets).
        </p>
        {olderCursor && (
          <Link
            href={buildOlderHref(sp, olderCursor)}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-50"
          >
            ← Más antiguas
          </Link>
        )}
      </div>
    </main>
  );
}

function buildOlderHref(
  sp: { userId?: string; from?: string; to?: string },
  before: string,
): string {
  const params = new URLSearchParams();
  if (sp.userId) params.set('userId', sp.userId);
  if (sp.from) params.set('from', sp.from);
  if (sp.to) params.set('to', sp.to);
  params.set('before', before);
  return `/admin/copilot/sessions?${params.toString()}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
