import { describe, expect, it } from 'vitest';
import type { AdminSessionSummary } from './copilot.service';
import { copilotSessionsToCsv } from './csv';

describe('copilotSessionsToCsv', () => {
  it('exporta header + filas con escape de comillas y CRLF', () => {
    const rows: AdminSessionSummary[] = [
      {
        sessionId: 'sess-1',
        userId: 'user-1',
        firstMessage: 'Qué precios hay "mañana"',
        firstMessageAt: '2026-05-22T09:00:00.000Z',
        lastActivityAt: '2026-05-22T09:05:00.000Z',
        messageCount: 4,
        widgetCount: 1,
      },
      {
        sessionId: 'sess-2',
        userId: 'user-2',
        firstMessage: null,
        firstMessageAt: '2026-05-22T08:00:00.000Z',
        lastActivityAt: '2026-05-22T08:01:00.000Z',
        messageCount: 1,
        widgetCount: 0,
      },
    ];
    const csv = copilotSessionsToCsv(rows);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      '"sessionId","userId","firstMessage","firstMessageAt","lastActivityAt","messageCount","widgetCount"',
    );
    expect(lines[1]).toBe(
      '"sess-1","user-1","Qué precios hay ""mañana""","2026-05-22T09:00:00.000Z","2026-05-22T09:05:00.000Z","4","1"',
    );
    // firstMessage null se exporta como string vacío.
    expect(lines[2]).toContain('"sess-2","user-2",""');
    // CRLF final.
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('header-only cuando no hay sesiones', () => {
    const csv = copilotSessionsToCsv([]);
    expect(csv).toBe(
      '"sessionId","userId","firstMessage","firstMessageAt","lastActivityAt","messageCount","widgetCount"\r\n',
    );
  });
});
