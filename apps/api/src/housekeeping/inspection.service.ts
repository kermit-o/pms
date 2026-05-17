import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { HousekeepingTaskStatus, Prisma, RoomStatus } from '@pms/db';
import { PrismaService } from '../db';
import type { AuthUser } from '../auth';
import type { Env } from '../config/env.schema';
import { PhotoStorageService } from './photo-storage.service';

/**
 * Inspección visual post-limpieza con Claude Vision (Sprint 7 W3).
 *
 * Flow:
 *   1. La camarera completa la tarea con una foto opcional (data URL).
 *   2. PhotoStorageService la guarda (inline en dev, S3 en prod).
 *   3. Claude Vision (claude-sonnet-4-6 con bloque image) emite JSON
 *      `{verdict: 'clean'|'dirty'|'damaged', issues: string[], confidence: 0..1}`.
 *   4. Persistimos en `housekeeping_tasks.attributes.inspection`. Si
 *      verdict === 'damaged', la habitación pasa a OUT_OF_ORDER y se
 *      espera que el supervisor abra ticket de mantenimiento.
 *
 * Decisiones:
 *  - Sin nuevo dep — reutiliza @anthropic-ai/sdk del adapter copilot.
 *  - Sin webhook — la llamada es síncrona; tarda 2-5s con Sonnet.
 *  - Sin retries dentro del service — si Anthropic devuelve 5xx, falla
 *    fast y el operador puede reintentar pulsando otra vez.
 *  - Si ANTHROPIC_API_KEY no está, throw 503; el flujo manual (operador
 *    marca CLEAN/DIRTY) sigue intacto.
 */
@Injectable()
export class InspectionService {
  private readonly log = new Logger(InspectionService.name);
  private readonly apiKey: string | undefined;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly photoStorage: PhotoStorageService,
    config: ConfigService<Env, true>,
  ) {
    this.apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.model = config.get('COPILOT_MODEL', { infer: true }) ?? 'claude-sonnet-4-6';
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async inspect(
    user: AuthUser,
    correlationId: string,
    taskId: string,
    imageDataUrl: string,
  ): Promise<InspectionResult> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        'ANTHROPIC_API_KEY no configurada. La inspección manual sigue disponible.',
      );
    }
    if (!imageDataUrl.startsWith('data:image/')) {
      throw new BadRequestException('imageBase64 debe ser un data URL "data:image/..."');
    }

    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    const task = await this.prisma.withTenant(ctx, (tx) =>
      tx.housekeepingTask.findFirst({
        where: { id: taskId },
        select: { id: true, status: true, roomId: true, propertyId: true, attributes: true },
      }),
    );
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    if (
      task.status !== HousekeepingTaskStatus.IN_PROGRESS &&
      task.status !== HousekeepingTaskStatus.COMPLETED
    ) {
      throw new ConflictException(
        `Inspect requires IN_PROGRESS or COMPLETED status (got ${task.status})`,
      );
    }

    // 1. Persistir la foto (inline base64 o S3).
    const stored = await this.photoStorage.storeIn(
      'hsk-inspection',
      user.tenantId,
      taskId,
      imageDataUrl,
    );
    const imageUrlOrInline = stored.photoUrl ?? stored.photoBase64 ?? null;

    // 2. Llamar a Claude Vision.
    const verdict = await this.callVision(imageDataUrl);

    // 3. Persistir en attributes.inspection + actualizar status habitación si damaged.
    const inspectionRecord = {
      verdict: verdict.verdict,
      issues: verdict.issues,
      confidence: verdict.confidence,
      reasoning: verdict.reasoning,
      model: this.model,
      imageUrl: stored.photoUrl,
      hasInlinePhoto: Boolean(stored.photoBase64),
      reviewedAt: new Date().toISOString(),
      reviewedByUserId: user.sub,
    };
    await this.prisma.withTenant(ctx, async (tx) => {
      const prev = (task.attributes ?? {}) as Record<string, unknown>;
      await tx.housekeepingTask.update({
        where: { id: task.id },
        data: {
          attributes: {
            ...prev,
            inspection: inspectionRecord,
          } as Prisma.InputJsonValue,
        },
      });
      if (verdict.verdict === 'damaged' && task.roomId) {
        await tx.room.update({
          where: { id: task.roomId },
          data: { status: RoomStatus.OUT_OF_ORDER },
        });
      }
    });

    this.log.log(
      `Inspection ${taskId} verdict=${verdict.verdict} confidence=${verdict.confidence}`,
    );
    return {
      ...verdict,
      imageUrl: stored.photoUrl,
      hasInlinePhoto: Boolean(stored.photoBase64),
      imageDataUrl: imageUrlOrInline,
    };
  }

  // --------------------------------------------------------------------------

  private async callVision(imageDataUrl: string): Promise<VisionVerdict> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('ANTHROPIC_API_KEY missing');
    }
    const client = new Anthropic({ apiKey: this.apiKey });
    const { mediaType, base64 } = parseDataUrl(imageDataUrl);

    const prompt = [
      'Eres un inspector de housekeeping de un hotel. Mira la foto de la habitación',
      'post-limpieza y emite un veredicto. Responde SOLO con JSON valido, sin texto',
      'antes ni despues, con este shape exacto:',
      '{',
      '  "verdict": "clean" | "dirty" | "damaged",',
      '  "issues": [string, ...],',
      '  "confidence": number entre 0 y 1,',
      '  "reasoning": "una frase breve en español"',
      '}',
      'Reglas:',
      '- clean = lista para huesped (cama hecha, basura vacia, banno limpio).',
      '- dirty = falta limpieza, basura, cama deshecha, suciedad visible.',
      '- damaged = rotura, mancha permanente, mueble dannado, fuga, requiere mantenimiento.',
      '- issues lista <=5 problemas concretos en español, plural si aplica.',
      '- confidence baja (<0.5) si la foto no permite decidir.',
    ].join(' ');

    const resp = await client.messages.create({
      model: this.model,
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: base64,
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const text = resp.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return parseVerdict(text);
  }
}

// ---------------------------------------------------------------------------
// Helpers + tipos
// ---------------------------------------------------------------------------

export type Verdict = 'clean' | 'dirty' | 'damaged';
export interface VisionVerdict {
  verdict: Verdict;
  issues: string[];
  confidence: number;
  reasoning: string;
}
export interface InspectionResult extends VisionVerdict {
  imageUrl: string | null;
  hasInlinePhoto: boolean;
  imageDataUrl: string | null;
}

function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) throw new BadRequestException('Invalid data URL');
  return { mediaType: match[1]!, base64: match[2]! };
}

export function parseVerdict(text: string): VisionVerdict {
  const cleaned = stripMarkdownFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new BadRequestException(`Modelo no devolvió JSON válido: ${text.slice(0, 100)}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new BadRequestException('Modelo devolvió JSON no-objeto');
  }
  const obj = parsed as Record<string, unknown>;
  const verdict = obj.verdict;
  if (verdict !== 'clean' && verdict !== 'dirty' && verdict !== 'damaged') {
    throw new BadRequestException(`Verdict desconocido: ${String(verdict)}`);
  }
  const issues = Array.isArray(obj.issues)
    ? obj.issues.filter((x): x is string => typeof x === 'string').slice(0, 10)
    : [];
  const confidence =
    typeof obj.confidence === 'number'
      ? Math.max(0, Math.min(1, obj.confidence))
      : 0.5;
  const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';
  return { verdict, issues, confidence, reasoning };
}

function stripMarkdownFences(text: string): string {
  // El modelo a veces envuelve el JSON en ```json ... ``` pese al prompt.
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}
