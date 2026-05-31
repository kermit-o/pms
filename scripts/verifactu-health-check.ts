/**
 * Health-check operativo del módulo Verifactu (RUNBOOK §8).
 *
 * Por tenant (o uno solo con --tenant <uuid>), reporta:
 *   - Emisor: NIF + razón social poblados (sin esto, issue() rechaza).
 *   - Certificado: existe, no revocado, días hasta caducidad.
 *   - Últimas 10 facturas: cuenta por estado.
 *   - DLQ: cuántas submissions en estado DEAD_LETTER en los últimos 30 días.
 *
 * Exit codes:
 *   0 — todos los tenants OK.
 *   1 — al menos uno necesita atención (rojo: emisor sin configurar, cert
 *       caducado o revocado, DLQ > 0).
 *   2 — error de conexión / DB.
 *
 * Uso:
 *   DIRECT_URL="postgres://..." \
 *     pnpm tsx scripts/verifactu-health-check.ts [--tenant <uuid>] [--json]
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { InvoiceStatus, InvoiceSubmissionStatus, PrismaClient } from '@prisma/client';

const envCandidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
for (const path of envCandidates) {
  if (existsSync(path)) {
    loadDotenv({ path });
    break;
  }
}

const adminUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!adminUrl) {
  console.error('error: DIRECT_URL o DATABASE_URL obligatoria.');
  process.exit(2);
}

const args = process.argv.slice(2);
const tenantFilter = takeFlag('--tenant');
const jsonMode = args.includes('--json');

function takeFlag(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  return args[i + 1];
}

interface TenantHealth {
  tenantId: string;
  name: string;
  slug: string;
  emisor: { nif: string | null; razonSocial: string | null; ok: boolean };
  certificate: {
    subjectCn: string;
    notAfter: string;
    daysToExpiry: number;
    revoked: boolean;
    ok: boolean;
  } | null;
  invoices: {
    total: number;
    byStatus: Partial<Record<InvoiceStatus, number>>;
  };
  deadLetter30d: number;
  overall: 'ok' | 'warn' | 'fail';
}

const prisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 3600 * 1000;

async function checkTenant(tenant: {
  id: string;
  name: string;
  slug: string;
  nif: string | null;
  razonSocial: string | null;
}): Promise<TenantHealth> {
  const emisorOk = Boolean(tenant.nif && tenant.razonSocial);

  const cert = await prisma.verifactuCertificate.findFirst({
    where: { tenantId: tenant.id },
    select: { subjectCn: true, notAfter: true, revokedAt: true },
  });

  let certificate: TenantHealth['certificate'] = null;
  if (cert) {
    const daysToExpiry = Math.floor((cert.notAfter.getTime() - Date.now()) / (24 * 3600 * 1000));
    certificate = {
      subjectCn: cert.subjectCn,
      notAfter: cert.notAfter.toISOString().slice(0, 10),
      daysToExpiry,
      revoked: cert.revokedAt !== null,
      ok: !cert.revokedAt && daysToExpiry > 0,
    };
  }

  const invoiceRows = await prisma.invoice.findMany({
    where: { tenantId: tenant.id },
    orderBy: { issuedAt: 'desc' },
    take: 10,
    select: { status: true },
  });
  const byStatus: Partial<Record<InvoiceStatus, number>> = {};
  for (const r of invoiceRows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  const deadLetter30d = await prisma.invoiceSubmission.count({
    where: {
      tenantId: tenant.id,
      status: InvoiceSubmissionStatus.DEAD_LETTER,
      completedAt: { gte: new Date(Date.now() - THIRTY_DAYS_MS) },
    },
  });

  let overall: TenantHealth['overall'] = 'ok';
  if (!emisorOk) overall = 'fail';
  else if (!certificate) overall = 'warn';
  else if (!certificate.ok) overall = 'fail';
  else if (certificate.daysToExpiry < 30) overall = 'fail';
  else if (deadLetter30d > 0) overall = 'fail';
  else if (certificate.notAfter && cert!.notAfter.getTime() - Date.now() < NINETY_DAYS_MS) {
    overall = 'warn';
  }

  return {
    tenantId: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    emisor: { nif: tenant.nif, razonSocial: tenant.razonSocial, ok: emisorOk },
    certificate,
    invoices: { total: invoiceRows.length, byStatus },
    deadLetter30d,
    overall,
  };
}

function formatHuman(reports: TenantHealth[]): string {
  const out: string[] = [];
  for (const r of reports) {
    const dot = r.overall === 'ok' ? '🟢' : r.overall === 'warn' ? '🟡' : '🔴';
    out.push(`\n${dot} ${r.name}  (slug=${r.slug}, id=${r.tenantId})`);

    if (r.emisor.ok) {
      out.push(`   Emisor:  ${r.emisor.nif} / ${r.emisor.razonSocial}`);
    } else {
      out.push(`   Emisor:  NOT SET — operador debe configurar /admin/billing/emisor`);
    }

    if (!r.certificate) {
      out.push(`   Cert:    NOT UPLOADED — operador debe subir .p12 en /admin/billing/certificate`);
    } else if (r.certificate.revoked) {
      out.push(`   Cert:    ${r.certificate.subjectCn}  REVOKED`);
    } else if (r.certificate.daysToExpiry <= 0) {
      out.push(
        `   Cert:    ${r.certificate.subjectCn}  EXPIRED (${Math.abs(r.certificate.daysToExpiry)} días)`,
      );
    } else {
      const warn =
        r.certificate.daysToExpiry < 30
          ? ' ⚠ <30d'
          : r.certificate.daysToExpiry < 90
            ? ' ⚠ <90d'
            : '';
      out.push(
        `   Cert:    ${r.certificate.subjectCn}  caduca en ${r.certificate.daysToExpiry}d${warn}`,
      );
    }

    if (r.invoices.total === 0) {
      out.push(`   Invoices (10 últimas): ninguna emitida aún`);
    } else {
      const summary = Object.entries(r.invoices.byStatus)
        .map(([k, v]) => `${v} ${k.toLowerCase()}`)
        .join(', ');
      out.push(`   Invoices (${r.invoices.total} últimas): ${summary}`);
    }

    const dlqMarker = r.deadLetter30d > 0 ? ' 🔴' : '';
    out.push(`   DLQ 30d: ${r.deadLetter30d}${dlqMarker}`);
  }

  const ok = reports.filter((r) => r.overall === 'ok').length;
  const warn = reports.filter((r) => r.overall === 'warn').length;
  const fail = reports.filter((r) => r.overall === 'fail').length;
  out.push(`\nSummary: ${ok} ok, ${warn} warn, ${fail} fail (of ${reports.length} tenants).`);
  return out.join('\n');
}

async function main(): Promise<void> {
  const where = tenantFilter ? { id: tenantFilter } : { deletedAt: null };
  const tenants = await prisma.tenant.findMany({
    where,
    orderBy: { name: 'asc' },
    select: { id: true, name: true, slug: true, nif: true, razonSocial: true },
  });

  if (tenants.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify({ reports: [], summary: { ok: 0, warn: 0, fail: 0 } }));
    } else {
      console.log(tenantFilter ? `No tenant with id=${tenantFilter}` : 'No tenants found');
    }
    await prisma.$disconnect();
    process.exit(tenantFilter ? 1 : 0);
  }

  const reports: TenantHealth[] = [];
  for (const t of tenants) reports.push(await checkTenant(t));

  if (jsonMode) {
    const summary = {
      ok: reports.filter((r) => r.overall === 'ok').length,
      warn: reports.filter((r) => r.overall === 'warn').length,
      fail: reports.filter((r) => r.overall === 'fail').length,
    };
    console.log(JSON.stringify({ reports, summary }, null, 2));
  } else {
    console.log(formatHuman(reports));
  }

  await prisma.$disconnect();
  const hasFail = reports.some((r) => r.overall === 'fail');
  process.exit(hasFail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
