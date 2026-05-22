import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import {
  ApiError,
  listCopilotSessions,
  type CopilotSessionSummary,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Sprint 13 — Vista admin del Copilot: lista de sesiones recientes
 * del tenant para depurar prompt drift y revisar qué consulta el
 * operador con más frecuencia. Sólo `tenant_admin`.
 */
export default async function CopilotSessionsAdminPage() {
  const session = await auth();
  if (!session?.accessToken) redirect('/login?callbackUrl=/admin/copilot/sessions');
  if (!session.roles?.includes('tenant_admin')) {
    return notFound();
  }

  let sessions: CopilotSessionSummary[];
  try {
    sessions = await listCopilotSessions(session.accessToken, 100);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return notFound();
    }
    throw err;
  }

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

      <p className="text-[11px] text-aubergine-700/40">
        Muestra hasta 100 sesiones más recientes. Las sesiones se persisten
        completas (mensajes + widgets) en `copilot_messages`.
      </p>
    </main>
  );
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
