import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import type { AuthUser } from '../auth';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PROPERTY_ID = '22222222-2222-2222-2222-222222222222';
const USER: AuthUser = {
  sub: 'u-1',
  tenantId: TENANT_ID,
  email: 'admin@test',
  roles: ['tenant_admin'],
};

function buildService(opts: {
  property?: {
    id: string;
    code?: string;
    name?: string;
    publicSlug?: string | null;
    publishedAt?: Date | null;
    channelManagerProvider?: string | null;
    channelManagerPropertyId?: string | null;
    channelManagerCredentialsRef?: string | null;
    attributes?: Record<string, unknown> | null;
  } | null;
  slugCollision?: { id: string } | null;
} = {}) {
  const property =
    opts.property === undefined
      ? {
          id: PROPERTY_ID,
          code: 'BBM',
          name: 'Berenjena',
          publicSlug: null,
          publishedAt: null,
          channelManagerProvider: null,
          channelManagerPropertyId: null,
          channelManagerCredentialsRef: null,
          attributes: null,
        }
      : opts.property;

  const txStub = {
    property: {
      findFirst: vi.fn().mockImplementation((args: { where: { publicSlug?: unknown; id?: string } }) => {
        if (args.where.publicSlug !== undefined) return Promise.resolve(opts.slugCollision ?? null);
        return Promise.resolve(property);
      }),
      update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          publishedAt: args.data.publishedAt ?? null,
          publicSlug: args.data.publicSlug ?? null,
          attributes: args.data.attributes ?? null,
        }),
      ),
    },
  };
  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: typeof txStub) => unknown) => fn(txStub)),
  };
  const events = { publish: vi.fn().mockResolvedValue({ id: 'evt' }) };
  const service = new PropertiesService(prisma as never, events as never);
  return { service, prisma, events, tx: txStub };
}

describe('PropertiesService.getSettings', () => {
  it('returns 404 when property not found', async () => {
    const { service } = buildService({ property: null });
    await expect(service.getSettings(USER, 'c', PROPERTY_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('parses blockedIps from attributes', async () => {
    const { service } = buildService({
      property: {
        id: PROPERTY_ID,
        attributes: { blockedIps: ['1.2.3.4', '5.6.7.8'] },
      },
    });
    const out = await service.getSettings(USER, 'c', PROPERTY_ID);
    expect(out.blockedIps).toEqual(['1.2.3.4', '5.6.7.8']);
  });

  it('returns empty blockedIps when attributes missing', async () => {
    const { service } = buildService();
    const out = await service.getSettings(USER, 'c', PROPERTY_ID);
    expect(out.blockedIps).toEqual([]);
    expect(out.ibe.publishedAt).toBeNull();
    expect(out.channelManager.provider).toBeNull();
  });
});

describe('PropertiesService.setPublish', () => {
  it('publishes and auto-generates slug when missing', async () => {
    const { service, tx } = buildService();
    const out = await service.setPublish(USER, 'c', PROPERTY_ID, { publish: true });
    expect(tx.property.update).toHaveBeenCalledOnce();
    const data = tx.property.update.mock.calls[0]![0]!.data;
    expect(data.publishedAt).toBeInstanceOf(Date);
    expect(data.publicSlug).toMatch(/^hotel-[0-9a-f]{6}$/);
    expect(out.publishedAt).not.toBeNull();
  });

  it('uses explicit slug when provided', async () => {
    const { service, tx } = buildService();
    await service.setPublish(USER, 'c', PROPERTY_ID, { publish: true, slug: 'mi-hotel' });
    expect(tx.property.update.mock.calls[0]![0]!.data.publicSlug).toBe('mi-hotel');
  });

  it('rejects slug collision', async () => {
    const { service } = buildService({ slugCollision: { id: 'other' } });
    await expect(
      service.setPublish(USER, 'c', PROPERTY_ID, { publish: true, slug: 'taken' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('unpublish clears publishedAt but keeps existing slug', async () => {
    const { service, tx } = buildService({
      property: {
        id: PROPERTY_ID,
        publicSlug: 'existing-slug',
        publishedAt: new Date(),
      },
    });
    const out = await service.setPublish(USER, 'c', PROPERTY_ID, { publish: false });
    expect(tx.property.update.mock.calls[0]![0]!.data.publishedAt).toBeNull();
    expect(tx.property.update.mock.calls[0]![0]!.data.publicSlug).toBe('existing-slug');
    expect(out.publishedAt).toBeNull();
  });
});

describe('PropertiesService.setChannelManager', () => {
  it('updates all three CM fields', async () => {
    const { service, tx } = buildService();
    await service.setChannelManager(USER, 'c', PROPERTY_ID, {
      provider: 'siteminder',
      channelManagerPropertyId: 'sm-prop-1',
      credentialsRef: 'CM_SITEMINDER_HMAC_SECRET',
    });
    const data = tx.property.update.mock.calls[0]![0]!.data;
    expect(data.channelManagerProvider).toBe('siteminder');
    expect(data.channelManagerPropertyId).toBe('sm-prop-1');
    expect(data.channelManagerCredentialsRef).toBe('CM_SITEMINDER_HMAC_SECRET');
  });

  it('clears CM when provider is null', async () => {
    const { service, tx } = buildService();
    await service.setChannelManager(USER, 'c', PROPERTY_ID, {
      provider: null,
      channelManagerPropertyId: null,
      credentialsRef: null,
    });
    expect(tx.property.update.mock.calls[0]![0]!.data.channelManagerProvider).toBeNull();
  });
});

describe('PropertiesService.setBlockedIps', () => {
  it('replaces blockedIps in attributes', async () => {
    const { service, tx } = buildService({
      property: { id: PROPERTY_ID, attributes: { email: { brand: 'x' } } },
    });
    await service.setBlockedIps(USER, 'c', PROPERTY_ID, { ips: ['1.2.3.4', '5.6.7.8'] });
    const data = tx.property.update.mock.calls[0]![0]!.data;
    expect(data.attributes).toEqual({
      email: { brand: 'x' },
      blockedIps: ['1.2.3.4', '5.6.7.8'],
    });
  });

  it('emits property.updated with blockedIps in changed list', async () => {
    const { service, events } = buildService();
    await service.setBlockedIps(USER, 'c', PROPERTY_ID, { ips: ['1.2.3.4'] });
    expect(events.publish).toHaveBeenCalledWith(
      'property.updated',
      expect.any(Object),
      expect.objectContaining({
        changes: expect.objectContaining({ 'attributes.blockedIps': ['1.2.3.4'] }),
      }),
    );
  });
});
