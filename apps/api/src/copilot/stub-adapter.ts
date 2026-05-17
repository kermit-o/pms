import { Injectable } from '@nestjs/common';
import type {
  AdapterResult,
  CopilotAdapter,
  CopilotSessionState,
  ToolProposal,
} from './copilot.types';
import type { AuthUser } from '../auth';

/**
 * Deterministic stub adapter. Used when ANTHROPIC_API_KEY is absent or
 * when COPILOT_DRIVER=stub (tests, demos). Reconoce un puñado de intents
 * con regex y mapea a tools del catalogo; cuando falta info devuelve un
 * texto orientativo en lugar de inventar.
 *
 * Importante: el contrato es el MISMO que el adapter real — la unica
 * diferencia es que no emite telemetria (no hay tokens, no hay latency
 * relevante).
 */
@Injectable()
export class StubAdapter implements CopilotAdapter {
  readonly name = 'stub' as const;

  async propose(
    _session: CopilotSessionState,
    _user: AuthUser,
    _correlationId: string,
    latestUserMessage: string,
  ): Promise<AdapterResult> {
    // El stub no encadena tools internamente; los callbacks se ignoran.
    return { proposal: stubProposal(latestUserMessage) };
  }
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;

export function stubProposal(content: string): ToolProposal {
  const lower = content.toLowerCase();
  const uuids = content.match(new RegExp(UUID_RE, 'gi')) ?? [];
  const dates = content.match(new RegExp(ISO_DATE_RE, 'g')) ?? [];

  // -------- HSK -----------------------------------------------------------
  if (
    /(sugiere|sugerencia|sugerencias).*(asignaci[oó]n|tareas|limpieza)/i.test(lower) &&
    uuids[0]
  ) {
    return {
      kind: 'tool',
      tool: 'hsk_suggest_assignments',
      input: { propertyId: uuids[0], businessDate: dates[0] },
    };
  }

  if (
    /(qu[eé] tareas|tareas (de )?hoy|listar tareas|tareas (asignadas )?(tiene|de))/i.test(lower) &&
    uuids[0]
  ) {
    return {
      kind: 'tool',
      tool: 'hsk_list_today',
      input: {
        propertyId: uuids[0],
        businessDate: dates[0],
        assignedToUserId: uuids[1],
      },
    };
  }

  if (/(empezar|iniciar) (la |una )?(tarea|limpieza)/i.test(lower) && uuids[0]) {
    return {
      kind: 'tool',
      tool: 'hsk_start_task',
      input: { taskId: uuids[0] },
    };
  }

  if (/(completar|finalizar|terminar) (la |una )?(tarea|limpieza)/i.test(lower) && uuids[0]) {
    return {
      kind: 'tool',
      tool: 'hsk_complete_task',
      input: { taskId: uuids[0] },
    };
  }

  if (
    /(asign[ao]r? (limpieza|tarea|housekeeping)|crear tarea (de limpieza|hsk))/i.test(lower) &&
    uuids[0] &&
    uuids[1] &&
    dates[0]
  ) {
    return {
      kind: 'tool',
      tool: 'hsk_assign_task',
      input: {
        propertyId: uuids[0],
        roomId: uuids[1],
        businessDate: dates[0],
        assignedToUserId: uuids[2],
      },
    };
  }

  // -------- FO ------------------------------------------------------------
  if (
    /(disponibilidad|availability|libres?|huecos?)/i.test(lower) &&
    uuids[0] &&
    dates[0] &&
    dates[1]
  ) {
    return {
      kind: 'tool',
      tool: 'query_availability',
      input: { propertyId: uuids[0], from: dates[0], to: dates[1] },
    };
  }

  if (/(check[- ]?in|registrar entrada)/i.test(lower) && uuids[0]) {
    return {
      kind: 'tool',
      tool: 'check_in',
      input: { reservationId: uuids[0], roomId: uuids[1] },
    };
  }

  if (/(asign[ao]r? habitaci[oó]n|assign room)/i.test(lower) && uuids[0] && uuids[1]) {
    return {
      kind: 'tool',
      tool: 'assign_room',
      input: { reservationId: uuids[0], roomId: uuids[1] },
    };
  }

  if (/(res[uú]me?n|report|reporte)/i.test(lower) && uuids[0] && dates[0]) {
    const focus: 'overview' | 'revenue' | 'occupancy' | 'incidents' =
      /ingres[oó]s|revenue|adr|revpar/i.test(lower)
        ? 'revenue'
        : /ocupaci[oó]n|occupancy/i.test(lower)
          ? 'occupancy'
          : /incidente|cancelaci[oó]n/i.test(lower)
            ? 'incidents'
            : 'overview';
    return {
      kind: 'tool',
      tool: 'generate_report',
      input: { propertyId: uuids[0], businessDate: dates[0], focus },
    };
  }

  return {
    kind: 'text',
    text:
      'Puedo ayudarte con FO (disponibilidad, check-in, asignar habitación, resúmenes) ' +
      'o HSK (asignar / iniciar / completar tareas, listar tareas del día, sugerir ' +
      'asignaciones). Ej: "qué tareas tiene <userId> hoy en <propertyId>" o ' +
      '"sugiere asignaciones para <propertyId> el <YYYY-MM-DD>".',
  };
}
