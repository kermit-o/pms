'use client';

/**
 * IndexedDB-backed offline mutation queue.
 *
 * Mobile housekeeping flows must keep working in basements and lifts. We
 * capture POSTs locally, replay when navigator.onLine, and surface the queue
 * size to the UI so a camarera can see her work is pending sync.
 *
 * Records are minimal — URL + JSON body — so the same store can absorb
 * future endpoints (notes, lost & found, photos).
 */

const DB_NAME = 'aubergine-hsk';
const DB_VERSION = 1;
const STORE = 'mutations';

export interface QueuedMutation {
  id: number;
  url: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  body: unknown;
  enqueuedAt: number;
  attempts: number;
}

type NewMutation = Omit<QueuedMutation, 'id' | 'enqueuedAt' | 'attempts'>;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const out = fn(store);
    if (out instanceof IDBRequest) {
      out.onsuccess = () => resolve(out.result as T);
      out.onerror = () => reject(out.error);
    } else {
      out.then(resolve, reject);
    }
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

export async function enqueue(mutation: NewMutation): Promise<void> {
  if (!isBrowser()) return;
  const record = { ...mutation, enqueuedAt: Date.now(), attempts: 0 };
  await withStore('readwrite', (s) => s.add(record));
  notifyChange();
}

export async function listQueued(): Promise<QueuedMutation[]> {
  if (!isBrowser()) return [];
  return withStore<QueuedMutation[]>('readonly', (s) => s.getAll());
}

export async function size(): Promise<number> {
  if (!isBrowser()) return 0;
  return withStore<number>('readonly', (s) => s.count());
}

async function remove(id: number): Promise<void> {
  await withStore('readwrite', (s) => s.delete(id));
}

async function bumpAttempts(id: number): Promise<void> {
  await withStore('readwrite', (s) => {
    const get = s.get(id);
    get.onsuccess = () => {
      const rec = get.result as QueuedMutation | undefined;
      if (rec) {
        rec.attempts += 1;
        s.put(rec);
      }
    };
    return get;
  });
}

/**
 * Drains pending mutations one by one. Call after a successful login or on
 * `online` events. Returns counts so the caller can surface them.
 */
export async function flush(): Promise<{ flushed: number; failed: number }> {
  if (!isBrowser() || !navigator.onLine) return { flushed: 0, failed: 0 };
  const pending = await listQueued();
  let flushed = 0;
  let failed = 0;
  for (const m of pending) {
    try {
      const res = await fetch(m.url, {
        method: m.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(m.body ?? {}),
        cache: 'no-store',
      });
      // 2xx and 409 (idempotent conflicts — task already in target state) both
      // count as drained: the server has the truth.
      if (res.ok || res.status === 409) {
        await remove(m.id);
        flushed += 1;
      } else {
        await bumpAttempts(m.id);
        failed += 1;
      }
    } catch {
      await bumpAttempts(m.id);
      failed += 1;
      break; // stop the loop on network errors so we don't hammer offline.
    }
  }
  notifyChange();
  return { flushed, failed };
}

const listeners = new Set<() => void>();
function notifyChange(): void {
  for (const fn of listeners) fn();
}
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let bootstrapped = false;
export function bootstrap(): void {
  if (bootstrapped || !isBrowser()) return;
  bootstrapped = true;
  window.addEventListener('online', () => {
    void flush();
  });
  // Best-effort opportunistic flush every 30 s while the tab is alive.
  setInterval(() => {
    if (navigator.onLine) void flush();
  }, 30_000);
}
