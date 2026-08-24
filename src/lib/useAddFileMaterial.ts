import { useAppStore } from '../store/useAppStore'
import { useToastStore } from '../store/toastStore'
import { canUseCloudStorage, uploadMaterialFile } from './storage'

const LOCAL_MAX_BYTES = 3 * 1024 * 1024 // 3MB cap only applies to the offline/local-only fallback

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function useAddFileMaterial() {
  const addMaterial = useAppStore((s) => s.addMaterial)
  const updateMaterial = useAppStore((s) => s.updateMaterial)
  const currentUserId = useAppStore((s) => s.currentUserId)
  const push = useToastStore((s) => s.push)

  return async (subjectId: string, file: File, titleOverride?: string) => {
    const title = titleOverride?.trim() || file.name.replace(/\.[^./]+$/, '')

    if (canUseCloudStorage(currentUserId)) {
      const material = addMaterial({ subjectId, type: 'file', title, fileName: file.name })
      const path = await uploadMaterialFile(currentUserId, material.id, file)
      if (path) {
        updateMaterial(material.id, { filePath: path })
      } else {
        push({ title: 'Caricamento non riuscito', description: file.name, tone: 'warn' })
      }
      return material
    }

    if (file.size > LOCAL_MAX_BYTES) {
      push({
        title: 'File troppo grande',
        description: `"${file.name}" supera i 3MB consentiti in locale. Accedi per caricare file più grandi nel cloud.`,
        tone: 'warn',
      })
      return null
    }
    const dataUrl = await readAsDataUrl(file)
    return addMaterial({ subjectId, type: 'file', title, fileName: file.name, fileDataUrl: dataUrl })
  }
}
