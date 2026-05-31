import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ApiError, getCopilotSession, type CopilotSession } from '@/lib/api';
import { CopilotAvailabilityWidget } from '@/components/CopilotAvailabilityWidget';
import { CopilotFolioWidget } from '@/components/CopilotFolioWidget';
import { CopilotHskSuggestWidget } from '@/components/CopilotHskSuggestWidget';
import { CopilotHskTasksWidget } from '@/components/CopilotHskTasksWidget';
import { CopilotMovementsWidget } from '@/components/CopilotMovementsWidget';
import { CopilotReservationWidget } from '@/components/CopilotReservationWidget';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Sprint 13 — Detalle admin de una sesión del Copilot. Re-renderiza el
 * transcript completo con los widgets estructurados tal cual los vio el
 * operador en su día, usando los componentes compartidos. Sólo
 * `tenant_admin`.
 */
export default async function CopilotSessionAdminDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await auth();
  if (!session?.accessToken) redirect(`/login?callbackUrl=/admin/copilot/sessions/${id}`);
  if (!session.roles?.includes('tenant_admin')) return notFound();

  let view: CopilotSession;
  try {
    view = await getCopilotSession(session.accessToken, id);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
      return notFound();
    }
    throw err;
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-6 py-10">
      <Link href="/admin/copilot/sessions" className="text-sm text-aubergine-500 hover:underline">
        ← Volver al listado
      </Link>
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Admin · Copilot
        </p>
        <h1 className="font-mono text-xl text-aubergine-700">{view.sessionId}</h1>
        <p className="mt-1 text-xs text-aubergine-700/60">
          {view.messages.length} mensajes · creada {formatDateTime(view.createdAt)}
        </p>
      </header>

      {view.messages.length === 0 && (
        <p className="rounded-xl bg-aubergine-50 px-4 py-6 text-sm text-aubergine-700/60">
          Sin mensajes en esta sesión.
        </p>
      )}

      <ol className="space-y-3">
        {view.messages.map((m) => (
          <li
            key={m.id}
            className={
              m.role === 'user'
                ? 'ml-12 rounded-2xl rounded-br-sm bg-aubergine-600 px-4 py-3 text-white'
                : 'mr-12 rounded-2xl rounded-bl-sm bg-aubergine-50 px-4 py-3 text-aubergine-900'
            }
          >
            <p className="text-[10px] uppercase tracking-wide opacity-70">
              {m.role === 'user' ? 'Operador' : 'Aubergine'} · {formatDateTime(m.createdAt)}
            </p>
            <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
              {m.content}
            </pre>
            {m.widgets?.map((w, idx) => {
              if (w.kind === 'availability')
                return <CopilotAvailabilityWidget key={idx} widget={w} />;
              if (w.kind === 'folio') return <CopilotFolioWidget key={idx} widget={w} />;
              if (w.kind === 'reservation')
                return <CopilotReservationWidget key={idx} widget={w} />;
              if (w.kind === 'hsk_tasks') return <CopilotHskTasksWidget key={idx} widget={w} />;
              if (w.kind === 'movements') return <CopilotMovementsWidget key={idx} widget={w} />;
              if (w.kind === 'hsk_suggest') return <CopilotHskSuggestWidget key={idx} widget={w} />;
              return null;
            })}
          </li>
        ))}
      </ol>

      <p className="text-[11px] text-aubergine-700/40">
        Vista de auditoría — los widgets se rehidratan desde `copilot_messages.widgets`. Las
        tarjetas de confirmación de tools mutating (pendingTool) no se restauran tras reload: si la
        sesión se cargó desde DB, sólo aparece el mensaje con la propuesta sin botones
        Approve/Reject.
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
