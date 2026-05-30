import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as forge from 'node-forge';
import { PrismaService } from '../db';
import type { AuthUser } from '../auth';
import type { Env } from '../config/env.schema';
import { decryptCertificate, encryptCertificate } from './certificate-crypto';

interface ParsedCertificate {
  subjectCn: string;
  serialNumber: string;
  fingerprintSha256: string;
  notBefore: Date;
  notAfter: Date;
}

export interface CertificateMetadata extends ParsedCertificate {
  id: string;
  uploadedAt: Date;
  revokedAt: Date | null;
}

/**
 * Vault de certificados Verifactu (ADR-030 §3).
 *
 * Un .p12 por tenant. El blob se cifra con AES-256-GCM derivado de
 * VERIFACTU_MASTER_KEY + tenantId y se escribe a disco en
 * ${VERIFACTU_CERT_DIR}/${tenantId}.p12.enc. La fila en
 * verifactu_certificates guarda la metadata (subject, serial, fingerprint,
 * validez) — útil para la UI y para el health-check.
 *
 * El `passphrase` nunca se persiste. Se exige al subir para validar que el
 * .p12 es descifrable, pero a partir de ahí el envoltorio AES-GCM con la
 * master key es el único secreto necesario para usar el certificado.
 */
@Injectable()
export class CertificateVaultService {
  private readonly log = new Logger(CertificateVaultService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async upload(
    user: AuthUser,
    correlationId: string,
    p12Buffer: Buffer,
    passphrase: string,
  ): Promise<CertificateMetadata> {
    const masterKey = this.requireMasterKey();
    const { metadata, repacked } = parseAndRepackP12(p12Buffer, passphrase);

    const blob = encryptCertificate(masterKey, user.tenantId, repacked);
    const path = await this.writeBlob(user.tenantId, blob);

    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    const row = await this.prisma.withTenant(ctx, async (tx) => {
      return tx.verifactuCertificate.upsert({
        where: { tenantId: user.tenantId },
        create: {
          tenantId: user.tenantId,
          subjectCn: metadata.subjectCn,
          serialNumber: metadata.serialNumber,
          fingerprintSha256: metadata.fingerprintSha256,
          notBefore: metadata.notBefore,
          notAfter: metadata.notAfter,
          encryptedBlobPath: path,
          uploadedBy: user.sub,
        },
        update: {
          subjectCn: metadata.subjectCn,
          serialNumber: metadata.serialNumber,
          fingerprintSha256: metadata.fingerprintSha256,
          notBefore: metadata.notBefore,
          notAfter: metadata.notAfter,
          encryptedBlobPath: path,
          uploadedBy: user.sub,
          uploadedAt: new Date(),
          revokedAt: null,
          revokedReason: null,
        },
        select: { id: true, uploadedAt: true, revokedAt: true },
      });
    });

    this.log.log(
      `Certificate uploaded tenant=${user.tenantId} subject="${metadata.subjectCn}" serial=${metadata.serialNumber} notAfter=${metadata.notAfter.toISOString()}`,
    );

    return {
      id: row.id,
      uploadedAt: row.uploadedAt,
      revokedAt: row.revokedAt,
      ...metadata,
    };
  }

  async getMetadata(user: AuthUser, correlationId: string): Promise<CertificateMetadata | null> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    const row = await this.prisma.withTenant(ctx, async (tx) => {
      return tx.verifactuCertificate.findFirst({
        where: { tenantId: user.tenantId },
      });
    });
    if (!row) return null;
    return {
      id: row.id,
      subjectCn: row.subjectCn,
      serialNumber: row.serialNumber,
      fingerprintSha256: row.fingerprintSha256,
      notBefore: row.notBefore,
      notAfter: row.notAfter,
      uploadedAt: row.uploadedAt,
      revokedAt: row.revokedAt,
    };
  }

  async revoke(
    user: AuthUser,
    correlationId: string,
    reason: string,
  ): Promise<{ id: string; revokedAt: Date }> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    const row = await this.prisma.withTenant(ctx, async (tx) => {
      const cert = await tx.verifactuCertificate.findFirst({
        where: { tenantId: user.tenantId },
        select: { id: true, revokedAt: true },
      });
      if (!cert) throw new NotFoundException('No certificate to revoke');
      if (cert.revokedAt) return { id: cert.id, revokedAt: cert.revokedAt };
      const revokedAt = new Date();
      await tx.verifactuCertificate.update({
        where: { id: cert.id },
        data: { revokedAt, revokedReason: reason },
      });
      return { id: cert.id, revokedAt };
    });
    this.log.warn(`Certificate revoked tenant=${user.tenantId} reason="${reason}"`);
    return row;
  }

  /**
   * Lectura interna para el signer. NO se expone vía HTTP. Devuelve el .p12
   * en claro en memoria; el caller debe descartarlo al terminar de firmar.
   */
  async loadDecryptedP12(tenantId: string): Promise<Buffer> {
    const masterKey = this.requireMasterKey();
    const ctx = { tenantId };
    const row = await this.prisma.withTenant(ctx, async (tx) => {
      return tx.verifactuCertificate.findFirst({
        where: { tenantId },
        select: { encryptedBlobPath: true, revokedAt: true },
      });
    });
    if (!row) throw new NotFoundException(`No certificate for tenant ${tenantId}`);
    if (row.revokedAt) throw new BadRequestException('Certificate is revoked');
    const blob = await readFile(row.encryptedBlobPath);
    return decryptCertificate(masterKey, tenantId, blob);
  }

  private requireMasterKey(): string {
    const k = this.config.get('VERIFACTU_MASTER_KEY', { infer: true });
    if (!k) {
      throw new ServiceUnavailableException(
        'VERIFACTU_MASTER_KEY no configurada — el módulo no puede cifrar/descifrar certificados.',
      );
    }
    return k;
  }

  private async writeBlob(tenantId: string, blob: Buffer): Promise<string> {
    const dir = this.config.get('VERIFACTU_CERT_DIR', { infer: true });
    await mkdir(dir, { recursive: true });
    const filename = `${tenantId}.p12.enc`;
    const path = resolvePath(dir, filename);
    await writeFile(path, blob, { mode: 0o600 });
    return path;
  }
}

/**
 * Parse + valida el .p12 con la passphrase original, extrae la metadata y
 * re-empaqueta el archivo SIN passphrase para almacenamiento.
 *
 * Decisión clave (ADR-030 §3): el vault es el ÚNICO límite de
 * confidencialidad. Una vez subido, el .p12 ya no está protegido por su
 * passphrase PKCS#12 original — sólo por el envoltorio AES-GCM derivado de
 * `VERIFACTU_MASTER_KEY` + `tenantId`. Esto permite al signer extraer la
 * clave sin pedir al usuario la passphrase en cada firma.
 *
 * Lanza BadRequest si el formato es inválido o la passphrase no abre el
 * archivo o no se encuentran cert + clave privada.
 */
function parseAndRepackP12(
  p12Buffer: Buffer,
  passphrase: string,
): { metadata: ParsedCertificate; repacked: Buffer } {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12Buffer.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BadRequestException(`Invalid PKCS#12 archive or wrong passphrase: ${msg}`);
  }

  const certBagOid = forge.pki.oids.certBag as string;
  const certBags = p12.getBags({ bagType: certBagOid });
  const cert = certBags[certBagOid]?.[0]?.cert;
  if (!cert) {
    throw new BadRequestException('PKCS#12 archive does not contain a certificate');
  }

  const keyBagOid = forge.pki.oids.pkcs8ShroudedKeyBag as string;
  const keyBagAltOid = forge.pki.oids.keyBag as string;
  const keyBags = p12.getBags({ bagType: keyBagOid });
  const altKeyBags = p12.getBags({ bagType: keyBagAltOid });
  const privateKey =
    keyBags[keyBagOid]?.[0]?.key ?? altKeyBags[keyBagAltOid]?.[0]?.key;
  if (!privateKey) {
    throw new BadRequestException('PKCS#12 archive does not contain a private key');
  }

  const attrs: Array<{ shortName?: string; value?: unknown }> = cert.subject.attributes;
  const subjectCn =
    attrs.find((a) => a.shortName === 'CN')?.value?.toString() ??
    attrs.map((a) => `${a.shortName}=${String(a.value)}`).join(',');

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const fingerprintSha256 = createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex');

  // Re-empaquetar SIN passphrase. forge acepta null → bags sin cifrar.
  const repackedAsn1 = forge.pkcs12.toPkcs12Asn1(privateKey, [cert], null, {
    algorithm: 'aes256',
  });
  const repacked = Buffer.from(forge.asn1.toDer(repackedAsn1).getBytes(), 'binary');

  return {
    metadata: {
      subjectCn,
      serialNumber: cert.serialNumber,
      fingerprintSha256,
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
    },
    repacked,
  };
}
