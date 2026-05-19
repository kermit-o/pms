import { z } from 'zod';

/**
 * DTOs del back-office admin de Property (Sprint 10 W4).
 *
 * Tres bloques de configuración:
 *  - IBE publish toggle (publishedAt + publicSlug)
 *  - Channel manager (provider + ids)
 *  - Blocked IPs (attributes.blockedIps)
 */

export const PublishPropertyDto = z.object({
  publish: z.boolean(),
  /** Slug público a usar si todavía no existe. Si la property ya tiene
   *  un publicSlug, este campo se ignora. */
  slug: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and dashes only')
    .optional(),
});
export type PublishPropertyDto = z.infer<typeof PublishPropertyDto>;

export const ChannelManagerConfigDto = z.object({
  provider: z.enum(['siteminder']).nullable(),
  channelManagerPropertyId: z.string().min(1).max(200).nullable(),
  credentialsRef: z.string().min(1).max(120).nullable(),
});
export type ChannelManagerConfigDto = z.infer<typeof ChannelManagerConfigDto>;

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;
const isIp = (s: string) => IPV4.test(s) || (IPV6.test(s) && s.includes(':'));

export const BlockedIpsDto = z.object({
  ips: z
    .array(z.string().trim())
    .max(500)
    .transform((arr) => Array.from(new Set(arr.filter(Boolean))))
    .refine((arr) => arr.every(isIp), {
      message: 'each entry must be a valid IPv4 or IPv6 address',
    }),
});
export type BlockedIpsDto = z.infer<typeof BlockedIpsDto>;
