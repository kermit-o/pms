import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import type { AuthUser } from '../auth';
import type {
  BlockedIpsDto,
  ChannelManagerConfigDto,
  PublishPropertyDto,
} from './properties.dto';

/**
 * Back-office admin de Property (Sprint 10 W4).
 *
 * Tres operaciones que antes se hacían por SQL directo:
 *  - Publicar/despublicar el IBE (Sprint 8 W1).
 *  - Configurar el channel manager (Sprint 9 W2).
 *  - Gestionar la blocklist de IPs por hotel (Sprint 9 W4).
 *
 * Todas requieren rol `tenant_admin` (forzado en el controller). Las
 * lecturas (`getSettings`) se relajan a operadores normales para que
 * vean el estado actual.
 */
@Injectable()
export class PropertiesService {
  private readonly log = new Logger(PropertiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventbusService,
  ) {}

  async getSettings(user: AuthUser, correlationId: string, propertyId: string) {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    const property = await this.prisma.withTenant(ctx, (tx) =>
      tx.property.findFirst({
        where: { id: propertyId, deletedAt: null },
        select: {
          id: true,
          code: true,
          name: true,
          publicSlug: true,
          publishedAt: true,
          channelManagerProvider: true,
          channelManagerPropertyId: true,
          channelManagerCredentialsRef: true,
          attributes: true,
        },
      }),
    );
    if (!property) throw new NotFoundException('property_not_found');
    const blockedIps = readBlockedIps(property.attributes);
    return {
      id: property.id,
      code: property.code,
      name: property.name,
      ibe: {
        publishedAt: property.publishedAt?.toISOString() ?? null,
        publicSlug: property.publicSlug,
      },
      channelManager: {
        provider: property.channelManagerProvider,
        channelManagerPropertyId: property.channelManagerPropertyId,
        credentialsRef: property.channelManagerCredentialsRef,
      },
      blockedIps,
    };
  }

  async setPublish(
    user: AuthUser,
    correlationId: string,
    propertyId: string,
    input: PublishPropertyDto,
  ): Promise<{ publishedAt: string | null; publicSlug: string | null }> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, deletedAt: null },
        select: { id: true, publicSlug: true, publishedAt: true },
      });
      if (!property) throw new NotFoundException('property_not_found');

      let slug = property.publicSlug;
      if (input.publish && !slug) {
        slug = (input.slug ?? autoSlug()).toLowerCase();
        const collision = await tx.property.findFirst({
          where: { publicSlug: slug, NOT: { id: propertyId } },
          select: { id: true },
        });
        if (collision) {
          throw new ConflictException(`public_slug_taken:${slug}`);
        }
      }
      const updated = await tx.property.update({
        where: { id: propertyId },
        data: {
          publishedAt: input.publish ? new Date() : null,
          publicSlug: slug,
        },
        select: { publishedAt: true, publicSlug: true },
      });
      return updated;
    });

    await this.events.publish('property.updated', ctx, {
      propertyId,
      changes: { publishedAt: result.publishedAt, publicSlug: result.publicSlug },
    });

    this.log.log(
      `property ${propertyId} ibe ${result.publishedAt ? 'published' : 'unpublished'} slug=${result.publicSlug ?? 'null'}`,
    );

    return {
      publishedAt: result.publishedAt?.toISOString() ?? null,
      publicSlug: result.publicSlug,
    };
  }

  async setChannelManager(
    user: AuthUser,
    correlationId: string,
    propertyId: string,
    input: ChannelManagerConfigDto,
  ): Promise<ChannelManagerConfigDto> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    await this.prisma.withTenant(ctx, async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, deletedAt: null },
        select: { id: true },
      });
      if (!property) throw new NotFoundException('property_not_found');
      await tx.property.update({
        where: { id: propertyId },
        data: {
          channelManagerProvider: input.provider,
          channelManagerPropertyId: input.channelManagerPropertyId,
          channelManagerCredentialsRef: input.credentialsRef,
        },
      });
    });

    await this.events.publish('property.updated', ctx, {
      propertyId,
      changes: {
        channelManagerProvider: input.provider,
        channelManagerPropertyId: input.channelManagerPropertyId,
        channelManagerCredentialsRef: input.credentialsRef,
      },
    });

    this.log.log(
      `property ${propertyId} CM ${input.provider ?? '<cleared>'} configured`,
    );

    return input;
  }

  async setBlockedIps(
    user: AuthUser,
    correlationId: string,
    propertyId: string,
    input: BlockedIpsDto,
  ): Promise<{ blockedIps: string[] }> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    const ips = input.ips;
    await this.prisma.withTenant(ctx, async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, deletedAt: null },
        select: { id: true, attributes: true },
      });
      if (!property) throw new NotFoundException('property_not_found');
      const existing = (property.attributes ?? {}) as Record<string, unknown>;
      const next = { ...existing, blockedIps: ips };
      await tx.property.update({
        where: { id: propertyId },
        data: { attributes: next },
      });
    });

    await this.events.publish('property.updated', ctx, {
      propertyId,
      changes: { 'attributes.blockedIps': ips },
    });

    this.log.log(`property ${propertyId} blockedIps count=${ips.length}`);
    return { blockedIps: ips };
  }
}

function readBlockedIps(attrs: unknown): string[] {
  if (!attrs || typeof attrs !== 'object') return [];
  const v = (attrs as { blockedIps?: unknown }).blockedIps;
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === 'string' && s.length > 0);
}

function autoSlug(): string {
  return `hotel-${randomBytes(3).toString('hex')}`;
}
