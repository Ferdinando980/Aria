import { supabase, isSupabaseConfigured } from './supabase'
import { getCachedMaterialBlob, setCachedMaterialBlob, invalidateMaterialFileCache } from './materialFileCache'

export { invalidateMaterialFileCache }

const BUCKET = 'materials'

export function canUseCloudStorage(userId: string | undefined): userId is string {
  return isSupabaseConfigured && Boolean(userId) && Boolean(supabase)
}

export async function uploadMaterialFile(userId: string, materialId: string, file: File): Promise<string | null> {
  if (!supabase) return null
  const safeName = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${userId}/${materialId}-${safeName}`
  // cacheControl (2026-08-24, real user diagnosis from a real Supabase
  // billing breakdown: 98.3% Storage Egress vs 1.7% Cached Egress) -- a
  // study PDF never changes once uploaded (a real edit goes through
  // useReplaceMaterialFile's explicit invalidation, not a silent overwrite
  // meant to be picked up immediately), so a long cache lifetime is
  // correct, not just convenient: it's what moves repeat downloads from
  // paid Storage Egress onto Supabase's CDN cache. One year in seconds --
  // Supabase's own upload() option takes this as a string, not a number.
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, cacheControl: '31536000' })
  if (error) {
    console.warn('[storage] upload failed', error)
    return null
  }
  return path
}

export async function getMaterialFileUrl(path: string): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60)
  if (error) return null
  return data.signedUrl
}

/** The other half of the same fix, client-side: even with cacheControl set
 * on the bucket object, every open still cost a real HTTP round-trip
 * (served from Supabase's CDN cache, but still a request) -- this skips
 * the network path entirely on a cache hit. Every real consumer of a
 * material's bytes (MaterialViewer, ChaptersPanel, materialContent.ts)
 * should go through this instead of calling getMaterialFileUrl()+fetch()
 * directly, so a PDF opened once during a study session serves every
 * later read (viewer, chapter detection, summary generation, ...) from
 * this ONE cached copy instead of each call site re-downloading its own. */
// Real duplicate-download found live in Supabase's own request logs
// (2026-08-24): MaterialViewer and ChaptersPanel both call this on mount,
// and on the FIRST open of a material -- the exact moment the cache can't
// help yet -- neither has written to IndexedDB before the other's cache
// check runs, so both independently sign+fetch the full file. Same fix
// pattern as materialContent.ts's chapterScopedPagesCache: a per-path
// in-flight promise so concurrent callers share one real fetch instead of
// racing two.
const inFlightFetches = new Map<string, Promise<Blob | null>>()

async function fetchAndCacheMaterialFileBlob(path: string): Promise<Blob | null> {
  const url = await getMaterialFileUrl(path)
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    setCachedMaterialBlob(path, blob) // fire-and-forget -- never block the caller on a cache write
    return blob
  } catch {
    return null
  }
}

export async function getMaterialFileBlob(path: string): Promise<Blob | null> {
  const cached = await getCachedMaterialBlob(path)
  if (cached) return cached
  const inFlight = inFlightFetches.get(path)
  if (inFlight) return inFlight
  const promise = fetchAndCacheMaterialFileBlob(path).finally(() => inFlightFetches.delete(path))
  inFlightFetches.set(path, promise)
  return promise
}

export async function deleteMaterialFile(path: string) {
  if (!supabase) return
  await supabase.storage.from(BUCKET).remove([path])
  await invalidateMaterialFileCache(path)
}
