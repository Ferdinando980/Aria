import { supabase, isSupabaseConfigured } from './supabase'

const BUCKET = 'materials'

export function canUseCloudStorage(userId: string | undefined): userId is string {
  return isSupabaseConfigured && Boolean(userId) && Boolean(supabase)
}

export async function uploadMaterialFile(userId: string, materialId: string, file: File): Promise<string | null> {
  if (!supabase) return null
  const safeName = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${userId}/${materialId}-${safeName}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
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

export async function deleteMaterialFile(path: string) {
  if (!supabase) return
  await supabase.storage.from(BUCKET).remove([path])
}
