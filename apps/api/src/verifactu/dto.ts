import { z } from 'zod';

export const IssueInvoiceDto = z.object({
  folioId: z.string().uuid(),
  customerName: z.string().min(1).max(200),
  customerNif: z.string().min(1).max(20).optional(),
  customerAddress: z.string().min(1).max(500).optional(),
  series: z
    .string()
    .regex(/^[A-Z][A-Z0-9-]{0,7}$/, 'series must match /^[A-Z][A-Z0-9-]{0,7}$/')
    .optional(),
});

export type IssueInvoiceDto = z.infer<typeof IssueInvoiceDto>;

/**
 * El .p12 viaja codificado en base64 dentro de un JSON. Lo elegimos sobre
 * multipart porque (a) el endpoint se invoca ~1 vez al año por tenant,
 * (b) evita registrar @fastify/multipart globalmente, (c) un .p12 típico
 * pesa <10 KB → ~13 KB en base64, holgadamente bajo el bodyLimit por
 * defecto de Fastify (1 MB). Si en el futuro hace falta soportar archivos
 * grandes, se revisará.
 */
export const UploadCertificateDto = z.object({
  p12Base64: z
    .string()
    .min(100, 'p12Base64 looks too short to be a real PKCS#12 archive')
    .max(2 * 1024 * 1024, 'p12Base64 exceeds 2 MiB — refusing'),
  passphrase: z.string().min(1).max(200),
});

export type UploadCertificateDto = z.infer<typeof UploadCertificateDto>;

export const RevokeCertificateDto = z.object({
  reason: z.string().min(3).max(500),
});

export type RevokeCertificateDto = z.infer<typeof RevokeCertificateDto>;
