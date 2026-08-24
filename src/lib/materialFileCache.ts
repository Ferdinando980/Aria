/**
 * Client-side cache for material files fetched from Supabase Storage
 * (2026-08-24, real user request/diagnosis: 98.3% of a real month's Storage
 * bill was Storage Egress, not database/API -- traced to PDFs being
 * re-downloaded from Storage on every single open, even to re-view a
 * section read minutes earlier). IndexedDB, not a new dependency -- a
 * material file is exactly the kind of "fetch once, read many times within
 * a study session" data IndexedDB is for, and Aria already claims "PWA che
 * funziona offline" as a real requirement (see CLAUDE.md), so caching the
 * actual study material locally is completing that promise, not adding a
 * new one.
 *
 * Keyed by Storage path (stable per material unless explicitly replaced --
 * see invalidateMaterialFileCache(), called by useReplaceMaterialFile.ts).
 * Simple LRU-by-cachedAt eviction under a total size cap -- PDFs run 5-50MB
 * each, an unbounded cache would just move the problem from "Supabase
 * Storage bill" to "browser storage quota exhausted".
 */

const DB_NAME = 'aria-material-cache'
const STORE = 'files'
const DB_VERSION = 1
// Generous but bounded (2026-08-24) -- most browsers grant a PWA well over
// this before prompting/evicting on their own; capped here so this cache
// can't itself become an unbounded liability the way the uncached fetches
// were.
const MAX_TOTAL_BYTES = 400 * 1024 * 1024

interface CacheEntry {
  path: string
  blob: Blob
  size: number
  cachedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'path' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getCachedMaterialBlob(path: string): Promise<Blob | null> {
  try {
    const entry = await withStore<CacheEntry | undefined>('readonly', (s) => s.get(path))
    return entry?.blob ?? null
  } catch {
    // Cache is a pure optimization -- any failure (quota, private mode,
    // browser without IndexedDB) just means "no cache hit", never a broken
    // material load.
    return null
  }
}

async function evictOldestUntilUnderCap(incomingSize: number): Promise<void> {
  const all = await withStore<CacheEntry[]>('readonly', (s) => s.getAll())
  let total = all.reduce((sum, e) => sum + e.size, 0) + incomingSize
  if (total <= MAX_TOTAL_BYTES) return
  const byAge = [...all].sort((a, b) => a.cachedAt - b.cachedAt)
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  for (const entry of byAge) {
    if (total <= MAX_TOTAL_BYTES) break
    store.delete(entry.path)
    total -= entry.size
  }
}

export async function setCachedMaterialBlob(path: string, blob: Blob): Promise<void> {
  try {
    await evictOldestUntilUnderCap(blob.size)
    await withStore('readwrite', (s) => s.put({ path, blob, size: blob.size, cachedAt: Date.now() } satisfies CacheEntry))
  } catch {
    // Same fail-open reasoning as getCachedMaterialBlob -- a cache write
    // failure (quota exceeded, etc.) must never block showing the file the
    // caller already fetched successfully.
  }
}

/** Called after a material's underlying file is actually replaced (2026-08-24,
 * see useReplaceMaterialFile.ts -- "Salva nel file" reuses the same Storage
 * path with upsert, so the cache must be told explicitly rather than
 * inferring a change from the path alone). */
export async function invalidateMaterialFileCache(path: string): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(path))
  } catch {
    // Fail-open: worst case a stale blob serves once more until it ages out.
  }
}
