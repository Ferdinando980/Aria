import { useAppStore } from '../store/useAppStore'
import { useToastStore } from '../store/toastStore'
import { canUseCloudStorage, uploadMaterialFile } from './storage'
import { nowIso } from './utils'

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

  return async (subjectId: string, file: File, titleOverride?: string, opts?: { isExamPaper?: boolean }) => {
    const title = titleOverride?.trim() || file.name.replace(/\.[^./]+$/, '')
    // Cheat Study's traccia upload (2026-08-26, see Material.isExamPaper) --
    // same storage/caching path as any other file, just flagged so it never
    // surfaces in Materiali/Flashcards/Riassunti's material pickers.
    const isExamPaper = opts?.isExamPaper

    if (canUseCloudStorage(currentUserId)) {
      const material = addMaterial({ subjectId, type: 'file', title, fileName: file.name, isExamPaper })
      const path = await uploadMaterialFile(currentUserId, material.id, file)
      if (path) {
        const fileUpdatedAt = nowIso()
        updateMaterial(material.id, { filePath: path, fileUpdatedAt })
        // Real bug found live (2026-08-26, user report: "analisi della
        // traccia non riuscita" right after upload): updateMaterial only
        // patches the STORE's copy -- this local `material` const, built
        // before the upload even started, never had filePath set on it.
        // Every caller that immediately acts on the returned material (e.g.
        // CheatStudy.tsx's handleUpload -> detectExercises) got an object
        // with no filePath AND no fileDataUrl, so readFileBuffer() always
        // returned null and the whole detection step failed silently into
        // the generic catch. Return the patched shape instead of the stale one.
        return { ...material, filePath: path, fileUpdatedAt }
      }
      push({ title: 'Caricamento non riuscito', description: file.name, tone: 'warn' })
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
    return addMaterial({ subjectId, type: 'file', title, fileName: file.name, fileDataUrl: dataUrl, isExamPaper })
  }
}
