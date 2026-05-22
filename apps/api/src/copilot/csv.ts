/**
 * Sprint 13 — CSV export del listado admin de sesiones.
 *
 * Reusa el mismo contrato que `apps/api/src/reports/csv.ts`:
 * comillas siempre, escape de comillas internas duplicándolas,
 * CRLF como row separator (Excel + RFC 4180).
 *
 * Local al módulo copilot — no contamina `reports/csv.ts` con tipos
 * que no le pertenecen.
 */

import type { AdminSessionSummary } from './copilot.service';

function csvCell(value: unknown): string {
  if (value == null) return '""';
  const s = String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

export function copilotSessionsToCsv(sessions: AdminSessionSummary[]): string {
  const lines: string[] = [
    csvRow([
      'sessionId',
      'userId',
      'firstMessage',
      'firstMessageAt',
      'lastActivityAt',
      'messageCount',
      'widgetCount',
    ]),
  ];
  for (const s of sessions) {
    lines.push(
      csvRow([
        s.sessionId,
        s.userId,
        s.firstMessage ?? '',
        s.firstMessageAt,
        s.lastActivityAt,
        s.messageCount,
        s.widgetCount,
      ]),
    );
  }
  return lines.join('\r\n') + '\r\n';
}
