/**
 * Parser SSE para el endpoint /api/copilot/sessions/:id/messages?stream=true.
 *
 * EventSource del browser solo soporta GET; nuestro endpoint es POST porque
 * lleva content y necesita la cookie de sesion. Asi que parseamos a mano
 * el flujo text/event-stream sobre fetch + ReadableStream.
 *
 * Formato de cada frame (segun copilot.controller.ts del API):
 *   event: <type>
 *   data: <json>
 *   <blank line>
 *
 * Eventos definidos hoy: status | tool_call | tool_result | done | error.
 * El consumidor decide que hacer con cada uno; este modulo solo deserializa
 * y los cede como AsyncIterable.
 */
import type { CopilotSession } from './api';

export type CopilotStreamEvent =
  | { type: 'status'; phase: 'thinking' }
  | { type: 'tool_call'; tool: string }
  | { type: 'tool_result'; tool: string; ok: boolean }
  | { type: 'done'; view: CopilotSession }
  | { type: 'error'; message: string };

export async function* streamCopilotMessage(
  sessionId: string,
  content: string,
  signal?: AbortSignal,
): AsyncGenerator<CopilotStreamEvent> {
  const res = await fetch(`/api/copilot/sessions/${sessionId}/messages?stream=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    yield { type: 'error', message: text || `HTTP ${res.status}` };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const ev = parseFrame(frame);
      if (ev) yield ev;
    }
  }
  // Drain leftover (rare: no trailing blank line).
  if (buffer.trim()) {
    const ev = parseFrame(buffer);
    if (ev) yield ev;
  }
}

function parseFrame(frame: string): CopilotStreamEvent | null {
  let dataLine = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) {
      dataLine += line.slice(5).trim();
    }
  }
  if (!dataLine) return null;
  try {
    return JSON.parse(dataLine) as CopilotStreamEvent;
  } catch {
    return null;
  }
}
