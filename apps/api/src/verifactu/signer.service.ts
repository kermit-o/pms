import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import * as forge from 'node-forge';
import * as xadesjs from 'xadesjs';
import * as xpath from 'xpath';
import { CertificateVaultService } from './certificate-vault.service';

/**
 * SignerService — firma digital XAdES-BES enveloped (ADR-031 opción 1).
 *
 * Pipeline:
 *  1. Carga el `.p12` desencriptado del vault.
 *  2. Extrae cert + clave privada con node-forge.
 *  3. Convierte la clave a CryptoKey vía WebCrypto (PKCS#8 DER → importKey).
 *  4. Parsea el XML de entrada a Document con @xmldom/xmldom.
 *  5. Llama a `xadesjs.SignedXml.Sign()` con:
 *     - Algoritmo RSASSA-PKCS1-v1_5 + SHA-256.
 *     - Reference URI="" con transforms enveloped + C14N 1.0.
 *     - `signingCertificate` (base64 DER) → genera `<xades:SigningCertificate>`.
 *     - `signingTime` → genera `<xades:SigningTime>`.
 *  6. Inyecta `<ds:Signature>` como último hijo del raíz.
 *  7. Serializa el documento firmado y lo devuelve.
 *
 * El resultado es XAdES-BES completo: `<ds:Signature>` con dos `<ds:Reference>`
 * (raíz + SignedProperties) y `<xades:QualifyingProperties>` con
 * `SigningTime` + `SigningCertificate`.
 *
 * NOTA — bootstrap WebCrypto:
 * xml-core/xadesjs requieren que se les inyecte (a) un Crypto engine y
 * (b) implementaciones DOM/XPath de Node. Esto se hace una sola vez en
 * `onModuleInit` y es idempotente.
 */
@Injectable()
export class SignerService implements OnModuleInit {
  private readonly log = new Logger(SignerService.name);

  constructor(private readonly vault: CertificateVaultService) {}

  onModuleInit(): void {
    // Engine criptográfico: globalThis.crypto (Node 20+ tiene WebCrypto nativo).
    xadesjs.Application.setEngine('nodejs', globalThis.crypto as Crypto);
    // DOM + XPath para xml-core. Idempotente — sobrescribir es OK.
    xadesjs.setNodeDependencies({ DOMParser, XMLSerializer, xpath });
    this.log.log('SignerService: WebCrypto engine + xmldom deps configured');
  }

  async sign(tenantId: string, xml: string): Promise<SignResult> {
    const p12 = await this.vault.loadDecryptedP12(tenantId);
    const { privateKey, certificate, certDerB64 } = extractKeyAndCert(p12);

    // PKCS#8 DER bytes para WebCrypto.importKey.
    const pkcs8Der = privateKeyToPkcs8Der(privateKey);

    const cryptoKey = await globalThis.crypto.subtle.importKey(
      'pkcs8',
      pkcs8Der.buffer as ArrayBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (!doc.documentElement) {
      throw new Error('Input XML has no root element');
    }

    const signedXml = new xadesjs.SignedXml();
    const signature = await signedXml.Sign(
      // xadesjs declara `Algorithm` (sin `hash`), pero acepta y propaga
      // RsaHashedKeyAlgorithm con `hash` en runtime.
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as unknown as Algorithm,
      cryptoKey,
      doc as unknown as Document,
      {
        references: [
          {
            hash: 'SHA-256',
            transforms: ['enveloped', 'c14n'],
            uri: '',
          },
        ],
        // signingCertificate va a <xades:SigningCertificate> (CertDigest +
        // IssuerSerial). x509 añade el certificado completo en
        // <ds:KeyInfo><ds:X509Data><ds:X509Certificate>, que AEAT y la
        // mayoría de validadores XMLDSig consumen como ruta primaria.
        signingCertificate: certDerB64,
        x509: [certDerB64],
        signingTime: { value: new Date() },
      },
    );

    // Inyectar la firma como último hijo del raíz (enveloped).
    const sigEl = signature.GetXml();
    if (!sigEl) throw new Error('xadesjs.Sign returned signature without GetXml()');
    doc.documentElement.appendChild(sigEl);

    const signedSerialized = new XMLSerializer().serializeToString(doc);

    this.log.log(
      `Signed XML tenant=${tenantId} bytes=${xml.length} signedBytes=${signedSerialized.length}`,
    );

    return {
      xml: signedSerialized,
      signingCertificate: certificate,
    };
  }
}

export interface SignResult {
  /** XML resultante con `<ds:Signature>` XAdES-BES enveloped. */
  xml: string;
  /** Certificado usado (útil para tests / depuración). */
  signingCertificate: forge.pki.Certificate;
}

function extractKeyAndCert(p12Buffer: Buffer): {
  privateKey: forge.pki.PrivateKey;
  certificate: forge.pki.Certificate;
  /** Cert serializado a DER y codificado en base64 (formato esperado por xadesjs). */
  certDerB64: string;
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

  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
  const certDerB64 = forge.util.encode64(certDer);

  return { privateKey, certificate, certDerB64 };
}

/** Convierte una RSA private key de forge a PKCS#8 DER (Uint8Array) para WebCrypto. */
function privateKeyToPkcs8Der(key: forge.pki.PrivateKey): Uint8Array {
  // forge.pki.wrapRsaPrivateKey envuelve un RSAPrivateKey (PKCS#1) en una
  // estructura PrivateKeyInfo (PKCS#8), que es el formato que WebCrypto.importKey
  // espera con `format: 'pkcs8'`.
  const pkcs1 = forge.pki.privateKeyToAsn1(key);
  const pkcs8 = forge.pki.wrapRsaPrivateKey(pkcs1);
  const der = forge.asn1.toDer(pkcs8).getBytes();
  const out = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) {
    out[i] = der.charCodeAt(i);
  }
  return out;
}
