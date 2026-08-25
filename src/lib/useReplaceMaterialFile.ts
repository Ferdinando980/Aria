import { useAppStore } from '../store/useAppStore'
import { canUseCloudStorage, uploadMaterialFile, invalidateMaterialFileCache } from './storage'
import { nowIso } from './utils'

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Overwrites a material's actual stored file (cloud storage path or local
 * base64, mirroring useAddFileMaterial's two modes) with a new PDF blob --
 * used by PdfEditor's "Salva nel file" so a correction is really in the
 * document from then on, not just an on-screen overlay or a separate
 * exported copy.
 */
export function useReplaceMaterialFile() {
  const updateMaterial = useAppStore((s) => s.updateMaterial)
  const currentUserId = useAppStore((s) => s.currentUserId)

  return async (materialId: string, fileName: string, blob: Blob): Promise<boolean> => {
    const file = new File([blob], fileName, { type: 'application/pdf' })
    if (canUseCloudStorage(currentUserId)) {
      const path = await uploadMaterialFile(currentUserId, materialId, file)
      if (!path) return false
      // The upload re-uses the SAME Storage path (upsert), so the client
      // cache has to be told explicitly that the old bytes are gone --
      // nothing about the path itself changes to signal that (2026-08-24).
      await invalidateMaterialFileCache(path)
      // fileUpdatedAt (2026-08-25): the cross-device half of that same fix --
      // a device that already had this material cached has no other way to
      // learn the file changed, since its own path is unchanged and nothing
      // pushes a fresh copy to it. See materialFileCache.ts.
      updateMaterial(materialId, { filePath: path, fileUpdatedAt: nowIso() })
      return true
    }
    const dataUrl = await readAsDataUrl(blob)
    updateMaterial(materialId, { fileDataUrl: dataUrl, fileUpdatedAt: nowIso() })
    return true
  }
}
