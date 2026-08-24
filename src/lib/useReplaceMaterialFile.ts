import { useAppStore } from '../store/useAppStore'
import { canUseCloudStorage, uploadMaterialFile } from './storage'

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
      updateMaterial(materialId, { filePath: path })
      return true
    }
    const dataUrl = await readAsDataUrl(blob)
    updateMaterial(materialId, { fileDataUrl: dataUrl })
    return true
  }
}
