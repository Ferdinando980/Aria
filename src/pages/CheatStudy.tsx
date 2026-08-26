import { useEffect, useMemo, useState } from 'react'
import { GraduationCap, Sparkles, Loader2, ArrowLeft, BookOpen, ChevronDown, ChevronRight, RefreshCw, UploadCloud, Link2, X, Pencil, Check, ListOrdered, Download, type LucideIcon } from 'lucide-react'
import { Card, CardTitle, CardSubtitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useAppStore } from '../store/useAppStore'
import { useToastStore } from '../store/toastStore'
import { generateCheatStudySolution, generateEquivalentExercise, generatePrerequisiteExercises, generateChapters, generateExercisesFromImage, hasGeminiKey, GEMINI_MODEL } from '../lib/gemini'
import { isViewableInline, getChapterScopedText, extractPdfTextByPage, CHAPTER_DETECTION_OPTS } from '../lib/materialContent'
import { getMaterialFileBlob } from '../lib/storage'
import { useAddFileMaterial } from '../lib/useAddFileMaterial'
import { cn, contrastTextColor, uid } from '../lib/utils'
import type { SkillEvent, ChapterSection, MaterialChapter, Material } from '../lib/types'
import { routeSkills, routeMaterialKnowledge, skillsAsPromptContext, tagsFromText, maybeDistillFromExchanges, CHEAT_STUDY_TASK_TAGS } from '../lib/skills'
import { enforceSkillBudget } from '../lib/contextBudget'
import { MessageFeedback } from '../components/shared/MessageFeedback'
import { CheatStudySteps } from '../components/shared/CheatStudySteps'

/**
 * Cheat Study (2026-08-25/26, rebuilt after a real user correction to the
 * first design). The mental model, exactly as specified:
 *
 *   TRACCIA D'ESAME (input obbligatorio, caricata QUI)
 *     -> analisi esercizi (rilevamento capitoli riusato, ogni capitolo/
 *        sezione = un esercizio) -> tag dal TESTO REALE dell'esercizio,
 *        non dal solo titolo
 *     -> materiale collegato? (opzionale, configurazione della sessione,
 *        MAI l'input di ricerca -- la traccia decide COSA cercare, il
 *        materiale collegato decide DOVE)
 *          si -> cerca nelle skill/sezioni di QUEI materiali soltanto
 *                (overlap di tag + material_knowledge già distillata),
 *                mai full-text, mai un secondo materiale ricaricato per
 *                intero -- solo getChapterScopedText sulla sezione giusta
 *          no -> Gemini genera comunque, dichiarando esplicitamente che
 *                non è ancorato al materiale dell'utente
 *     -> due output per esercizio, sempre entrambi disponibili:
 *          A. spiegazione  B. esercizio equivalente
 */

interface MatchedSection {
  materialId: string
  materialTitle: string
  chapter: MaterialChapter
  section?: ChapterSection
  overlap: number
}

const MAX_MATCHES = 4

/** Colored badge chip for each of the three output sections (2026-08-26,
 * real user mockup: "badge colorato + icona (corallo = base, verde =
 * spiegazione, viola = esplorativo)") -- adapted to this app's existing
 * dark palette rather than the mockup's own light one (explicit user
 * correction: "il mockup è per la forma non per tutto... lascialo tema
 * scuro"), reusing the three semantic tokens that already have the right
 * hues (index.css: warn=coral/orange, good=mint-green, primary=indigo). */
/** Drops the model's own grounding-disclosure line ("[NOTA] ...", see
 * GROUNDED_NOTE/UNGROUNDED_NOTE in gemini.ts) before printing -- honest and
 * useful on screen (CheatStudySteps still renders it as a normal callout
 * there), but app-internal commentary that doesn't belong on a printed
 * worksheet (2026-08-26, real user correction, see the print-area's own
 * comment for the full context). Single line by prompt design ("in una
 * riga"), so a plain line filter is enough -- no multi-line segment
 * grouping needed. */
function stripNotaForPrint(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('[NOTA]'))
    .join('\n')
}

function SectionBadge({ icon: Icon, label, color }: { icon: LucideIcon; label: string; color: 'var(--color-warn)' | 'var(--color-good)' | 'var(--color-primary)' }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide"
      style={{ background: `color-mix(in srgb, ${color} 18%, var(--color-surface))`, color }}
    >
      <Icon size={14} />
      {label}
    </span>
  )
}

async function readFileBuffer(material: Material): Promise<ArrayBuffer | null> {
  if (material.filePath) {
    const blob = await getMaterialFileBlob(material.filePath, material.fileUpdatedAt)
    return blob ? blob.arrayBuffer() : null
  }
  if (material.fileDataUrl) return (await fetch(material.fileDataUrl)).arrayBuffer()
  return null
}

/** Raw bytes -> base64 for Gemini's inlineData, no "data:...;base64," prefix
 * -- same shape as ChatAttachment (gemini.ts) built elsewhere from a File. */
function bufferToBase64(buf: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export default function CheatStudy() {
  const subjects = useAppStore((s) => s.subjects)
  const materials = useAppStore((s) => s.materials)
  const removeMaterial = useAppStore((s) => s.removeMaterial)
  const chapters = useAppStore((s) => s.chapters)
  const setMaterialChapters = useAppStore((s) => s.setMaterialChapters)
  const setCheatStudyLinkedMaterials = useAppStore((s) => s.setCheatStudyLinkedMaterials)
  const solutions = useAppStore((s) => s.cheatStudySolutions)
  const setCheatStudySolution = useAppStore((s) => s.setCheatStudySolution)
  const exercises = useAppStore((s) => s.cheatStudyExercises)
  const setCheatStudyExercise = useAppStore((s) => s.setCheatStudyExercise)
  const prereqs = useAppStore((s) => s.cheatStudyPrereqs)
  const setCheatStudyPrereq = useAppStore((s) => s.setCheatStudyPrereq)
  const skills = useAppStore((s) => s.skills)
  const librarianEnabled = useAppStore((s) => s.librarianEnabled)
  const logSkillCall = useAppStore((s) => s.logSkillCall)
  const addSkill = useAppStore((s) => s.addSkill)
  const push = useToastStore((s) => s.push)
  const addFileMaterial = useAddFileMaterial()

  const [subjectId, setSubjectId] = useState('')
  const [examMaterialId, setExamMaterialId] = useState('')
  const [exerciseChapterId, setExerciseChapterId] = useState('')
  const [exerciseSectionId, setExerciseSectionId] = useState('')
  const [exerciseText, setExerciseText] = useState('')
  // Editable "bozza" of what Aria actually read from the traccia (2026-08-26,
  // real user request: "ti fa vedere cosa ha preso dalla traccia... lo lasci
  // modificabile, così che se la generazione immagine non ha funzionato,
  // l'utente stesso può aggiustarla"). Persists into the SAME
  // transcribedText field the image-detection path already uses (see
  // MaterialChapter/ChapterSection.transcribedText) -- a manual correction
  // and an OCR transcription are the same kind of thing (this exercise's
  // authoritative text), so PDF exercises get an override slot too, not just
  // images, via the exact same field and code path.
  const [editingExerciseText, setEditingExerciseText] = useState(false)
  const [exerciseTextDraft, setExerciseTextDraft] = useState('')
  const [uploading, setUploading] = useState(false)
  const [detecting, setDetecting] = useState(false)
  // Real drag&drop for the traccia dropzone (2026-08-26, real user report:
  // it LOOKED like a dropzone -- dashed border, upload icon -- but only
  // ever handled a click-to-browse <input>, no onDrop at all, same pattern
  // Materials.tsx already uses for its own file drop).
  const [dragOver, setDragOver] = useState(false)
  const [showLinkPicker, setShowLinkPicker] = useState(false)
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null)
  const [matchTexts, setMatchTexts] = useState<Record<string, string>>({})
  const [loadingMatch, setLoadingMatch] = useState<string | null>(null)
  const [generatingSolution, setGeneratingSolution] = useState(false)
  const [generatingExercise, setGeneratingExercise] = useState(false)
  const [generatingPrereq, setGeneratingPrereq] = useState(false)
  const [lastSolutionCall, setLastSolutionCall] = useState<SkillEvent | undefined>(undefined)
  const [lastExerciseCall, setLastExerciseCall] = useState<SkillEvent | undefined>(undefined)
  const [lastPrereqCall, setLastPrereqCall] = useState<SkillEvent | undefined>(undefined)
  // Independent collapse per section (2026-08-26, real user request right
  // after seeing the page get a third output: "aggiungi la funzionalità di
  // comprimere esercizi di base, testo estratto, esercizi generati e
  // spiegazione così se uno vuole vederne solo 1 vede solo quello") -- each
  // of the four cards toggles on its own, not a forced single-tab. Testo
  // estratto defaults open (it's the input-verification step, already
  // expected visible); the three generated outputs default collapsed so a
  // freshly picked exercise starts compact, not with three "genera" prompts
  // stacked in view -- each one still auto-opens right after ITS OWN
  // successful generation, since asking for something and then having it
  // stay hidden would be a worse surprise than a compact default.
  const [textOpen, setTextOpen] = useState(true)
  const [prereqOpen, setPrereqOpen] = useState(false)
  const [solutionOpen, setSolutionOpen] = useState(false)
  const [exerciseOpen, setExerciseOpen] = useState(false)
  // PDF export, one section at a time (2026-08-26, real user correction:
  // "dovrei poter scaricare le sezioni divise come pdf, non tutto insieme")
  // -- #print-area (below) only ever renders the ONE section matching this,
  // so window.print() -> "Salva come PDF" produces a file for just that
  // section. Set, then print on the next tick so the print-area's content
  // has actually updated before the browser's print engine reads it --
  // calling window.print() synchronously right after setState would race
  // React's render. setTimeout, not requestAnimationFrame -- verified live
  // that rAF callbacks are paused outright while the tab is backgrounded
  // (document.visibilityState 'hidden'), which would silently strand this
  // print until the tab is refocused; a plain macrotask still fires either way.
  const [printTarget, setPrintTarget] = useState<'prereq' | 'solution' | 'exercise' | null>(null)
  useEffect(() => {
    if (!printTarget) return
    const id = setTimeout(() => {
      window.print()
      setPrintTarget(null)
    }, 0)
    return () => clearTimeout(id)
  }, [printTarget])

  // Real study material only -- exam papers are excluded here (2026-08-26,
  // real user correction: "le tracce di esame NON devono essere messe in
  // materiale... dovrebbe essere una cosa a parte") so this list (used below
  // for the "materiale collegato" picker) can never offer another traccia as
  // if it were something to study FROM.
  const subjectMaterials = materials.filter((m) => m.subjectId === subjectId && isViewableInline(m) && !m.isExamPaper)
  // Tracce already uploaded through THIS section's own dropzone -- flagged
  // at upload time (see handleUpload/Material.isExamPaper), not inferred
  // from "has chapters" (a real study material can have chapters too, from
  // Materiali's own "Rileva capitoli" button).
  const examMaterials = materials.filter((m) => m.subjectId === subjectId && m.isExamPaper)
  const examMaterial = materials.find((m) => m.id === examMaterialId)
  const examChapters = chapters.filter((c) => c.materialId === examMaterialId).sort((a, b) => a.order - b.order)
  const exerciseChapter = examChapters.find((c) => c.id === exerciseChapterId)
  const exerciseSection = exerciseChapter?.subsections.find((s) => s.id === exerciseSectionId)
  const exerciseTitle = exerciseSection?.title ?? exerciseChapter?.title ?? ''

  const linkedIds = examMaterial?.cheatStudyLinkedMaterialIds ?? []
  const linkedMaterials = subjectMaterials.filter((m) => linkedIds.includes(m.id) && m.id !== examMaterialId)
  const linkableMaterials = subjectMaterials.filter((m) => m.id !== examMaterialId)

  const activeSolution = solutions.find((s) => s.examMaterialId === examMaterialId && s.chapterId === exerciseChapterId && s.sectionId === (exerciseSectionId || undefined))
  const activeExercise = exercises.find((s) => s.examMaterialId === examMaterialId && s.chapterId === exerciseChapterId && s.sectionId === (exerciseSectionId || undefined))
  const activePrereq = prereqs.find((s) => s.examMaterialId === examMaterialId && s.chapterId === exerciseChapterId && s.sectionId === (exerciseSectionId || undefined))

  // Il testo REALE dell'esercizio, non solo il titolo -- serve sia per i tag
  // (capisce quali argomenti servono) sia come input di generazione.
  useEffect(() => {
    setExerciseText('')
    if (!examMaterial || !exerciseChapter) return
    // Immagine: il testo era già trascritto interamente al momento del
    // rilevamento (vedi detectExercises) -- non c'è nessuna pagina PDF da
    // ri-estrarre, getChapterScopedText non si applica qui.
    const transcribed = exerciseSection?.transcribedText ?? exerciseChapter.transcribedText
    if (transcribed !== undefined) {
      setExerciseText(transcribed)
      return
    }
    let cancelled = false
    getChapterScopedText(examMaterial, exerciseChapter, exerciseSection).then(({ text }) => {
      if (!cancelled) setExerciseText(text)
    })
    return () => {
      cancelled = true
    }
  }, [examMaterial, exerciseChapter, exerciseSection])

  // Cerca SOLO nei materiali collegati (mai in tutta la materia) -- overlap
  // di tag tra il testo reale dell'esercizio e i titoli capitolo/sezione,
  // stesso meccanismo deterministico usato da routeSkills(), niente ricerca
  // full-text o online.
  const matches = useMemo<MatchedSection[]>(() => {
    if (!exerciseText.trim() || linkedMaterials.length === 0) return []
    const exerciseTags = new Set(tagsFromText(exerciseText))
    if (exerciseTags.size === 0) return []
    const candidates: MatchedSection[] = []
    for (const m of linkedMaterials) {
      for (const c of chapters.filter((x) => x.materialId === m.id)) {
        if (c.subsections.length === 0) {
          const overlap = tagsFromText(c.title).filter((t) => exerciseTags.has(t)).length
          if (overlap > 0) candidates.push({ materialId: m.id, materialTitle: m.title, chapter: c, overlap })
        }
        for (const sec of c.subsections) {
          const overlap = tagsFromText(sec.title).filter((t) => exerciseTags.has(t)).length
          if (overlap > 0) candidates.push({ materialId: m.id, materialTitle: m.title, chapter: c, section: sec, overlap })
        }
      }
    }
    return candidates.sort((a, b) => b.overlap - a.overlap).slice(0, MAX_MATCHES)
  }, [exerciseText, linkedMaterials, chapters])

  function pickSubject(id: string) {
    setSubjectId(id)
    setExamMaterialId('')
    setExerciseChapterId('')
    setExerciseSectionId('')
    setShowLinkPicker(false)
    setLastSolutionCall(undefined)
    setLastExerciseCall(undefined)
    setLastPrereqCall(undefined)
  }
  function pickExamMaterial(id: string) {
    setExamMaterialId(id)
    setExerciseChapterId('')
    setExerciseSectionId('')
    setShowLinkPicker(false)
    setLastSolutionCall(undefined)
    setLastExerciseCall(undefined)
    setLastPrereqCall(undefined)
  }
  // Real user request (2026-08-26): "manca l'opzione per cancellare il
  // materiale di traccia già caricato" -- removeMaterial() already cleans
  // up everything derived from it (chapters, cheatStudySolutions/Exercises
  // keyed on this examMaterialId, sync delete), same as deleting any other
  // material from Materiali -- this just exposes it here too.
  function removeExamMaterial(id: string) {
    // Real live bug (2026-08-26): deleting a traccia while its own
    // upload/detection was still in flight (handleUpload -> detectExercises,
    // still holding a reference to the material object) left the pipeline
    // hanging with zero further network activity -- uploading/detecting
    // never cleared, "Carica una traccia" stuck spinning forever until a
    // full reload. Root cause inside the in-flight chain not fully isolated
    // -- guarded at the source instead: never allow a delete while any
    // upload/detection is running (same disabled condition on the button).
    if (uploading || detecting) return
    if (examMaterialId === id) {
      setExamMaterialId('')
      setExerciseChapterId('')
      setExerciseSectionId('')
      setLastSolutionCall(undefined)
      setLastExerciseCall(undefined)
    }
    removeMaterial(id)
    push({ title: 'Traccia eliminata', tone: 'good' })
  }
  function pickExercise(chapterId: string, sectionId: string) {
    setExerciseChapterId(chapterId)
    setExerciseSectionId(sectionId)
    setExpandedMatch(null)
    setLastSolutionCall(undefined)
    setLastExerciseCall(undefined)
    setLastPrereqCall(undefined)
    setEditingExerciseText(false)
    setTextOpen(true)
    setPrereqOpen(false)
    setSolutionOpen(false)
    setExerciseOpen(false)
  }

  /** Persists a manual correction to the exercise text -- see the state
   * declaration's comment. Rebuilds the FULL chapters array for this exam
   * material (setMaterialChapters replaces wholesale, matched back to
   * existing ids positionally) with only the active chapter/section's
   * transcribedText changed, everything else passed through untouched. */
  function saveExerciseTextEdit() {
    if (!examMaterial || !exerciseChapter) return
    const rebuilt = examChapters.map((c) => ({
      title: c.title,
      startPage: c.startPage,
      endPage: c.endPage,
      transcribedText: c.id === exerciseChapterId && !exerciseSectionId ? exerciseTextDraft : c.transcribedText,
      subsections: c.subsections.map((s) => (c.id === exerciseChapterId && s.id === exerciseSectionId ? { ...s, transcribedText: exerciseTextDraft } : s)),
    }))
    setMaterialChapters(examMaterial.id, rebuilt)
    setExerciseText(exerciseTextDraft)
    setEditingExerciseText(false)
    push({ title: 'Testo della traccia aggiornato', tone: 'good' })
  }

  async function detectExercises(material: Material) {
    if (!hasGeminiKey()) {
      push({ title: 'Serve una chiave Gemini', description: 'Aggiungila in Impostazioni.', tone: 'warn' })
      return
    }
    setDetecting(true)
    try {
      const isImage = (material.fileName ?? '').match(/\.(png|jpe?g|webp|heic)$/i)
      const buf = await readFileBuffer(material)
      if (!buf) throw new Error('no_file')

      if (isImage) {
        // Vision transcribes each exercise's full text directly (no PDF
        // pages to point back to later) -- see gemini.ts's
        // generateExercisesFromImage. One "page" total, purely to satisfy
        // MaterialChapter's page-range fields; never used for real lookup
        // since transcribedText is read instead everywhere downstream.
        const mimeType = material.fileName?.match(/\.png$/i) ? 'image/png' : material.fileName?.match(/\.webp$/i) ? 'image/webp' : 'image/jpeg'
        const found = await generateExercisesFromImage(bufferToBase64(buf), mimeType)
        if (found.length === 0) {
          push({ title: 'Non sono riuscita a leggere esercizi da questa immagine', tone: 'warn' })
          return
        }
        setMaterialChapters(
          material.id,
          found.map((e) => ({ title: e.title, startPage: 1, endPage: 1, transcribedText: e.text })),
        )
        push({ title: `${found.length} esercizi individuati dall'immagine`, tone: 'good' })
        return
      }

      const { pages } = await extractPdfTextByPage(buf, CHAPTER_DETECTION_OPTS)
      const suggested = await generateChapters(material.title, pages)
      if (suggested.length === 0) {
        push({ title: 'Non sono riuscita a dividere la traccia in esercizi', tone: 'warn' })
        return
      }
      setMaterialChapters(
        material.id,
        suggested.map((c) => ({ ...c, subsections: (c.subsections ?? []).map((s) => ({ ...s, id: uid() })) })),
      )
      push({ title: `${suggested.length} esercizi individuati`, tone: 'good' })
    } catch {
      push({ title: 'Analisi della traccia non riuscita', description: 'Riprova tra poco.', tone: 'warn' })
    } finally {
      setDetecting(false)
    }
  }

  async function handleUpload(file: File) {
    if (!subjectId) return
    setUploading(true)
    try {
      const material = await addFileMaterial(subjectId, file, undefined, { isExamPaper: true })
      if (!material) return
      setExamMaterialId(material.id)
      setExerciseChapterId('')
      setExerciseSectionId('')
      await detectExercises(material)
    } finally {
      setUploading(false)
    }
  }

  function toggleLinkedMaterial(materialId: string) {
    if (!examMaterial) return
    const next = linkedIds.includes(materialId) ? linkedIds.filter((id) => id !== materialId) : [...linkedIds, materialId]
    setCheatStudyLinkedMaterials(examMaterial.id, next)
  }

  async function toggleMatch(match: MatchedSection) {
    const key = `${match.chapter.id}:${match.section?.id ?? ''}`
    if (expandedMatch === key) {
      setExpandedMatch(null)
      return
    }
    setExpandedMatch(key)
    if (matchTexts[key]) return
    const transcribed = match.section?.transcribedText ?? match.chapter.transcribedText
    if (transcribed !== undefined) {
      setMatchTexts((m) => ({ ...m, [key]: transcribed }))
      return
    }
    const material = materials.find((m) => m.id === match.materialId)
    if (!material) return
    setLoadingMatch(key)
    try {
      const { text } = await getChapterScopedText(material, match.chapter, match.section)
      setMatchTexts((m) => ({ ...m, [key]: text }))
    } finally {
      setLoadingMatch(null)
    }
  }

  /** Testo reale della sezione + eventuale skill material_knowledge già
   * distillata per quello scope -- mai un secondo materiale ricaricato per
   * intero, solo ciò che serve a QUESTO esercizio. null (non stringa vuota)
   * quando non c'è nulla di collegato/trovato, cosi' i generatori sanno di
   * dover dichiarare il fallback invece di mostrare un contesto vuoto. */
  async function buildStudyContext(): Promise<string | null> {
    if (matches.length === 0) return null
    const parts = await Promise.all(
      matches.map(async (m) => {
        const key = `${m.chapter.id}:${m.section?.id ?? ''}`
        const transcribed = m.section?.transcribedText ?? m.chapter.transcribedText
        const text = matchTexts[key] ?? transcribed ?? (await (async () => {
          const material = materials.find((x) => x.id === m.materialId)
          if (!material) return ''
          const { text: t } = await getChapterScopedText(material, m.chapter, m.section)
          setMatchTexts((cur) => ({ ...cur, [key]: t }))
          return t
        })())
        const knowledge = routeMaterialKnowledge(skills, m.materialId, { chapterId: m.chapter.id, sectionId: m.section?.id })
        const knowledgeText = knowledge.length > 0 ? `\n[skill già distillate]\n${skillsAsPromptContext(knowledge)}` : ''
        return `[${m.materialTitle} — ${m.section?.title ?? m.chapter.title}]\n${text}${knowledgeText}`
      }),
    )
    return parts.filter(Boolean).join('\n\n') || null
  }

  function prepareSkillCall(): { skillContext: string; callEvent: SkillEvent } {
    if (!librarianEnabled) return { skillContext: '', callEvent: logSkillCall('cheat_study', 'B', [], GEMINI_MODEL) }
    const retrieved = routeSkills(skills, 'cheat_study', [`material:${examMaterialId}`, ...CHEAT_STUDY_TASK_TAGS, ...tagsFromText(exerciseTitle)], 2, 1, useAppStore.getState().skillEvents)
    const budgeted = enforceSkillBudget(exerciseText, retrieved, GEMINI_MODEL)
    if (budgeted.baseOverBudget || budgeted.droppedSkillIds.length > 0) {
      console.warn('[contextBudget] skill context ridotto per budget', { domain: 'cheat_study', ...budgeted })
    }
    return {
      skillContext: skillsAsPromptContext(budgeted.skills),
      callEvent: logSkillCall('cheat_study', budgeted.skills.length > 0 ? 'F' : 'B', budgeted.skills.map((s) => s.id), GEMINI_MODEL),
    }
  }

  async function generateSolution() {
    if (!examMaterial || !exerciseChapter) return
    if (!hasGeminiKey()) {
      push({ title: 'Serve una chiave Gemini', description: 'Aggiungila in Impostazioni.', tone: 'warn' })
      return
    }
    setGeneratingSolution(true)
    try {
      const studyContext = await buildStudyContext()
      const { skillContext, callEvent } = prepareSkillCall()
      const content = await generateCheatStudySolution(exerciseTitle, exerciseText, studyContext, skillContext)
      if (!content) {
        push({ title: 'Non sono riuscita a generare una spiegazione', tone: 'warn' })
        return
      }
      setCheatStudySolution(examMaterial.id, exerciseChapter.id, exerciseSection?.id, content)
      setLastSolutionCall(callEvent)
      setSolutionOpen(true)
      push({ title: 'Spiegazione pronta', tone: 'good' })
    } catch {
      push({ title: 'Generazione non riuscita', description: 'Riprova tra poco.', tone: 'warn' })
    } finally {
      setGeneratingSolution(false)
    }
  }

  async function generateExercise() {
    if (!examMaterial || !exerciseChapter) return
    if (!hasGeminiKey()) {
      push({ title: 'Serve una chiave Gemini', description: 'Aggiungila in Impostazioni.', tone: 'warn' })
      return
    }
    setGeneratingExercise(true)
    try {
      const studyContext = await buildStudyContext()
      const { skillContext, callEvent } = prepareSkillCall()
      const content = await generateEquivalentExercise(exerciseTitle, exerciseText, studyContext, skillContext)
      if (!content) {
        push({ title: 'Non sono riuscita a generare un esercizio equivalente', tone: 'warn' })
        return
      }
      setCheatStudyExercise(examMaterial.id, exerciseChapter.id, exerciseSection?.id, content)
      setLastExerciseCall(callEvent)
      setExerciseOpen(true)
      push({ title: 'Esercizio equivalente pronto', tone: 'good' })
    } catch {
      push({ title: 'Generazione non riuscita', description: 'Riprova tra poco.', tone: 'warn' })
    } finally {
      setGeneratingExercise(false)
    }
  }

  async function generatePrereqs() {
    if (!examMaterial || !exerciseChapter) return
    if (!hasGeminiKey()) {
      push({ title: 'Serve una chiave Gemini', description: 'Aggiungila in Impostazioni.', tone: 'warn' })
      return
    }
    setGeneratingPrereq(true)
    try {
      const studyContext = await buildStudyContext()
      const { skillContext, callEvent } = prepareSkillCall()
      const content = await generatePrerequisiteExercises(exerciseTitle, exerciseText, studyContext, skillContext)
      if (!content) {
        push({ title: 'Non sono riuscita a generare gli esercizi di base', tone: 'warn' })
        return
      }
      setCheatStudyPrereq(examMaterial.id, exerciseChapter.id, exerciseSection?.id, content)
      setLastPrereqCall(callEvent)
      setPrereqOpen(true)
      push({ title: 'Esercizi di base pronti', tone: 'good' })
    } catch {
      push({ title: 'Generazione non riuscita', description: 'Riprova tra poco.', tone: 'warn' })
    } finally {
      setGeneratingPrereq(false)
    }
  }

  function tryDistill(callEvent: SkillEvent | undefined, content: string) {
    if (!callEvent) return
    const messages = [
      { role: 'user' as const, text: `Esercizio: ${exerciseTitle}` },
      { role: 'model' as const, text: content, skillEventRef: callEvent.id },
    ]
    maybeDistillFromExchanges('cheat_study', messages, useAppStore.getState().skillEvents)
      .then((candidate) => candidate && addSkill({ ...candidate, capabilityTags: [...candidate.capabilityTags, `material:${examMaterialId}`] }))
      .catch(() => {})
  }

  return (
    <div>
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <GraduationCap size={22} className="text-[var(--color-primary)]" />
          Cheat Study
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Carica una traccia d'esame — Aria individua gli esercizi e cosa serve sapere per risolverli. Collega del materiale (opzionale) per farglielo
          recuperare dalle skill invece che a memoria.
        </p>
      </div>

      <div className="mb-4">
        <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">Materia</p>
        <div className="flex flex-wrap gap-2">
          {subjects.map((s) => (
            <button
              key={s.id}
              onClick={() => pickSubject(s.id)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ background: subjectId === s.id ? s.color : 'var(--color-surface-2)', color: subjectId === s.id ? contrastTextColor(s.color) : 'var(--color-ink-muted)' }}
            >
              {s.name}
            </button>
          ))}
          {subjects.length === 0 && <p className="text-xs text-[var(--color-ink-muted)]">Crea prima una materia in Materiali.</p>}
        </div>
      </div>

      {!subjectId && (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-[var(--color-ink-muted)]">
          <ArrowLeft size={16} />
          Scegli una materia qui sopra per iniziare.
        </div>
      )}

      {subjectId && (
        <div className="flex flex-col gap-4">
          <Card>
            <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">Traccia d'esame</p>
            <label
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('Files') || uploading || detecting) return
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                if (!e.dataTransfer.types.includes('Files')) return
                e.preventDefault()
                setDragOver(false)
                if (uploading || detecting) return
                const file = e.dataTransfer.files?.[0]
                if (file) handleUpload(file)
              }}
              className={cn(
                'mb-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-xs font-medium transition-colors',
                dragOver ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-ink-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]',
              )}
            >
              {uploading || detecting ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
              {uploading ? 'Carico...' : detecting ? 'Individuo gli esercizi...' : dragOver ? 'Rilascia qui' : 'Carica una traccia (PDF o foto) — o trascinala qui'}
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
                className="hidden"
                disabled={uploading || detecting}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) handleUpload(file)
                }}
              />
            </label>
            {examMaterials.length > 0 && (
              <>
                <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">...oppure riprendi una traccia già caricata</p>
                <div className="flex flex-wrap gap-2">
                  {examMaterials.map((m) => (
                    <div key={m.id} className="group relative">
                      <button
                        onClick={() => pickExamMaterial(m.id)}
                        className={cn(
                          'rounded-full py-1.5 pl-3 pr-7 text-xs font-medium',
                          examMaterialId === m.id ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
                        )}
                      >
                        {m.title}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (uploading || detecting) return
                          removeExamMaterial(m.id)
                        }}
                        disabled={uploading || detecting}
                        title={uploading || detecting ? 'Aspetta che finisca il caricamento/analisi prima di eliminare' : 'Elimina questa traccia'}
                        className={cn(
                          'absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed disabled:group-hover:opacity-0',
                          examMaterialId === m.id ? 'text-white/80 hover:text-white' : 'text-[var(--color-ink-muted)] hover:text-[var(--color-warn)]',
                        )}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          {examMaterial && (
            <Card>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-[var(--color-ink-muted)]">Materiale di studio collegato (opzionale)</p>
                <button onClick={() => setShowLinkPicker((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-[var(--color-primary)]">
                  <Link2 size={13} /> {linkedMaterials.length > 0 ? `${linkedMaterials.length} collegati` : 'Collega'}
                </button>
              </div>
              <CardSubtitle className="mb-2">
                {linkedMaterials.length > 0
                  ? "Aria cerca prima nelle skill di questo materiale. Se non basta, usa comunque Gemini per completare."
                  : 'Niente collegato — Aria userà Gemini per costruire il materiale necessario, dichiarandolo.'}
              </CardSubtitle>
              {showLinkPicker && (
                <div className="flex flex-wrap gap-2">
                  {linkableMaterials.map((m) => {
                    const linked = linkedIds.includes(m.id)
                    return (
                      <button
                        key={m.id}
                        onClick={() => toggleLinkedMaterial(m.id)}
                        className={cn(
                          'flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium',
                          linked ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
                        )}
                      >
                        {linked && <X size={11} />}
                        {m.title}
                      </button>
                    )
                  })}
                  {linkableMaterials.length === 0 && <p className="text-xs text-[var(--color-ink-muted)]">Nessun altro materiale in questa materia da collegare.</p>}
                </div>
              )}
            </Card>
          )}

          {examMaterial && (
            <Card>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-[var(--color-ink-muted)]">Esercizio</p>
                <button
                  onClick={() => detectExercises(examMaterial)}
                  disabled={detecting || uploading}
                  title="Rianalizza la traccia e rileva di nuovo gli esercizi"
                  className="flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--color-primary)] disabled:opacity-50"
                >
                  {detecting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  Rigenera
                </button>
              </div>
              {examChapters.length === 0 && !detecting && (
                <p className="text-xs text-[var(--color-ink-muted)]">
                  Nessun esercizio rilevato per questa traccia. Riprova con "Rigenera" — se continua a non funzionare, controlla la chiave Gemini in Impostazioni.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {examChapters.map((c) =>
                  c.subsections.length === 0 ? (
                    <button
                      key={c.id}
                      onClick={() => pickExercise(c.id, '')}
                      className={cn('rounded-full px-3 py-1.5 text-xs font-medium', exerciseChapterId === c.id ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]')}
                    >
                      {c.title}
                    </button>
                  ) : (
                    c.subsections.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => pickExercise(c.id, s.id)}
                        className={cn(
                          'rounded-full px-3 py-1.5 text-xs font-medium',
                          exerciseChapterId === c.id && exerciseSectionId === s.id ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
                        )}
                      >
                        {s.title}
                      </button>
                    ))
                  ),
                )}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>

    {exerciseChapter && (
      <div className="mt-4 flex max-w-3xl flex-col gap-4">
          <Card>
            <div className="mb-1 flex items-center justify-between gap-2">
              <button onClick={() => setTextOpen((v) => !v)} className="flex min-w-0 items-center gap-2 text-left">
                {textOpen ? <ChevronDown size={15} className="shrink-0 text-[var(--color-ink-muted)]" /> : <ChevronRight size={15} className="shrink-0 text-[var(--color-ink-muted)]" />}
                <BookOpen size={15} className="shrink-0 text-[var(--color-primary)]" />
                <CardTitle>Testo estratto dalla traccia</CardTitle>
              </button>
              {textOpen && !editingExerciseText && (
                <button
                  onClick={() => {
                    setExerciseTextDraft(exerciseText)
                    setEditingExerciseText(true)
                  }}
                  title="Correggi il testo"
                  className="flex shrink-0 items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-primary)]"
                >
                  <Pencil size={13} /> Correggi
                </button>
              )}
            </div>
            {textOpen && (
              <>
                <CardSubtitle className="mb-3">
                  Quello che Aria ha letto per "{exerciseTitle}" -- se il riconoscimento (specialmente da foto) ha sbagliato qualcosa, correggilo qui prima di generare.
                </CardSubtitle>
                {editingExerciseText ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={exerciseTextDraft}
                      onChange={(e) => setExerciseTextDraft(e.target.value)}
                      rows={10}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm leading-relaxed text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveExerciseTextEdit}>
                        <Check size={14} /> Salva
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingExerciseText(false)}>
                        Annulla
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto whitespace-pre-line rounded-xl bg-[var(--color-surface-2)] p-3 text-sm leading-relaxed text-[var(--color-ink-muted)]">
                    {exerciseText || 'Nessun testo estraibile.'}
                  </div>
                )}
              </>
            )}
          </Card>

          {linkedMaterials.length > 0 && (
            <Card>
              <div className="mb-1 flex items-center gap-2">
                <BookOpen size={15} className="text-[var(--color-primary)]" />
                <CardTitle>Sezioni trovate nel materiale collegato</CardTitle>
              </div>
              <CardSubtitle className="mb-3">Trovate per te tramite le skill, non generate — per esercitarti prima di vedere la soluzione.</CardSubtitle>
              {matches.length === 0 && (
                <p className="text-xs text-[var(--color-ink-muted)]">Nessuna corrispondenza per "{exerciseTitle}" nel materiale collegato — la spiegazione userà Gemini, dichiarandolo.</p>
              )}
              <div className="flex flex-col gap-2">
                {matches.map((m) => {
                  const key = `${m.chapter.id}:${m.section?.id ?? ''}`
                  const open = expandedMatch === key
                  return (
                    <div key={key} className="rounded-xl border border-[var(--color-border)]">
                      <button onClick={() => toggleMatch(m)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--color-ink)]">{m.section?.title ?? m.chapter.title}</p>
                          <p className="truncate text-xs text-[var(--color-ink-muted)]">{m.materialTitle}</p>
                        </div>
                        {open ? <ChevronDown size={15} className="shrink-0 text-[var(--color-ink-muted)]" /> : <ChevronRight size={15} className="shrink-0 text-[var(--color-ink-muted)]" />}
                      </button>
                      {open && (
                        <div className="max-h-72 overflow-y-auto border-t border-[var(--color-border)] px-3 py-2.5 text-sm leading-relaxed text-[var(--color-ink-muted)]">
                          {loadingMatch === key ? <Loader2 size={14} className="animate-spin" /> : matchTexts[key] || 'Nessun testo estraibile.'}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* Ognuna delle tre card seguenti collassa in modo indipendente
           * (2026-08-26, real user request: "aggiungi la funzionalità di
           * comprimere esercizi di base, testo estratto, esercizi generati e
           * spiegazione così se uno vuole vederne solo 1 vede solo quello")
           * -- stesso pattern header-toggle già in uso qui sopra per "Testo
           * estratto" e per ogni singolo match in "Sezioni trovate". Default
           * collassate finché non generate/aperte esplicitamente, cosi' un
           * esercizio appena scelto parte compatto invece che con tre
           * prompt "genera" impilati in vista. */}
          <Card>
            <button onClick={() => setPrereqOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
              <SectionBadge icon={ListOrdered} label="Esercizi di base" color="var(--color-warn)" />
              <span className="flex shrink-0 items-center gap-2">
                {activePrereq && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warn)]" />}
                {prereqOpen ? <ChevronDown size={15} className="text-[var(--color-ink-muted)]" /> : <ChevronRight size={15} className="text-[var(--color-ink-muted)]" />}
              </span>
            </button>
            {prereqOpen &&
              (activePrereq ? (
                <div className="mt-2">
                  <div className="mb-3 rounded-xl bg-[var(--color-surface-2)] p-5 text-base leading-loose">
                    <CheatStudySteps text={activePrereq.content} />
                  </div>
                  {lastPrereqCall && <MessageFeedback key={lastPrereqCall.id} callEvent={lastPrereqCall} onGiven={() => tryDistill(lastPrereqCall, activePrereq.content)} />}
                  <div className="flex gap-2">
                    <Button size="sm" variant="soft" onClick={generatePrereqs} disabled={generatingPrereq}>
                      {generatingPrereq ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      Rigenera
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPrintTarget('prereq')} title="Scarica un PDF di questa sezione">
                      <Download size={14} />
                      Scarica PDF
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-col items-center gap-3 py-6 text-center">
                  <CardSubtitle>Prima di affrontarlo intero: una scaletta di esercizi più piccoli, dal più facile in su.</CardSubtitle>
                  <Button size="sm" onClick={generatePrereqs} disabled={generatingPrereq}>
                    {generatingPrereq ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Genera esercizi di base
                  </Button>
                </div>
              ))}
          </Card>

          <Card>
            <button onClick={() => setSolutionOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
              <SectionBadge icon={Sparkles} label="Spiegazione" color="var(--color-good)" />
              <span className="flex shrink-0 items-center gap-2">
                {activeSolution && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-good)]" />}
                {solutionOpen ? <ChevronDown size={15} className="text-[var(--color-ink-muted)]" /> : <ChevronRight size={15} className="text-[var(--color-ink-muted)]" />}
              </span>
            </button>
            {solutionOpen &&
              (activeSolution ? (
                <div className="mt-2">
                  <div className="mb-3 rounded-xl bg-[var(--color-surface-2)] p-5 text-base leading-loose">
                    <CheatStudySteps text={activeSolution.content} />
                  </div>
                  {lastSolutionCall && <MessageFeedback key={lastSolutionCall.id} callEvent={lastSolutionCall} onGiven={() => tryDistill(lastSolutionCall, activeSolution.content)} />}
                  <div className="flex gap-2">
                    <Button size="sm" variant="soft" onClick={generateSolution} disabled={generatingSolution}>
                      {generatingSolution ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      Rigenera
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPrintTarget('solution')} title="Scarica un PDF di questa sezione">
                      <Download size={14} />
                      Scarica PDF
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-col items-center gap-3 py-6 text-center">
                  <CardSubtitle>Cosa serve sapere per risolvere questo esercizio, spiegato passo passo.</CardSubtitle>
                  <Button size="sm" onClick={generateSolution} disabled={generatingSolution}>
                    {generatingSolution ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Genera spiegazione
                  </Button>
                </div>
              ))}
          </Card>

          <Card>
            <button onClick={() => setExerciseOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
              <SectionBadge icon={RefreshCw} label="Esercizio equivalente" color="var(--color-primary)" />
              <span className="flex shrink-0 items-center gap-2">
                {activeExercise && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" />}
                {exerciseOpen ? <ChevronDown size={15} className="text-[var(--color-ink-muted)]" /> : <ChevronRight size={15} className="text-[var(--color-ink-muted)]" />}
              </span>
            </button>
            {exerciseOpen &&
              (activeExercise ? (
                <div className="mt-2">
                  <div className="mb-3 rounded-xl bg-[var(--color-surface-2)] p-5 text-base leading-loose">
                    <CheatStudySteps text={activeExercise.content} />
                  </div>
                  {lastExerciseCall && <MessageFeedback key={lastExerciseCall.id} callEvent={lastExerciseCall} onGiven={() => tryDistill(lastExerciseCall, activeExercise.content)} />}
                  <div className="flex gap-2">
                    <Button size="sm" variant="soft" onClick={generateExercise} disabled={generatingExercise}>
                      {generatingExercise ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      Un altro
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPrintTarget('exercise')} title="Scarica un PDF di questa sezione">
                      <Download size={14} />
                      Scarica PDF
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-col items-center gap-3 py-6 text-center">
                  <CardSubtitle>Un esercizio nuovo, stesso concetto, per allenarti oltre alla traccia originale.</CardSubtitle>
                  <Button size="sm" onClick={generateExercise} disabled={generatingExercise}>
                    {generatingExercise ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Genera esercizio equivalente
                  </Button>
                </div>
              ))}
          </Card>

          {/* Off-screen, print-only (2026-08-26, real user request: "vorrei
           * poter scaricare un pdf degli esercizi base e dell'equivalente
           * generati e anche della spiegazione", poi corretto: "dovrei
           * poter scaricare le sezioni divise come pdf, non tutto insieme")
           * -- real window.print(), not a hand-rolled pdf-lib layout: this
           * content already has KaTeX math, Mermaid SVG figures, and the
           * choice-card grid rendered correctly on screen, and the
           * browser's print engine reproduces all of it as real vector/text
           * PDF content for free. #print-area + index.css's @media print
           * rule is what isolates this from the rest of the app (sidebar,
           * buttons) without this file needing to know the real layout's
           * DOM shape. Positioned off left of the viewport, not
           * display:none -- display:none would also remove it from print.
           * Renders ONLY the section matching printTarget (set by that
           * section's own "Scarica PDF" button) -- one file per section,
           * never all three bundled together.
           *
           * No app chrome (2026-08-26, real user correction: "i pdf
           * generati contengono... nome del file... Spiegazione, Esercizio
           * equivalente. Questi titoli non devono esserci... deve essere
           * usato come possibilità di generare una prova vera e propria") --
           * the point is a clean worksheet, usable as a real practice exam,
           * not a labeled export of the app's own UI. No file title, no
           * "Esercizio N" picker label, no section badge headings, and
           * stripNotaForPrint() below drops the model's own grounding
           * disclosure line ("[NOTA] Nessun materiale collegato...") --
           * honest and useful on screen, meaningless on a printed exercise.
           * The original exercise statement stays for Esercizi di
           * base/Spiegazione (real context for what they're about), but not
           * for Esercizio equivalente -- that output is already a complete,
           * standalone new problem; showing the old one above it would be
           * exactly the kind of clutter this fix is for. */}
          <div id="print-area" className="absolute -left-[9999px] top-0 max-w-3xl">
            {printTarget !== 'exercise' && <p className="mb-4 whitespace-pre-line text-sm leading-relaxed">{exerciseText}</p>}
            {printTarget === 'prereq' && activePrereq && <CheatStudySteps text={stripNotaForPrint(activePrereq.content)} />}
            {printTarget === 'solution' && activeSolution && <CheatStudySteps text={stripNotaForPrint(activeSolution.content)} />}
            {printTarget === 'exercise' && activeExercise && <CheatStudySteps text={stripNotaForPrint(activeExercise.content)} />}
          </div>
      </div>
    )}
  </div>
  )
}
