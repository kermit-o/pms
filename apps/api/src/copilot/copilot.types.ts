import type { AnyToolName } from './tool-resolver';
import type { CopilotWidget } from './widgets';

/**
 * Shared types entre adapter y service. Vive aparte para que adapters
 * concretos (stub / anthropic) no se importen mutuamente.
 */

export interface CopilotSessionState {
  id: string;
  tenantId: string;
  userId: string;
  propertyId: string | null;
  messages: ReadonlyArray<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

/**
 * Una propuesta del adapter al service. Las variantes `text` y `tool`
 * existen desde S6. Sprint 13 W4 añade `widgets` opcional a `text` para
 * que el adapter pueda devolver datos estructurados (precios reales del
 * tool) junto con el texto del LLM. La UI pinta el texto + cada widget
 * como una tarjeta dedicada.
 */
export type ToolProposal =
  | { kind: 'text'; text: string; widgets?: CopilotWidget[] }
  | { kind: 'tool'; tool: AnyToolName; input: unknown };

/**
 * Telemetry de una llamada al adapter — opcional, solo Anthropic la rellena.
 * El service lo persiste en copilot_messages.
 */
export interface AdapterTelemetry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
}

export interface AdapterResult {
  proposal: ToolProposal;
  telemetry?: AdapterTelemetry;
}

/**
 * Hooks opcionales que el service pasa al adapter para visibilidad
 * incremental durante el agentic loop. Se invocan sincronamente cuando
 * el adapter detecta un tool_use read-only y cuando completa la
 * ejecucion. El service los reenvia al SSE.
 *
 * En modo no-stream se pasan undefined y el adapter los ignora.
 */
export interface AdapterCallbacks {
  onToolUse?: (tool: string) => void;
  onToolResult?: (tool: string, ok: boolean) => void;
}

export interface CopilotAdapter {
  readonly name: 'anthropic' | 'stub';
  propose(
    session: CopilotSessionState,
    user: { tenantId: string; sub: string; roles: string[] },
    correlationId: string,
    latestUserMessage: string,
    callbacks?: AdapterCallbacks,
  ): Promise<AdapterResult>;
}
