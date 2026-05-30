import { Injectable, Logger } from '@nestjs/common';
import * as forge from 'node-forge';
import { CertificateVaultService } from './certificate-vault.service';

/**
 * SignerService — firma digital de XML.
 *
 * ALCANCE de este commit (W2 Sprint 14): emite una firma **XMLDSig estándar**
 * enveloped (RSA-SHA256 + C14N 1.0 implícito) sobre el XML recibido. Genera
 * `<ds:SignedInfo>`, `<ds:SignatureValue>`, `<ds:KeyInfo>` con el certificado
 * en X509Certificate. Producible y verificable con cualquier verificador
 * XMLDSig estándar.
 *
 * **NO incluye** (todavía) las propiedades cualificadas XAdES-BES
 * (`<xades:QualifyingProperties>`, `<xades:SigningCertificate>`,
 * `<xades:SigningTime>`, etc.). El envío real a AEAT requiere XAdES completo
 * — pendiente de ADR sobre librería (xadesjs vs. xml-crypto vs. propio).
 * Mientras tanto, este signer es suficiente para que el SubmitWorker y el
 * StubAeatClient funcionen end-to-end en dev/test.
 *
 * Asunciones de entrada:
 * - El XML ya viene canonicalizado (C14N 1.0) por el generador del payload.
 *   El digest se calcula sobre los bytes literales recibidos.
 * - El XML tiene un único elemento raíz con etiqueta de cierre `</Tag>`.
 *   La firma se inserta como último hijo del raíz (enveloped).
 */
@Injectable()
export class SignerService {
  private readonly log = new Logger(SignerService.name);

  constructor(private readonly vault: CertificateVaultService) {}

  async sign(tenantId: string, xml: string): Promise<SignResult> {
    const p12 = await this.vault.loadDecryptedP12(tenantId);
    const { privateKey, certificate } = extractKeyAndCert(p12);

    // Reference: digest del XML original (en el envelope la transformación
    // enveloped-signature quita la firma → como aún no la hay, equivale a
    // hashear los bytes literales).
    const refDigest = sha256Base64(Buffer.from(xml, 'utf-8'));

    const signedInfo = buildSignedInfo(refDigest);
    const sigBytes = rsaSha256Sign(privateKey, signedInfo);
    const sigValue = forge.util.encode64(sigBytes);
    const certB64 = forge.util.encode64(
      forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes(),
    );

    const signature = wrapSignature(signedInfo, sigValue, certB64);
    const signedXml = insertEnvelopedSignature(xml, signature);

    this.log.log(`Signed XML tenant=${tenantId} bytes=${xml.length} sigBytes=${sigBytes.length}`);

    return {
      xml: signedXml,
      digestValue: refDigest,
      signatureValue: sigValue,
      signingCertificate: certificate,
    };
  }
}

export interface SignResult {
  /** XML resultante con `<ds:Signature>` insertado como último hijo del raíz. */
  xml: string;
  /** Digest SHA-256 (base64) del XML de entrada. */
  digestValue: string;
  /** Valor de la firma RSA-SHA256 (base64). */
  signatureValue: string;
  /** Certificado usado (útil para tests / depuración). */
  signingCertificate: forge.pki.Certificate;
}

const DS = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';

function buildSignedInfo(refDigest: string): string {
  // Sin saltos de línea ni indentación: la cadena que firmamos debe ser
  // exactamente la que se inserta en el XML final, para que un verificador
  // re-extraiga bytes idénticos.
  return (
    `<ds:SignedInfo xmlns:ds="${DS}">` +
    `<ds:CanonicalizationMethod Algorithm="${C14N}"/>` +
    `<ds:SignatureMethod Algorithm="${RSA_SHA256}"/>` +
    `<ds:Reference URI="">` +
    `<ds:Transforms>` +
    `<ds:Transform Algorithm="${ENVELOPED}"/>` +
    `<ds:Transform Algorithm="${C14N}"/>` +
    `</ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${SHA256}"/>` +
    `<ds:DigestValue>${refDigest}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>`
  );
}

function wrapSignature(signedInfo: string, sigValue: string, certB64: string): string {
  return (
    `<ds:Signature xmlns:ds="${DS}">` +
    signedInfo +
    `<ds:SignatureValue>${sigValue}</ds:SignatureValue>` +
    `<ds:KeyInfo>` +
    `<ds:X509Data>` +
    `<ds:X509Certificate>${certB64}</ds:X509Certificate>` +
    `</ds:X509Data>` +
    `</ds:KeyInfo>` +
    `</ds:Signature>`
  );
}

function insertEnvelopedSignature(xml: string, signature: string): string {
  // Inserta antes de la última etiqueta de cierre `</X>` del documento, que
  // — para un XML con un único elemento raíz bien formado — es el cierre
  // del raíz. Restricción documentada en el JSDoc del servicio.
  const lastClose = xml.lastIndexOf('</');
  if (lastClose < 0) {
    throw new Error('Input XML has no closing tag — cannot insert enveloped signature');
  }
  return xml.slice(0, lastClose) + signature + xml.slice(lastClose);
}

function sha256Base64(bytes: Buffer): string {
  const md = forge.md.sha256.create();
  md.update(bytes.toString('binary'));
  return forge.util.encode64(md.digest().bytes());
}

function rsaSha256Sign(key: forge.pki.PrivateKey, data: string): string {
  const md = forge.md.sha256.create();
  md.update(data, 'utf8');
  // forge.pki.PrivateKey es un union; los certificados PKCS#12 que aceptamos
  // siempre son RSA en la práctica Verifactu. El método .sign() existe en
  // rsa.PrivateKey.
  return (key as forge.pki.rsa.PrivateKey).sign(md);
}

function extractKeyAndCert(p12Buffer: Buffer): {
  privateKey: forge.pki.PrivateKey;
  certificate: forge.pki.Certificate;
} {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12Buffer.toString('binary')));
  // `null` indica a forge "sin passphrase" (los bags no están cifrados).
  // Las typings de @types/node-forge declaran `string | undefined` aquí.
  const pfx = forge.pkcs12.pkcs12FromAsn1(asn1, false, null as unknown as string);

  const certBagOid = forge.pki.oids.certBag as string;
  const certificate = pfx.getBags({ bagType: certBagOid })[certBagOid]?.[0]?.cert;
  if (!certificate) {
    throw new Error('Stored PKCS#12 archive does not contain a certificate');
  }

  const shrouded = forge.pki.oids.pkcs8ShroudedKeyBag as string;
  const plain = forge.pki.oids.keyBag as string;
  const privateKey =
    pfx.getBags({ bagType: shrouded })[shrouded]?.[0]?.key ??
    pfx.getBags({ bagType: plain })[plain]?.[0]?.key;
  if (!privateKey) {
    throw new Error('Stored PKCS#12 archive does not contain a private key');
  }

  return { privateKey, certificate };
}
