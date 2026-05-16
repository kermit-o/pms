import { Injectable, Logger } from '@nestjs/common';
import { GuestMemorySourceKind, Prisma } from '@pms/db';
import { PrismaService } from '../../db';
import type { AuthUser } from '../../auth';

/**
 * Memoria semántica del huésped — Sprint 7 W2 (V1, tsvector full-text).
 *
 *  - `ingestForGuest`: lee el cardex + estancias + folio notes del
 *    huésped y materializa chunks idempotentes en `guest_memory_chunks`.
 *    Idempotente por `(guestId, source_kind, source_ref)`.
 *  - `recall`: ranking por `ts_rank` sobre la query del operador,
 *    devuelve top-K con score y `chunk_text`.
 *
 * V1 NO usa embeddings vectoriales — `vector_pending=true` deja la
 * columna lista para V1.1 cuando se apruebe la dep `openai`/voyage.
 */
@Injectable()
export class MemoryService {
  private readonly log = new Logger(MemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Materializa chunks del huésped. Llamar tras crear/actualizar guest,
   * tras cerrar una estancia, o explícitamente desde un job de NA.
   *
   * El número de chunks es modesto: cardex (1) + last N stays (≤10) + last
   * N folio notes (≤10) ≈ 21 max por huésped. Reescribimos con upsert.
   */
  async ingestForGuest(user: AuthUser, correlationId: string, guestId: string): Promise<{
    written: number;
  }> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    return this.prisma.withTenant(ctx, async (tx) => {
      const guest = await tx.guest.findFirst({
        where: { id: guestId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          nationality: true,
          documentType: true,
          documentNumber: true,
          membershipLevel: true,
          notes: true,
          attributes: true,
          reservations: {
            select: {
              reservationId: true,
              isPrimary: true,
              reservation: {
                select: {
                  id: true,
                  code: true,
                  status: true,
                  arrivalDate: true,
                  departureDate: true,
                  specialRequests: true,
                  notes: true,
                  agencyName: true,
                  companyName: true,
                  totalAmount: true,
                  currency: true,
                  roomType: { select: { code: true, name: true } },
                  folio: {
                    select: {
                      entries: {
                        orderBy: { postedAt: 'desc' },
                        take: 5,
                        select: { description: true, amount: true, type: true, postedAt: true },
                      },
                    },
                  },
                },
              },
            },
            take: 10,
            orderBy: { reservation: { arrivalDate: 'desc' } },
          },
        },
      });
      if (!guest) return { written: 0 };

      const chunks: Array<{
        sourceKind: GuestMemorySourceKind;
        sourceRef: string | null;
        chunkText: string;
      }> = [];

      // 1. Cardex.
      const cardexLines: string[] = [
        `Huésped: ${guest.firstName} ${guest.lastName}.`,
        guest.nationality ? `Nacionalidad: ${guest.nationality}.` : null,
        guest.membershipLevel ? `Programa fidelización: ${guest.membershipLevel}.` : null,
        guest.documentType
          ? `Documento: ${guest.documentType}${guest.documentNumber ? ` ${guest.documentNumber}` : ''}.`
          : null,
        guest.notes ? `Notas cardex: ${guest.notes}` : null,
      ].filter(Boolean) as string[];
      if (guest.attributes && typeof guest.attributes === 'object' && !Array.isArray(guest.attributes)) {
        const attrs = guest.attributes as Record<string, unknown>;
        const preferences = attrs.preferences as string | undefined;
        const allergies = attrs.allergies as string | undefined;
        if (preferences) cardexLines.push(`Preferencias: ${preferences}.`);
        if (allergies) cardexLines.push(`Alergias: ${allergies}.`);
      }
      chunks.push({
        sourceKind: GuestMemorySourceKind.CARDEX,
        sourceRef: 'self',
        chunkText: cardexLines.join(' '),
      });

      // 2. Stays — 1 chunk por reserva.
      for (const rg of guest.reservations) {
        const r = rg.reservation;
        const stayText = [
          `Estancia ${r.code}: ${r.status.toLowerCase()}, ${formatDate(r.arrivalDate)} → ${formatDate(r.departureDate)}.`,
          r.roomType ? `Tipo: ${r.roomType.code} (${r.roomType.name}).` : null,
          r.totalAmount ? `Total ${r.totalAmount.toString()} ${r.currency}.` : null,
          r.agencyName ? `Agencia: ${r.agencyName}.` : null,
          r.companyName ? `Empresa: ${r.companyName}.` : null,
          r.specialRequests ? `Solicitudes: ${r.specialRequests}` : null,
          r.notes ? `Notas: ${r.notes}` : null,
        ]
          .filter(Boolean)
          .join(' ');
        chunks.push({
          sourceKind: GuestMemorySourceKind.STAY_NOTE,
          sourceRef: r.id,
          chunkText: stayText,
        });

        // 3. Folio entries con descripción.
        const entries = r.folio?.entries ?? [];
        for (const e of entries) {
          if (!e.description) continue;
          chunks.push({
            sourceKind: GuestMemorySourceKind.FOLIO_NOTE,
            sourceRef: `${r.id}:${e.postedAt.toISOString()}:${e.type}`,
            chunkText: `Folio ${r.code} ${formatDate(e.postedAt)}: ${e.description} (${e.amount.toString()} ${r.currency}).`,
          });
        }

        if (r.specialRequests) {
          chunks.push({
            sourceKind: GuestMemorySourceKind.SPECIAL_REQUEST,
            sourceRef: r.id,
            chunkText: `Solicitud especial en ${r.code}: ${r.specialRequests}`,
          });
        }
      }

      // Upsert idempotente. Borrar primero los obsoletos del guest evita
      // que una nota borrada en cardex/reservation siga en memoria.
      await tx.guestMemoryChunk.deleteMany({ where: { guestId } });
      if (chunks.length === 0) return { written: 0 };
      await tx.guestMemoryChunk.createMany({
        data: chunks.map((c) => ({
          tenantId: user.tenantId,
          guestId,
          sourceKind: c.sourceKind,
          sourceRef: c.sourceRef,
          chunkText: c.chunkText,
        })),
        skipDuplicates: true,
      });
      this.log.log(`Guest ${guestId} memory chunks: ${chunks.length}`);
      return { written: chunks.length };
    });
  }

  /**
   * Recall top-K chunks del huésped por relevancia a la query (tsvector
   * full-text en español + ts_rank). Auto-ingesta si no hay chunks aún.
   */
  async recall(
    user: AuthUser,
    correlationId: string,
    input: { guestId: string; query: string; limit: number },
  ): Promise<{ chunks: Array<{ sourceKind: string; sourceRef: string | null; text: string; score: number }>; ingested: boolean }> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    let ingested = false;
    const initial = await this.prisma.withTenant(ctx, (tx) =>
      tx.guestMemoryChunk.count({ where: { guestId: input.guestId } }),
    );
    if (initial === 0) {
      await this.ingestForGuest(user, correlationId, input.guestId);
      ingested = true;
    }

    const chunks = await this.prisma.withTenant(ctx, (tx) =>
      tx.$queryRaw<
        Array<{ source_kind: string; source_ref: string | null; chunk_text: string; score: number }>
      >`
        SELECT source_kind::text,
               source_ref,
               chunk_text,
               ts_rank(tsv, plainto_tsquery('spanish', ${input.query}))::float AS score
        FROM guest_memory_chunks
        WHERE tenant_id = ${user.tenantId}::uuid
          AND guest_id  = ${input.guestId}::uuid
          AND tsv @@ plainto_tsquery('spanish', ${input.query})
        ORDER BY score DESC, created_at DESC
        LIMIT ${Prisma.sql`${Math.min(Math.max(input.limit, 1), 20)}`}
      `,
    );

    return {
      chunks: chunks.map((c) => ({
        sourceKind: c.source_kind,
        sourceRef: c.source_ref,
        text: c.chunk_text,
        score: c.score,
      })),
      ingested,
    };
  }
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
