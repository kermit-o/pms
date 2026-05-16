import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { foToolCatalog, hskToolCatalog } from '@pms/mcp-tools';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AuthUser } from '../auth';
import type { Env } from '../config/env.schema';
import { type AnyToolName, ToolResolver } from './tool-resolver';
import type {
  AdapterCallbacks,
  AdapterResult,
  AdapterTelemetry,
  CopilotAdapter,
  CopilotSessionState,
} from './copilot.types';

/**
 * Real Anthropic Messages adapter (Sprint 6 W1).
 *
 * Diseño:
 *  - Modelo configurable via COPILOT_MODEL, default claude-sonnet-4-6.
 *  - Prompt caching aplicado al system prompt y al tool catalog. Los dos
 *    son estables entre turnos (system literal, tools idempotentes), asi
 *    que `cache_control: { type: 'ephemeral' }` reduce coste a ~10%
 *    del nominal en sesiones >1 turno. Anthropic mantiene la cache 5min.
 *  - Usamos `client.beta.messages` porque prompt caching vive en la API
 *    beta en el SDK 0.32.x.
 *  - Agentic loop: read-only tools se auto-ejecutan en silencio, mutating
 *    se devuelve para confirmacion humana (ADR-020).
 *  - Pre-validacion Zod de tool_use mutating: si la propuesta del LLM
 *    no cumple el schema, devolvemos error como tool_result y dejamos
 *    que el LLM corrija.
 *  - Telemetria agregada (tokens + latency) por turno externo (el del
 *    usuario), no por iteracion interna.
 */
@Injectable()
export class AnthropicAdapter implements CopilotAdapter {
  readonly name = 'anthropic' as const;
  private readonly log = new Logger(AnthropicAdapter.name);
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly maxIter = 12;
  private readonly maxTokens = 2048;

  constructor(
    private readonly resolver: ToolResolver,
    config: ConfigService<Env, true>,
  ) {
    this.apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.model = config.get('COPILOT_MODEL', { infer: true }) ?? 'claude-sonnet-4-6';
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async propose(
    session: CopilotSessionState,
    user: AuthUser,
    correlationId: string,
    _latestUserMessage: string,
    callbacks?: AdapterCallbacks,
  ): Promise<AdapterResult> {
    if (!this.apiKey) {
      throw new Error('AnthropicAdapter.propose called without ANTHROPIC_API_KEY');
    }
    const start = Date.now();
    const client = new Anthropic({ apiKey: this.apiKey });
    const tools = buildAnthropicTools();
    const system = buildSystemPrompt(session.propertyId);

    const conv: Anthropic.Beta.Messages.BetaMessageParam[] = session.messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;

    for (let iter = 0; iter < this.maxIter; iter += 1) {
      const resp = await client.beta.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system,
        tools,
        messages: conv,
      });

      totalInput += resp.usage?.input_tokens ?? 0;
      totalOutput += resp.usage?.output_tokens ?? 0;
      totalCacheRead += resp.usage?.cache_read_input_tokens ?? 0;
      totalCacheWrite += resp.usage?.cache_creation_input_tokens ?? 0;

      const toolUse = resp.content.find(
        (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use',
      );

      if (!toolUse) {
        const text = resp.content
          .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return {
          proposal: { kind: 'text', text: text || '…' },
          telemetry: this.telemetry(start, totalInput, totalOutput, totalCacheRead, totalCacheWrite),
        };
      }

      if (!this.resolver.has(toolUse.name)) {
        this.log.warn(`Anthropic returned unknown tool: ${toolUse.name}`);
        return {
          proposal: {
            kind: 'text',
            text: `Quise usar el tool ${toolUse.name} pero no existe. ¿Puedes reformular?`,
          },
          telemetry: this.telemetry(start, totalInput, totalOutput, totalCacheRead, totalCacheWrite),
        };
      }

      const toolName = toolUse.name as AnyToolName;
      const meta = this.resolver.getMeta(toolName);

      if (meta.mutating) {
        const validation = this.resolver.tryValidate(toolName, toolUse.input);
        if (!validation.ok) {
          conv.push({ role: 'assistant', content: resp.content });
          conv.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: `ERROR de validación. Tu propuesta no cumple el schema:\n${validation.error}\nCorrige los campos faltantes y vuelve a llamar al tool con el payload COMPLETO en este mismo turno.`,
                is_error: true,
              },
            ],
          });
          continue;
        }
        return {
          proposal: { kind: 'tool', tool: toolName, input: toolUse.input },
          telemetry: this.telemetry(start, totalInput, totalOutput, totalCacheRead, totalCacheWrite),
        };
      }

      // Read-only: ejecuta silenciosamente, alimenta el resultado al LLM.
      // Notifica al observador (SSE) que estamos llamando un tool.
      callbacks?.onToolUse?.(toolName);
      let toolResultText: string;
      let toolOk = true;
      try {
        const result = await this.resolver.execute(toolName, toolUse.input, user, correlationId);
        toolResultText = truncateJson(result);
      } catch (err) {
        toolResultText = `ERROR: ${(err as Error).message}`;
        toolOk = false;
      }
      callbacks?.onToolResult?.(toolName, toolOk);

      conv.push({ role: 'assistant', content: resp.content });
      conv.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: toolResultText,
          },
        ],
      });
    }

    return {
      proposal: { kind: 'text', text: 'Demasiados pasos. ¿Puedes simplificar la petición?' },
      telemetry: this.telemetry(start, totalInput, totalOutput, totalCacheRead, totalCacheWrite),
    };
  }

  private telemetry(
    start: number,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number,
    cacheWriteTokens: number,
  ): AdapterTelemetry {
    return {
      model: this.model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      latencyMs: Date.now() - start,
    };
  }
}

function buildSystemPrompt(
  propertyId: string | null,
): Anthropic.Beta.Messages.MessageCreateParams['system'] {
  const today = new Date().toISOString().slice(0, 10);
  const propertyHint = propertyId
    ? `Property activa: ${propertyId}. Usala como propertyId por defecto.`
    : 'Si necesitas propertyId pide al usuario que lo confirme.';
  const text = [
    'Eres Aubergine, copiloto operativo de un PMS hotelero.',
    'Responde en español, breve, profesional. Usa los tools cuando aplique.',
    'NO PIDAS CONFIRMACIÓN POR TEXTO — la UI ya muestra una tarjeta de',
    'confirmación cuando propones un tool mutating. Cuando tengas todos los',
    'datos para mutar, LLAMA AL TOOL DIRECTAMENTE; no contestes "¿confirmas?"',
    'en texto. El usuario aprobará en la tarjeta. Para read-only ejecuta',
    'sin pedir permiso.',
    'NO muestres JSON intermedio al usuario, encadena varias llamadas read-only',
    'si hace falta y al final propon un único tool_use mutating o un texto natural.',
    'Fechas siempre YYYY-MM-DD.',
    `Hoy es ${today}. Cuando el usuario dice "mañana" calculalo desde aquí.`,
    'NUNCA pidas UUIDs al usuario. Cuando menciona un tipo de habitación',
    'por nombre ("doble", "doble estándar", "suite") llama PRIMERO a',
    'list_room_types para resolver el roomTypeId, luego procede.',
    'JAMÁS inventes un UUID. Si no tienes uno real del catálogo NO ejecutes',
    'el tool — vuelve a llamar list_room_types o pregunta al usuario.',
    '',
    'REGLA CRÍTICA — GRUPOS:',
    'Si el usuario pide MÁS DE UNA habitación o menciona "grupo", "tour",',
    '"boda", "conferencia", "X individuales + Y dobles", DEBES usar',
    'create_reservation_group (NUNCA create_reservation individual).',
    'OBLIGATORIO: el array `reservations` debe contener TODAS las',
    'reservas COMPLETAS antes de proponer el tool. No propongas el tool',
    'con array vacío o parcial; si necesitas resolver roomTypeId u otro',
    'dato, primero llama a las tools read-only que hagan falta y DESPUÉS',
    'genera el array completo en UN ÚNICO tool_use de',
    'create_reservation_group.',
    'Si no conoces el nombre de cada huésped, usa el organizador como',
    'guest.firstName y un número como lastName: ej. para 7 individuales a',
    'nombre de "Miki Tour" → firstName="Miki Tour", lastName="#1" … "#7".',
    'Occupancy según tipo: IND=1 adulto, DBL/TWN=2, SUP=2, JSU=2-4, SUI=2.',
    'Ejemplo: usuario pide "7 individuales y 6 dobles para Miki Tour',
    'mañana 1 noche" → tu propuesta debe ser create_reservation_group',
    'con array de 13 elementos: 7 con roomTypeId(IND)+occupancy.adults=1',
    'y 6 con roomTypeId(DBL)+adults=2, todos con guestData firstName=',
    '"Miki Tour" y lastName="#1".."#13" y organizerName="Miki Tour".',
    '',
    'Si el usuario da nombre y apellido en una sola frase (ej. "Smith Arnold"),',
    'asume firstName=primero, lastName=segundo. No vuelvas a preguntar.',
    propertyHint,
  ].join(' ');

  return [
    {
      type: 'text',
      text,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

type ToolMetaShape = { name: string; description: string; inputSchema: unknown };

function buildAnthropicTools(): Anthropic.Beta.Messages.BetaToolUnion[] {
  const out: Anthropic.Beta.Messages.BetaToolUnion[] = [];
  const catalogs: Record<string, ToolMetaShape>[] = [
    foToolCatalog as unknown as Record<string, ToolMetaShape>,
    hskToolCatalog as unknown as Record<string, ToolMetaShape>,
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toJson = zodToJsonSchema as unknown as (schema: any) => Record<string, unknown>;
  const total =
    Object.keys(foToolCatalog as object).length + Object.keys(hskToolCatalog as object).length;
  let i = 0;
  for (const cat of catalogs) {
    for (const meta of Object.values(cat)) {
      i += 1;
      // Marcamos el ULTIMO tool con cache_control. Anthropic cachea hasta
      // ese punto incluyendo todos los tools anteriores. Asi todo el
      // catalog reutiliza la cache en turnos siguientes.
      const tool: Anthropic.Beta.Messages.BetaTool = {
        name: meta.name,
        description: meta.description,
        input_schema: toJson(meta.inputSchema) as Anthropic.Beta.Messages.BetaTool.InputSchema,
      };
      if (i === total) {
        tool.cache_control = { type: 'ephemeral' };
      }
      out.push(tool);
    }
  }
  return out;
}

function truncateJson(value: unknown, max = 1500): string {
  const json = JSON.stringify(value, null, 2);
  return json.length > max ? `${json.slice(0, max)}\n…(truncated)` : json;
}
