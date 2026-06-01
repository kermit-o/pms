import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotoStorageService } from './photo-storage.service';
import type { Env } from '../config/env.schema';

// Mock @aws-sdk/client-s3 a nivel módulo. send() es una stub que captura
// el comando para que los tests verifiquen Key/Bucket/ContentType.
const sendMock = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ITEM_ID = '22222222-2222-2222-2222-222222222222';
// 1×1 pixel PNG transparente — base64 válido, lo más corto posible.
const TINY_PNG_DATAURL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';

interface EnvOverrides {
  driver?: 'inline' | 's3';
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  publicUrlPrefix?: string;
  signedTtlSeconds?: number;
}

function makeConfig(o: EnvOverrides = {}): ConfigService<Env, true> {
  return {
    get: (key: keyof Env) => {
      switch (key) {
        case 'PHOTO_STORAGE_DRIVER':
          return o.driver ?? 'inline';
        case 'PHOTO_STORAGE_BUCKET':
          return o.bucket;
        case 'PHOTO_STORAGE_REGION':
          return o.region ?? 'eu-central-003';
        case 'PHOTO_STORAGE_ENDPOINT':
          return o.endpoint;
        case 'PHOTO_STORAGE_ACCESS_KEY_ID':
          return o.accessKeyId;
        case 'PHOTO_STORAGE_SECRET_ACCESS_KEY':
          return o.secretAccessKey;
        case 'PHOTO_STORAGE_PUBLIC_URL_PREFIX':
          return o.publicUrlPrefix;
        case 'PHOTO_STORAGE_SIGNED_URL_TTL_SECONDS':
          return o.signedTtlSeconds ?? 3600;
        default:
          return undefined;
      }
    },
  } as unknown as ConfigService<Env, true>;
}

function bootInline(): PhotoStorageService {
  const svc = new PhotoStorageService(makeConfig({ driver: 'inline' }));
  svc.onModuleInit();
  return svc;
}

function bootS3(extra: EnvOverrides = {}): PhotoStorageService {
  const svc = new PhotoStorageService(
    makeConfig({
      driver: 's3',
      bucket: 'photos-test',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      ...extra,
    }),
  );
  svc.onModuleInit();
  return svc;
}

describe('PhotoStorageService — onModuleInit', () => {
  afterEach(() => {
    sendMock.mockClear();
  });

  it('inicia driver inline sin requerir credenciales', () => {
    const svc = bootInline();
    expect(svc.getDriver()).toBe('inline');
  });

  it('inicia driver s3 con credenciales completas', () => {
    const svc = bootS3();
    expect(svc.getDriver()).toBe('s3');
  });

  it('falla fail-fast si driver=s3 sin bucket', () => {
    const svc = new PhotoStorageService(
      makeConfig({ driver: 's3', accessKeyId: 'ak', secretAccessKey: 'sk' }),
    );
    expect(() => svc.onModuleInit()).toThrow(/PHOTO_STORAGE_BUCKET/);
  });

  it('falla fail-fast si driver=s3 sin access key', () => {
    const svc = new PhotoStorageService(
      makeConfig({ driver: 's3', bucket: 'b', secretAccessKey: 'sk' }),
    );
    expect(() => svc.onModuleInit()).toThrow(/PHOTO_STORAGE_ACCESS_KEY_ID/);
  });

  it('falla fail-fast si driver=s3 sin secret key', () => {
    const svc = new PhotoStorageService(
      makeConfig({ driver: 's3', bucket: 'b', accessKeyId: 'ak' }),
    );
    expect(() => svc.onModuleInit()).toThrow(/PHOTO_STORAGE_SECRET_ACCESS_KEY/);
  });
});

describe('PhotoStorageService.store (driver inline)', () => {
  afterEach(() => sendMock.mockClear());

  it('devuelve photoBase64 = dataUrl y photoUrl = null', async () => {
    const svc = bootInline();
    const r = await svc.store(TENANT_ID, ITEM_ID, TINY_PNG_DATAURL);
    expect(r).toEqual({ photoUrl: null, photoBase64: TINY_PNG_DATAURL });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('no valida el formato del data URL en modo inline (delega al caller)', async () => {
    const svc = bootInline();
    const r = await svc.store(TENANT_ID, ITEM_ID, 'no-es-un-data-url-pero-ok');
    expect(r.photoBase64).toBe('no-es-un-data-url-pero-ok');
  });
});

describe('PhotoStorageService.store (driver s3)', () => {
  afterEach(() => sendMock.mockClear());

  it('llama a s3.send() con Bucket, Key y ContentType correctos', async () => {
    const svc = bootS3();
    await svc.store(TENANT_ID, ITEM_ID, TINY_PNG_DATAURL);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd = sendMock.mock.calls[0]![0] as {
      input: { Bucket: string; Key: string; ContentType: string };
    };
    expect(cmd.input.Bucket).toBe('photos-test');
    expect(cmd.input.Key).toBe(`${TENANT_ID}/lost-found/${ITEM_ID}.png`);
    expect(cmd.input.ContentType).toBe('image/png');
  });

  it('devuelve photoUrl (no base64) tras subir', async () => {
    const svc = bootS3();
    const r = await svc.store(TENANT_ID, ITEM_ID, TINY_PNG_DATAURL);
    expect(r.photoBase64).toBeNull();
    expect(r.photoUrl).toBe(`${TENANT_ID}/lost-found/${ITEM_ID}.png`);
  });

  it('storeIn permite subdir custom (p.ej. hsk-inspection)', async () => {
    const svc = bootS3();
    const r = await svc.storeIn('hsk-inspection', TENANT_ID, ITEM_ID, TINY_PNG_DATAURL);
    const cmd = sendMock.mock.calls[0]![0] as { input: { Key: string } };
    expect(cmd.input.Key).toBe(`${TENANT_ID}/hsk-inspection/${ITEM_ID}.png`);
    expect(r.photoUrl).toContain('hsk-inspection');
  });

  it('rechaza un data URL inválido', async () => {
    const svc = bootS3();
    await expect(svc.store(TENANT_ID, ITEM_ID, 'no-es-un-data-url')).rejects.toThrow(
      /no es un data URL valido/,
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('usa ext "bin" para mimes desconocidos (forward-compat)', async () => {
    const svc = bootS3();
    const dataUrl = 'data:application/octet-stream;base64,AAAA';
    await svc.store(TENANT_ID, ITEM_ID, dataUrl);
    const cmd = sendMock.mock.calls[0]![0] as { input: { Key: string; ContentType: string } };
    expect(cmd.input.Key).toBe(`${TENANT_ID}/lost-found/${ITEM_ID}.bin`);
    expect(cmd.input.ContentType).toBe('application/octet-stream');
  });

  it('mapea image/jpeg → ext jpg', async () => {
    const svc = bootS3();
    const dataUrl = `data:image/jpeg;base64,${'A'.repeat(20)}`;
    await svc.store(TENANT_ID, ITEM_ID, dataUrl);
    const cmd = sendMock.mock.calls[0]![0] as { input: { Key: string } };
    expect(cmd.input.Key).toBe(`${TENANT_ID}/lost-found/${ITEM_ID}.jpg`);
  });
});

describe('PhotoStorageService.publicUrl', () => {
  it('con CDN prefix concatena correctamente (sin doble slash)', () => {
    const svc = bootS3({ publicUrlPrefix: 'https://cdn.example.com/photos/' });
    expect(svc.publicUrl('tenant/lost-found/abc.png')).toBe(
      'https://cdn.example.com/photos/tenant/lost-found/abc.png',
    );
  });

  it('con CDN prefix sin slash trailing también funciona', () => {
    const svc = bootS3({ publicUrlPrefix: 'https://cdn.example.com' });
    expect(svc.publicUrl('tenant/lost-found/abc.png')).toBe(
      'https://cdn.example.com/tenant/lost-found/abc.png',
    );
  });

  it('sin CDN prefix devuelve la key tal cual (caller debe firmarla)', () => {
    const svc = bootS3();
    expect(svc.publicUrl('tenant/lost-found/abc.png')).toBe('tenant/lost-found/abc.png');
  });

  it('en modo inline devuelve el input intacto', () => {
    const svc = bootInline();
    expect(svc.publicUrl(TINY_PNG_DATAURL)).toBe(TINY_PNG_DATAURL);
  });
});

describe('PhotoStorageService.signedReadUrl', () => {
  it('lanza error en modo inline (no aplica)', async () => {
    const svc = bootInline();
    await expect(svc.signedReadUrl('cualquier-key')).rejects.toThrow(/solo aplica al driver s3/);
  });

  it('si hay CDN prefix, devuelve la public URL sin firmar', async () => {
    const svc = bootS3({ publicUrlPrefix: 'https://cdn.example.com' });
    const url = await svc.signedReadUrl('tenant/lost-found/abc.png');
    expect(url).toBe('https://cdn.example.com/tenant/lost-found/abc.png');
  });
});

describe('PhotoStorageService.newItemId', () => {
  it('genera un UUID v4 válido', () => {
    const svc = bootInline();
    const id = svc.newItemId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('genera ids distintos en cada llamada', () => {
    const svc = bootInline();
    const ids = new Set([svc.newItemId(), svc.newItemId(), svc.newItemId()]);
    expect(ids.size).toBe(3);
  });
});
