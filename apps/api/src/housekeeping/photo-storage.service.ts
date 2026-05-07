import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Env } from '../config/env.schema';

/**
 * Almacenamiento de fotos para Lost & Found. Sprint 5 W4.
 *
 * Dos drivers:
 *   - 'inline': mantiene la photo como data URL base64 en DB (comodo en
 *     dev, sin dependencias externas). Es lo que hacia S4 W3.
 *   - 's3':    sube el binario a un bucket S3-compatible (Backblaze B2 EU,
 *     Cloudflare R2, AWS S3, MinIO) y devuelve una URL publica o firmada.
 *
 * El servicio decide al construirse en base a PHOTO_STORAGE_DRIVER. Si en
 * runtime configuran 's3' pero faltan credenciales, falla fail-fast en el
 * arranque — no esperamos al primer upload para descubrirlo.
 *
 * Convenciones de path en el bucket:
 *   <tenantId>/lost-found/<itemUuid>.<ext>
 * El path es estable: una misma foto NO se sobreescribe (cada item nuevo
 * recibe un uuid v4). Eso permite TTLs por subdir y backups consistentes.
 */
@Injectable()
export class PhotoStorageService implements OnModuleInit {
  private readonly log = new Logger(PhotoStorageService.name);
  private driver!: 'inline' | 's3';
  private s3Client?: S3Client;
  private bucket?: string;
  private publicUrlPrefix?: string;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    this.driver = this.config.get('PHOTO_STORAGE_DRIVER', { infer: true });
    if (this.driver === 'inline') {
      this.log.log('Photo storage driver: inline (base64 en DB)');
      return;
    }

    const bucket = this.config.get('PHOTO_STORAGE_BUCKET', { infer: true });
    const region = this.config.get('PHOTO_STORAGE_REGION', { infer: true });
    const endpoint = this.config.get('PHOTO_STORAGE_ENDPOINT', { infer: true });
    const accessKeyId = this.config.get('PHOTO_STORAGE_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = this.config.get('PHOTO_STORAGE_SECRET_ACCESS_KEY', { infer: true });
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'PHOTO_STORAGE_DRIVER=s3 requiere PHOTO_STORAGE_BUCKET, ' +
          'PHOTO_STORAGE_ACCESS_KEY_ID y PHOTO_STORAGE_SECRET_ACCESS_KEY',
      );
    }

    this.bucket = bucket;
    this.publicUrlPrefix = this.config.get('PHOTO_STORAGE_PUBLIC_URL_PREFIX', { infer: true });
    this.s3Client = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      // B2 + R2 requieren path-style — DNS resolves al bucket.region.endpoint
      // con virtual-host falla.
      forcePathStyle: endpoint != null,
    });
    this.log.log(`Photo storage driver: s3 (bucket=${bucket}, region=${region})`);
  }

  /**
   * Persiste la foto y devuelve un par (photoUrl, photoBase64) que el
   * caller pone en el row LostFoundItem. Solo una de las dos es no-null:
   *
   *   - driver=inline → photoBase64 = data URL, photoUrl = null
   *   - driver=s3     → photoUrl   = URL publica o CDN, photoBase64 = null
   *
   * `dataUrl` siempre es un data URL `data:image/...;base64,XXXX`. Lo
   * valida el DTO antes de llegar aqui.
   */
  async store(
    tenantId: string,
    itemId: string,
    dataUrl: string,
  ): Promise<{ photoUrl: string | null; photoBase64: string | null }> {
    if (this.driver === 'inline') {
      return { photoUrl: null, photoBase64: dataUrl };
    }

    const { mime, bytes, ext } = decodeDataUrl(dataUrl);
    const key = `${tenantId}/lost-found/${itemId}.${ext}`;

    await this.s3Client!.send(
      new PutObjectCommand({
        Bucket: this.bucket!,
        Key: key,
        Body: bytes,
        ContentType: mime,
        // No ACL public — la URL publica viene del CDN o queda firmada al
        // serializar. R2 y B2 no soportan ACL legacy; AWS S3 si pero
        // preferimos URLs firmadas o CDN delante.
      }),
    );

    const photoUrl = this.publicUrl(key);
    return { photoUrl, photoBase64: null };
  }

  /**
   * Genera la URL publica para mostrar la foto desde el frontend. Si el
   * bucket esta detras de un CDN (PHOTO_STORAGE_PUBLIC_URL_PREFIX), usa
   * esa URL. Si no, devuelve un signed URL con TTL configurable.
   *
   * Diseno deliberado: el frontend nunca recibe credenciales S3 — la API
   * firma cada lectura.
   */
  publicUrl(keyOrUrl: string): string {
    if (this.driver === 'inline') return keyOrUrl;
    if (this.publicUrlPrefix) {
      // CDN/R2/B2 publico: <prefix>/<key>
      const base = this.publicUrlPrefix.replace(/\/$/, '');
      const path = keyOrUrl.replace(/^\//, '');
      return `${base}/${path}`;
    }
    // Sin CDN — el signed URL se genera bajo demanda en
    // signedReadUrl(key). publicUrl devuelve solo la key opaca para que
    // el caller llame al firmador cuando vaya a renderizar.
    return keyOrUrl;
  }

  /**
   * Para items que se sirven sin CDN — firma una URL temporal de lectura.
   * El TTL viene de PHOTO_STORAGE_SIGNED_URL_TTL_SECONDS.
   */
  async signedReadUrl(key: string): Promise<string> {
    if (this.driver === 'inline' || !this.s3Client || !this.bucket) {
      throw new Error('signedReadUrl solo aplica al driver s3');
    }
    if (this.publicUrlPrefix) {
      // Hay CDN — la URL publica vale, no necesitamos firmar.
      return this.publicUrl(key);
    }
    const ttl = this.config.get('PHOTO_STORAGE_SIGNED_URL_TTL_SECONDS', { infer: true });
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    return getSignedUrl(this.s3Client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttl,
    });
  }

  /**
   * Genera un id estable para una foto nueva. El service de Lost & Found
   * lo usa antes de hacer el row insert para que el path en S3 coincida
   * con el id del item.
   */
  newItemId(): string {
    return randomUUID();
  }

  /**
   * Util para tests + telemetria.
   */
  getDriver(): 'inline' | 's3' {
    return this.driver;
  }
}

// ---------------------------------------------------------------------------

interface DecodedDataUrl {
  mime: string;
  ext: string;
  bytes: Buffer;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
};

function decodeDataUrl(dataUrl: string): DecodedDataUrl {
  // Patron: data:image/jpeg;base64,XXXX
  const match = /^data:([\w./+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error('photoBase64 no es un data URL valido');
  }
  const mime = match[1]!.toLowerCase();
  const ext = EXT_BY_MIME[mime] ?? 'bin';
  const bytes = Buffer.from(match[2]!, 'base64');
  return { mime, ext, bytes };
}
