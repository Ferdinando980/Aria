import { useEffect, useMemo, useState } from 'react'
import { GraduationCap, Sparkles, Loader2, ArrowLeft, BookOpen, ChevronDown, ChevronRight, RefreshCw, UploadCloud, Link2, X } from 'lucide-react'
import { Card, CardTitle, CardSubtitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useAppStore } from '../store/useAppStore'
import { useToastStore } from '../store/toastStore'
import { generateCheatStudySolution, generateEquivalentExercise, generateChapters, generateExercisesFromImage, hasGeminiKey, GEMINI_MODEL } from '../lib/gemini'
import { isViewableInline, getChapterScopedText, extractPdfTextByPage, CHAPTER_DETECTION_OPTS } from '../lib/materialContent'
import { getMaterialFileBlob } from '../lib/storage'
import { useAddFileMaterial } from '../lib/useAddFileMaterial'
import { cn, contrastTextColor, uid } from '../lib/utils'
import type { SkillEvent, ChapterSection, MaterialChapter, Material } from '../lib/types'
import { routeSkills, routeMaterialKnowledge, skillsAsPromptContext, tagsFromText, maybeDistillFromExchanges } from '../lib/skills'
import { enforceSkillBudget } from '../lib/contextBudget'
import { MessageFeedback } from '../components/shared/MessageFeedback'
import { MarkdownLite } from '../components/shared/MarkdownLite'

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
  const chapters = useAppStore((s) => s.chapters)
  const setMaterialChapters = useAppStore((s) => s.setMaterialChapters)
  const setCheatStudyLinkedMaterials = useAppStore((s) => s.setCheatStudyLinkedMaterials)
  const solutions = useAppStore((s) => s.cheatStudySolutions)
  const setCheatStudySolution = useAppStore((s) => s.setCheatStudySolution)
  const exercises = useAppStore((s) => s.cheatStudyExercises)
  const setCheatStudyExercise = useAppStore((s) => s.setCheatStudyExercise)
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
  const [uploading, setUploading] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [showLinkPicker, setShowLinkPicker] = useState(false)
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null)
  const [matchTexts, setMatchTexts] = useState<Record<string, string>>({})
  const [loadingMatch, setLoadingMatch] = useState<string | null>(null)
  const [generatingSolution, setGeneratingSolution] = useState(false)
  const [generatingExercise, setGeneratingExercise] = useState(false)
  const [lastSolutionCall, setLastSolutionCall] = useState<SkillEvent | undefined>(undefined)
  const [lastExerciseCall, setLastExerciseCall] = useState<SkillEvent | undefined>(undefined)

  const subjectMaterials = materials.filter((m) => m.subjectId === subjectId && isViewableInline(m))
  const examMaterials = subjectMaterials.filter((m) => chapters.some((c) => c.materialId === m.id))
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
  }
  function pickExamMaterial(id: string) {
    setExamMaterialId(id)
    setExerciseChapterId('')
    setExerciseSectionId('')
    setShowLinkPicker(false)
    setLastSolutionCall(undefined)
    setLastExerciseCall(undefined)
  }
  function pickExercise(chapterId: string, sectionId: string) {
    setExerciseChapterId(chapterId)
    setExerciseSectionId(sectionId)
    setExpandedMatch(null)
    setLastSolutionCall(undefined)
    setLastExerciseCall(undefined)
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
      const material = await addFileMaterial(subjectId, file)
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
    const retrieved = routeSkills(skills, 'cheat_study', [`material:${examMaterialId}`, ...tagsFromText(exerciseTitle)], 2, 1, useAppStore.getState().skillEvents)
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
      push({ title: 'Esercizio equivalente pronto', tone: 'good' })
    } catch {
      push({ title: 'Generazione non riuscita', description: 'Riprova tra poco.', tone: 'warn' })
    } finally {
      setGeneratingExercise(false)
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
              className={cn(
                'mb-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-xs font-medium transition-colors',
                'border-[var(--color-border)] text-[var(--color-ink-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]',
              )}
            >
              {uploading || detecting ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
              {uploading ? 'Carico...' : detecting ? 'Individuo gli esercizi...' : 'Carica una traccia (PDF o foto)'}
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
                    <button
                      key={m.id}
                      onClick={() => pickExamMaterial(m.id)}
                      className={cn('rounded-full px-3 py-1.5 text-xs font-medium', examMaterialId === m.id ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]')}
                    >
                      {m.title}
                    </button>
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
              <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">Esercizio</p>
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

          {exerciseChapter && linkedMaterials.length > 0 && (
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

          {exerciseChapter && (
            <Card>
              <div className="mb-1 flex items-center gap-2">
                <Sparkles size={15} className="text-[var(--color-primary)]" />
                <CardTitle>Spiegazione</CardTitle>
              </div>
              {activeSolution ? (
                <>
                  <MarkdownLite text={activeSolution.content} className="mb-3 rounded-xl bg-[var(--color-surface-2)] p-5 text-base leading-loose" />
                  {lastSolutionCall && <MessageFeedback key={lastSolutionCall.id} callEvent={lastSolutionCall} onGiven={() => tryDistill(lastSolutionCall, activeSolution.content)} />}
                  <Button size="sm" variant="soft" onClick={generateSolution} disabled={generatingSolution}>
                    {generatingSolution ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Rigenera
                  </Button>
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <CardSubtitle>Cosa serve sapere per risolvere questo esercizio, spiegato passo passo.</CardSubtitle>
                  <Button size="sm" onClick={generateSolution} disabled={generatingSolution}>
                    {generatingSolution ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Genera spiegazione
                  </Button>
                </div>
              )}
            </Card>
          )}

          {exerciseChapter && (
            <Card>
              <div className="mb-1 flex items-center gap-2">
                <RefreshCw size={15} className="text-[var(--color-primary)]" />
                <CardTitle>Esercizio equivalente</CardTitle>
              </div>
              {activeExercise ? (
                <>
                  <MarkdownLite text={activeExercise.content} className="mb-3 rounded-xl bg-[var(--color-surface-2)] p-5 text-base leading-loose" />
                  {lastExerciseCall && <MessageFeedback key={lastExerciseCall.id} callEvent={lastExerciseCall} onGiven={() => tryDistill(lastExerciseCall, activeExercise.content)} />}
                  <Button size="sm" variant="soft" onClick={generateExercise} disabled={generatingExercise}>
                    {generatingExercise ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Un altro
                  </Button>
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <CardSubtitle>Un esercizio nuovo, stesso concetto, per allenarti oltre alla traccia originale.</CardSubtitle>
                  <Button size="sm" onClick={generateExercise} disabled={generatingExercise}>
                    {generatingExercise ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Genera esercizio equivalente
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
