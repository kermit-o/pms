'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  propertyId: string;
}

const TARGET_MAX_DIM = 1280;
const JPEG_QUALITY = 0.7;

export function LostFoundForm({ propertyId }: Props) {
  const router = useRouter();
  const [roomId, setRoomId] = useState('');
  const [description, setDescription] = useState('');
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handlePhoto(file: File) {
    // Decode + downscale on a canvas to keep payloads <500 kB. Without this
    // a 12 MP iPhone capture is ~6 MB before base64-inflation and the API
    // payload limit (or Postgres TEXT) will reject it.
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, TARGET_MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * ratio);
    const h = Math.round(bitmap.height * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    setPhotoBase64(dataUrl);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/proxy/lost-found', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          roomId: roomId.trim() || undefined,
          description: description.trim(),
          photoBase64: photoBase64 ?? undefined,
        }),
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error((await res.text()) || `HTTP ${res.status}`);
      }
      setDescription('');
      setRoomId('');
      setPhotoBase64(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100"
    >
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
        Descripción
        <textarea
          required
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="p.ej. cargador iPhone, color blanco"
          className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base focus:border-aubergine-500 focus:outline-none"
        />
      </label>

      <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
        Habitación (UUID, opcional)
        <input
          type="text"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="UUID"
          className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base focus:border-aubergine-500 focus:outline-none"
        />
      </label>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Foto (opcional)
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handlePhoto(f).catch((err) => setError((err as Error).message));
          }}
          className="mt-1 block w-full text-sm"
        />
        {photoBase64 && (
          <img
            src={photoBase64}
            alt="vista previa"
            className="mt-2 max-h-48 rounded-lg ring-1 ring-aubergine-100"
          />
        )}
      </div>

      <button
        type="submit"
        disabled={busy || description.trim().length === 0}
        className="w-full rounded-xl bg-aubergine-600 py-3 text-base font-semibold text-white disabled:opacity-50"
      >
        Registrar objeto
      </button>
    </form>
  );
}
