import type { AnyToolName } from './tool-resolver';

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

export type ToolProposal =
  | { kind: 'text'; text: string }
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

export interface CopilotAdapter {
  readonly name: 'anthropic' | 'stub';
  propose(
    session: CopilotSessionState,
    user: { tenantId: string; sub: string; roles: string[] },
    correlationId: string,
    latestUserMessage: string,
  ): Promise<AdapterResult>;
}
