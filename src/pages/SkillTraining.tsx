import { useEffect, useState } from 'react'
import { Dumbbell, UploadCloud, Loader2, ChevronDown, ChevronRight, Check, Pencil, ThumbsUp, ThumbsDown, Trash2, Power, Sparkles, RefreshCw, BookOpen, ArrowLeft, type LucideIcon } from 'lucide-react'
import { Card, CardTitle, CardSubtitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useAppStore } from '../store/useAppStore'
import { useToastStore } from '../store/toastStore'
import { generateCheatStudySolution, generateEquivalentExercise, generatePrerequisiteExercises, generateChapters, generateExercisesFromImage, hasGeminiKey, GEMINI_MODEL } from '../lib/gemini'
import { getChapterScopedText, extractPdfTextByPage, CHAPTER_DETECTION_OPTS } from '../lib/materialContent'
import { bufferToBase64 } from './CheatStudy'
import { cn, contrastTextColor, uid } from '../lib/utils'
import type { SkillEvent, MaterialChapter, ChapterSection } from '../lib/types'
import { routeSkills, skillsAsPromptContext, tagsFromText, classifyEditOutcome, distillFromEdit, CHEAT_STUDY_TASK_TAGS, type EditOutcome } from '../lib/skills'
import { enforceSkillBudget } from '../lib/contextBudget'
import { CheatStudySteps } from '../components/shared/CheatStudySteps'

/**
 * Sezione di addestramento/verifica skill (2026-08-26) -- SEPARATA da Cheat
 * Study (route/pagina proprie), ma NON una sua reimplementazione: opera
 * sugli stessi record reali (materials/chapters/cheat_study_solutions/
 * exercises/prereqs) e riusa DIRETTAMENTE i generatori di gemini.ts, mai
 * una copia -- vedi il modulo comment di CheatStudy.tsx per il modello
 * mentale che questa pagina condivide (traccia -> esercizi -> output).
 *
 * Cosa aggiunge, che Cheat Study non ha:
 * 1. Un caricamento MAI persistito su Storage (vedi handleUploadNoStorage
 *    sotto) -- solo la materials row di ancoraggio (senza filePath/
 *    fileDataUrl) e il testo estratto per esercizio (transcribedText,
 *    stesso campo che il percorso immagine di Cheat Study già usa), più una
 *    piccola "forma estratta" (ExtractedShape) calcolata una volta.
 * 2. La correzione manuale di un output generato E' il segnale di
 *    addestramento primario (classifyEditOutcome, skills.ts) -- un tocco
 *    leggero e non bloccante di 👍/👎 accanto è il secondo segnale, non
 *    l'unico. Entrambi confluiscono nella STESSA classificazione a tre vie
 *    (POSITIVE/NEGATIVE/NO_FEEDBACK -- vedi TrainableOutputCard sotto).
 * 3. Ogni correzione sostanziale distilla (distillFromEdit) una skill
 *    PERSONALE riusabile, taggata 'source:training' per distinguerla dalle
 *    skill che Cheat Study stesso distilla dagli scambi (stesso dominio
 *    'cheat_study', generationMethod identico -- il tag è l'unico modo di
 *    separarle nella lista qui sotto senza introdurre un dominio nuovo).
 * 4. Le tre aree sono ALTERNATIVE, non tutte insieme (richiesta esplicita,
 *    poi ribadita ancora più chiaramente: "il materiale deve essere per
 *    sezione, deve allenare per la spiegazione/creazione degli esercizi a
 *    seconda di dove viene inviato") -- un selettore "Allena per..."
 *    sceglie UNA delle tre, e solo quella genera/mostra la sua card.
 * 5. Ogni skill distillata qui porta un tag `area:solution|exercise|prereq`
 *    (areaTag(), sotto) OLTRE a source:training -- sia sulla skill stessa
 *    (capabilityTags, mostrato nel pannello "Le tue skill personali") sia
 *    nei tag di retrieval che prepareSkillCall() passa a routeSkills() per
 *    QUELLA stessa area. Una skill imparata correggendo una Spiegazione è
 *    così preferita quando si rigenera un'altra Spiegazione, non iniettata
 *    anche nell'Esercizio equivalente solo perché condividono lo stesso
 *    dominio 'cheat_study' -- overlap di tag più stretto, non un filtro
 *    rigido (2026-08-26, domanda esplicita dell'utente: "le skill avranno
 *    un modo per dire 'devi usarmi per le spiegazioni'?").
 */

const SOURCE_TRAINING_TAG = 'source:training'

/** Stesso tag sia sulla skill distillata (capabilityTags) sia nella lista di
 * tag passata a routeSkills() in fase di generazione -- l'overlap
 * deterministico di routeSkills() fa il resto: una skill 'area:solution' ha
 * più probabilità di essere recuperata quando si genera di nuovo una
 * Spiegazione, ma resta comunque recuperabile altrove se altri tag
 * combaciano (non un filtro rigido, solo un segnale di preferenza in più). */
function areaTag(area: 'solution' | 'exercise' | 'prereq'): string {
  return `area:${area}`
}

interface ExercisePick {
  chapterId: string
  sectionId?: string
  title: string
}

function pickExercises(chapters: MaterialChapter[]): ExercisePick[] {
  return chapters
    .slice()
    .sort((a, b) => a.order - b.order)
    .flatMap((c) =>
      c.subsections.length > 0
        ? c.subsections.map((s) => ({ chapterId: c.id, sectionId: s.id, title: s.title }))
        : [{ chapterId: c.id, title: c.title }],
    )
}

/** Euristica deterministica, non una chiamata Gemini in più (spec: la
 * "forma estratta" è economia di storage e provenienza minima, non un
 * secondo giudizio AI) -- pattern grezzi sul testo reale già estratto,
 * calcolati una sola volta al caricamento. */
function computeExtractedShape(format: 'pdf' | 'image', texts: string[]) {
  const joined = texts.join('\n')
  const hasMultipleChoice = /(^|\n)\s*[A-D][.)]\s/m.test(joined) || /scelta multipla/i.test(joined)
  const diagramKeywords: Record<string, RegExp> = {
    grafico: /grafic[oi]/i,
    albero: /\balber[oi]\b/i,
    schema: /schema|diagramma/i,
    tabella: /tabell[ae]/i,
  }
  const diagramTypes = Object.entries(diagramKeywords)
    .filter(([, re]) => re.test(joined))
    .map(([k]) => k)
  const detectedPattern = tagsFromText(joined)[0]
  return { format, hasMultipleChoice, diagramTypes, detectedPattern }
}

/** Una card per output (spiegazione/esercizio equivalente/esercizi di
 * base): genera, mostra, e cattura ENTRAMBI i segnali di addestramento
 * (correzione + 👍/👎 leggero) nella stessa pipeline. `content`/`callEvent`
 * vengono dal record REALE (props), quindi funziona identicamente su un
 * output appena generato in questa sessione o riaperto da una sessione
 * precedente -- niente stato locale "appena generato" da cui dipendere. */
function TrainableOutputCard({
  icon: Icon,
  title,
  area,
  content,
  callEvent,
  generating,
  onGenerate,
  exerciseTitle,
  note,
  onPersist,
}: {
  icon: LucideIcon
  title: string
  /** Quale delle tre aree questa card rappresenta -- taggato sulla skill
   * distillata (vedi settle() sotto) E riusato in prepareSkillCall() come
   * tag di retrieval, così una skill imparata correggendo la Spiegazione
   * viene preferita per generare ALTRE spiegazioni, non iniettata anche
   * nell'Esercizio equivalente o negli Esercizi di base solo perché
   * condividono lo stesso dominio 'cheat_study' (2026-08-26, domanda
   * esplicita dell'utente: "le skill avranno un modo per dire 'devi usarmi
   * per le spiegazioni'?"). */
  area: 'solution' | 'exercise' | 'prereq'
  content: string | undefined
  callEvent: SkillEvent | undefined
  generating: boolean
  onGenerate: () => void
  exerciseTitle: string
  note: string
  onPersist: (edited: string) => void
}) {
  const recordSkillOutcome = useAppStore((s) => s.recordSkillOutcome)
  const addSkill = useAppStore((s) => s.addSkill)
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [engaged, setEngaged] = useState(false)
  const [feedback, setFeedback] = useState<EditOutcome | null>(null)
  const [distilling, setDistilling] = useState(false)

  // Un nuovo output (nuovo esercizio scelto, o rigenerato) riparte con un
  // segnale pulito -- il feedback dato sull'output PRECEDENTE non deve
  // restare visibile/attaccato a quello nuovo.
  useEffect(() => {
    setEditing(false)
    setEngaged(false)
    setFeedback(null)
  }, [callEvent?.id])

  function startEdit() {
    setDraft(content ?? '')
    setEngaged(true)
    setEditing(true)
  }

  async function settle(explicitFeedback?: 'positive' | 'negative') {
    // content===undefined: niente da salvare/valutare. callEvent MANCANTE
    // (2026-08-26, bug reale trovato dal vivo su un output pre-esistente,
    // generato prima che callEventId esistesse -- vedi CheatStudySolution.
    // callEventId's commento) non deve più bloccare tutto in silenzio: si
    // può comunque salvare la correzione e distillare una skill, solo il
    // log dell'OUTCOME (che richiede un vero SkillEvent CALL a cui agganciarsi)
    // viene saltato.
    if (content === undefined) return
    const edited = engaged ? draft : content
    const outcome = classifyEditOutcome({ engaged: engaged || Boolean(explicitFeedback), original: content, edited, explicitFeedback })
    if (outcome === 'NO_FEEDBACK') return
    if (callEvent) recordSkillOutcome(callEvent, outcome === 'POSITIVE' ? 'positive' : 'negative', 'training')
    setFeedback(outcome)
    setEditing(false)
    if (edited.trim() !== content.trim()) {
      onPersist(edited)
      setDistilling(true)
      try {
        const skill = await distillFromEdit({ exerciseTitle, original: content, edited, userNote: note })
        if (skill) addSkill({ ...skill, capabilityTags: [...skill.capabilityTags, SOURCE_TRAINING_TAG, areaTag(area)] })
      } catch {
        // silenzioso -- una distillazione mancata non deve bloccare il
        // salvataggio della correzione, già avvenuto sopra
      } finally {
        setDistilling(false)
      }
    }
  }

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 items-center gap-2 text-left">
          {open ? <ChevronDown size={15} className="shrink-0 text-[var(--color-ink-muted)]" /> : <ChevronRight size={15} className="shrink-0 text-[var(--color-ink-muted)]" />}
          <Icon size={15} className="shrink-0 text-[var(--color-primary)]" />
          <CardTitle>{title}</CardTitle>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant={content ? 'ghost' : 'soft'} onClick={onGenerate} disabled={generating} title={content ? 'Rigenera' : 'Genera'}>
            {generating ? <Loader2 size={14} className="animate-spin" /> : content ? <RefreshCw size={14} /> : <Sparkles size={14} />}
            {!content && 'Genera'}
          </Button>
        </div>
      </div>
      {open && content !== undefined && (
        <>
          {editing ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm leading-relaxed text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
                autoFocus
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => settle()} disabled={distilling}>
                  {distilling ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Salva
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                  Annulla
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-xl bg-[var(--color-surface-2)] p-3">
                <CheatStudySteps text={content} />
              </div>
              <div className="mt-2 flex items-center gap-3">
                <button onClick={startEdit} className="flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-primary)]">
                  <Pencil size={12} /> Correggi
                </button>
                {/* Senza un vero SkillEvent CALL a cui agganciarsi (output
                    generato prima che callEventId esistesse) il 👍/👎 non ha
                    nulla su cui loggare un OUTCOME -- mostrarlo comunque
                    prometterebbe un segnale che non verrebbe registrato.
                    "Correggi" resta disponibile: la correzione si salva sul
                    record vero e distilla comunque, indipendentemente. */}
                {callEvent && !feedback && (
                  <span className="flex items-center gap-1 text-xs text-[var(--color-ink-muted)]">
                    Utile così?
                    <button onClick={() => settle('positive')} aria-label="Utile" className="rounded-lg p-1 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-good)]">
                      <ThumbsUp size={13} />
                    </button>
                    <button onClick={() => settle('negative')} aria-label="Non utile" className="rounded-lg p-1 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-warn)]">
                      <ThumbsDown size={13} />
                    </button>
                  </span>
                )}
                {feedback && <span className="text-xs text-[var(--color-ink-muted)]">Grazie, registrato{distilling ? ' — sto distillando cosa correggere in futuro...' : '.'}</span>}
              </div>
            </>
          )}
        </>
      )}
      {open && content === undefined && <p className="text-xs text-[var(--color-ink-muted)]">Non ancora generato per questo esercizio.</p>}
    </Card>
  )
}

const AREA_LABELS: Record<string, string> = { solution: 'Spiegazione', exercise: 'Esercizio equivalente', prereq: 'Esercizi di base' }

function areaLabelFromTags(tags: string[]): string | null {
  const tag = tags.find((t) => t.startsWith('area:'))
  if (!tag) return null
  return AREA_LABELS[tag.slice('area:'.length)] ?? null
}

function PersonalSkillsPanel() {
  const skills = useAppStore((s) => s.skills)
  const setSkillActive = useAppStore((s) => s.setSkillActive)
  const removeSkill = useAppStore((s) => s.removeSkill)
  const trained = skills.filter((sk) => sk.generationMethod === 'distilled' && sk.capabilityTags.includes(SOURCE_TRAINING_TAG))

  return (
    <Card>
      <CardTitle className="mb-1 flex items-center gap-2">
        <Sparkles size={15} className="text-[var(--color-primary)]" /> Le tue skill personali da questa sezione
      </CardTitle>
      <CardSubtitle className="mb-3">
        {trained.length === 0
          ? 'Ancora nessuna -- correggi in modo sostanziale un output qui sopra (o dai un 👎) e Aria distillerà qui un principio riusabile da quella correzione.'
          : 'Distillate dalle tue correzioni. Disattivarle le tiene salvate ma le esclude dal recupero; eliminarle è definitivo.'}
      </CardSubtitle>
      <div className="flex flex-col gap-2">
        {trained.map((sk) => (
          <div key={sk.id} className="flex items-start justify-between gap-3 rounded-xl bg-[var(--color-surface-2)] p-3">
            <div className="min-w-0">
              <p className={cn('text-sm', sk.active === false && 'text-[var(--color-ink-muted)] line-through')}>{sk.content}</p>
              <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
                {areaLabelFromTags(sk.capabilityTags) && (
                  <span className="mr-1 rounded-full bg-[var(--color-primary)]/15 px-1.5 py-0.5 font-medium text-[var(--color-primary)]">usata per: {areaLabelFromTags(sk.capabilityTags)}</span>
                )}
                {sk.status} · {sk.uses} usi · {sk.sharingEligible ? 'candidata a condivisione tra utenti' : 'solo personale'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => setSkillActive(sk.id, sk.active === false)}
                title={sk.active === false ? 'Riattiva' : 'Disattiva'}
                className={cn('rounded-lg p-1.5 hover:bg-[var(--color-border)]', sk.active === false ? 'text-[var(--color-ink-muted)]' : 'text-[var(--color-good)]')}
              >
                <Power size={14} />
              </button>
              <button onClick={() => removeSkill(sk.id)} title="Elimina definitivamente" className="rounded-lg p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-warn)]">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export default function SkillTraining() {
  const subjects = useAppStore((s) => s.subjects)
  const materials = useAppStore((s) => s.materials)
  const chapters = useAppStore((s) => s.chapters)
  const addMaterial = useAppStore((s) => s.addMaterial)
  const setMaterialChapters = useAppStore((s) => s.setMaterialChapters)
  const setCheatStudyExtractedShape = useAppStore((s) => s.setCheatStudyExtractedShape)
  const solutions = useAppStore((s) => s.cheatStudySolutions)
  const setCheatStudySolution = useAppStore((s) => s.setCheatStudySolution)
  const exercises = useAppStore((s) => s.cheatStudyExercises)
  const setCheatStudyExercise = useAppStore((s) => s.setCheatStudyExercise)
  const prereqs = useAppStore((s) => s.cheatStudyPrereqs)
  const setCheatStudyPrereq = useAppStore((s) => s.setCheatStudyPrereq)
  const skills = useAppStore((s) => s.skills)
  const skillEvents = useAppStore((s) => s.skillEvents)
  const librarianEnabled = useAppStore((s) => s.librarianEnabled)
  const logSkillCall = useAppStore((s) => s.logSkillCall)
  const push = useToastStore((s) => s.push)

  const [subjectId, setSubjectId] = useState('')
  const [examMaterialId, setExamMaterialId] = useState('')
  const [exerciseChapterId, setExerciseChapterId] = useState('')
  const [exerciseSectionId, setExerciseSectionId] = useState('')
  const [exerciseText, setExerciseText] = useState('')
  const [note, setNote] = useState('')
  // Un materiale/esercizio si allena per UNA sola area alla volta (2026-08-26,
  // correzione esplicita dell'utente: "il materiale deve essere per sezione,
  // deve allenare per la spiegazione/creazione degli esercizi a seconda di
  // dove viene inviato" -- non tre card generiche sempre tutte visibili
  // insieme). null finché l'utente non sceglie esplicitamente dove "inviare"
  // l'allenamento per questo esercizio.
  const [trainingArea, setTrainingArea] = useState<'solution' | 'exercise' | 'prereq' | null>(null)
  const [uploading, setUploading] = useState(false)
  const [generatingSolution, setGeneratingSolution] = useState(false)
  const [generatingExercise, setGeneratingExercise] = useState(false)
  const [generatingPrereq, setGeneratingPrereq] = useState(false)

  const examMaterials = materials.filter((m) => m.subjectId === subjectId && m.isExamPaper)
  const examMaterial = materials.find((m) => m.id === examMaterialId)
  const examChapters = chapters.filter((c) => c.materialId === examMaterialId)
  const exerciseChapter = examChapters.find((c) => c.id === exerciseChapterId)
  const exerciseSection: ChapterSection | undefined = exerciseChapter?.subsections.find((s) => s.id === exerciseSectionId)
  const exerciseTitle = exerciseSection?.title ?? exerciseChapter?.title ?? ''
  const picks = pickExercises(examChapters)

  const activeSolution = solutions.find((s) => s.examMaterialId === examMaterialId && s.chapterId === exerciseChapterId && s.sectionId === (exerciseSectionId || undefined))
  const activeExercise = exercises.find((s) => s.examMaterialId === examMaterialId && s.chapterId === exerciseChapterId && s.sectionId === (exerciseSectionId || undefined))
  const activePrereq = prereqs.find((s) => s.examMaterialId === examMaterialId && s.chapterId === exerciseChapterId && s.sectionId === (exerciseSectionId || undefined))

  function callEventFor(id: string | undefined): SkillEvent | undefined {
    return id ? skillEvents.find((e) => e.id === id && e.eventType === 'CALL') : undefined
  }

  // Stesso pattern di CheatStudy.tsx (testo reale dell'esercizio, non solo
  // il titolo) -- transcribedText copre sia le tracce caricate qui (mai
  // salvate su Storage, solo testo estratto) sia quelle immagine di Cheat
  // Study; getChapterScopedText copre le tracce PDF reali di Cheat Study
  // (pagine nel file davvero salvato in Storage).
  useEffect(() => {
    setExerciseText('')
    if (!examMaterial || !exerciseChapter) return
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

  function pickSubject(id: string) {
    setSubjectId(id)
    setExamMaterialId('')
    setExerciseChapterId('')
    setExerciseSectionId('')
  }
  function pickExamMaterial(id: string) {
    setExamMaterialId(id)
    setExerciseChapterId('')
    setExerciseSectionId('')
  }
  function pickExercise(p: ExercisePick) {
    setExerciseChapterId(p.chapterId)
    setExerciseSectionId(p.sectionId ?? '')
    setTrainingArea(null)
  }

  /** Caricamento SENZA Storage (spec 2026-08-26, punto 9): la materials row
   * creata qui non ha MAI filePath/fileDataUrl -- niente bytes del file
   * originale persistiti da nessuna parte, solo il testo estratto per
   * esercizio (transcribedText, stesso campo del percorso immagine di Cheat
   * Study) e una piccola "forma estratta" calcolata una volta. Il buffer
   * grezzo (`buf`) vive solo nella chiusura di questa funzione -- scartato
   * appena finisce, mai scritto su Storage/IndexedDB/localStorage. */
  async function handleUploadNoStorage(file: File) {
    if (!subjectId || !hasGeminiKey()) {
      if (!hasGeminiKey()) push({ title: 'Serve una chiave Gemini', description: 'Aggiungila in Impostazioni.', tone: 'warn' })
      return
    }
    setUploading(true)
    try {
      const title = file.name.replace(/\.[^./]+$/, '')
      const material = addMaterial({ subjectId, type: 'file', title, fileName: file.name, isExamPaper: true })
      const isImage = /\.(png|jpe?g|webp|heic)$/i.test(file.name)
      const buf = await file.arrayBuffer()

      if (isImage) {
        const mimeType = /\.png$/i.test(file.name) ? 'image/png' : /\.webp$/i.test(file.name) ? 'image/webp' : 'image/jpeg'
        const found = await generateExercisesFromImage(bufferToBase64(buf), mimeType)
        if (found.length === 0) {
          push({ title: 'Non sono riuscita a leggere esercizi da questa immagine', tone: 'warn' })
          return
        }
        setMaterialChapters(
          material.id,
          found.map((e) => ({ title: e.title, startPage: 1, endPage: 1, transcribedText: e.text })),
        )
        setCheatStudyExtractedShape(material.id, computeExtractedShape('image', found.map((e) => e.text)))
        setExamMaterialId(material.id)
        push({ title: `${found.length} esercizi individuati`, tone: 'good' })
        return
      }

      // PDF: testo per capitolo salvato direttamente in transcribedText
      // (mai un page-range che punterebbe a un file che non esiste in
      // Storage) -- le sottosezioni non hanno un testo scoped proprio qui
      // (nessuna pagina reale da ri-affettare per ognuna), ereditano quello
      // dell'intero capitolo via lo stesso fallback che CheatStudy.tsx già
      // usa altrove (sectionText ?? chapterText) -- più grezzo di un vero
      // scoping per sezione, dichiarato così invece di finto preciso.
      const { pages } = await extractPdfTextByPage(buf, CHAPTER_DETECTION_OPTS)
      const suggested = await generateChapters(title, pages)
      if (suggested.length === 0) {
        push({ title: 'Non sono riuscita a dividere la traccia in esercizi', tone: 'warn' })
        return
      }
      const withText = suggested.map((c) => ({
        title: c.title,
        startPage: c.startPage,
        endPage: c.endPage,
        transcribedText: pages
          .filter((p) => p.page >= c.startPage && p.page <= c.endPage)
          .map((p) => p.text)
          .join('\n'),
        subsections: (c.subsections ?? []).map((s) => ({ ...s, id: uid() })),
      }))
      setMaterialChapters(material.id, withText)
      setCheatStudyExtractedShape(
        material.id,
        computeExtractedShape('pdf', withText.map((c) => c.transcribedText ?? '')),
      )
      setExamMaterialId(material.id)
      push({ title: `${suggested.length} esercizi individuati`, tone: 'good' })
    } catch {
      push({ title: 'Analisi non riuscita', description: 'Riprova tra poco.', tone: 'warn' })
    } finally {
      setUploading(false)
    }
  }

  /** Instrumentazione skill identica a CheatStudy.tsx's prepareSkillCall,
   * ma con source:'training' sempre esplicito -- questa pagina INTERA è la
   * superficie di addestramento, non serve un toggle organic/training per
   * chiamata come altrove. */
  function prepareSkillCall(area: 'solution' | 'exercise' | 'prereq'): { skillContext: string; callEvent: SkillEvent } {
    if (!librarianEnabled) return { skillContext: '', callEvent: logSkillCall('cheat_study', 'B', [], GEMINI_MODEL, 'training') }
    const retrieved = routeSkills(skills, 'cheat_study', [`material:${examMaterialId}`, areaTag(area), ...CHEAT_STUDY_TASK_TAGS, ...tagsFromText(exerciseTitle)], 2, 1, skillEvents)
    const budgeted = enforceSkillBudget(exerciseText, retrieved, GEMINI_MODEL)
    return {
      skillContext: skillsAsPromptContext(budgeted.skills),
      callEvent: logSkillCall('cheat_study', budgeted.skills.length > 0 ? 'F' : 'B', budgeted.skills.map((s) => s.id), GEMINI_MODEL, 'training'),
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
      const { skillContext, callEvent } = prepareSkillCall('solution')
      const content = await generateCheatStudySolution(exerciseTitle, exerciseText, null, skillContext, note.trim() || undefined)
      if (!content) {
        push({ title: 'Non sono riuscita a generare una spiegazione', tone: 'warn' })
        return
      }
      setCheatStudySolution(examMaterial.id, exerciseChapter.id, exerciseSection?.id, content, callEvent.id)
      push({ title: 'Spiegazione pronta', tone: 'good' })
    } catch {
      push({ title: 'Generazione non riuscita', description: 'Riprova tra poco.', tone: 'warn' })
    } finally {
      setGeneratingSolution(false)
    }
  }

  async function generateExerciseOutput() {
    if (!examMaterial || !exerciseChapter) return
    if (!hasGeminiKey()) {
      push({ title: 'Serve una chiave Gemini', description: 'Aggiungila in Impostazioni.', tone: 'warn' })
      return
    }
    setGeneratingExercise(true)
    try {
      const { skillContext, callEvent } = prepareSkillCall('exercise')
      const content = await generateEquivalentExercise(exerciseTitle, exerciseText, null, skillContext, note.trim() || undefined)
      if (!content) {
        push({ title: 'Non sono riuscita a generare un esercizio equivalente', tone: 'warn' })
        return
      }
      setCheatStudyExercise(examMaterial.id, exerciseChapter.id, exerciseSection?.id, content, callEvent.id)
      push({ title: 'Esercizio equivalente pronto', tone: 'good' })
    } catch {
      push({ title: 'Generazione non riuscita', description: 'Riprova tra poco.', tone: 'warn' })
    } finally {
      setGeneratingExercise(false)
    }
  }

  async function generatePrereqOutput() {
    if (!examMaterial || !exerciseChapter) return
    if (!hasGeminiKey()) {
      push({ title: 'Serve una chiave Gemini', description: 'Aggiungila in Impostazioni.', tone: 'warn' })
      return
    }
    setGeneratingPrereq(true)
    try {
      const { skillContext, callEvent } = prepareSkillCall('prereq')
      const content = await generatePrerequisiteExercises(exerciseTitle, exerciseText, null, skillContext, note.trim() || undefined)
      if (!content) {
        push({ title: 'Non sono riuscita a generare gli esercizi di base', tone: 'warn' })
        return
      }
      setCheatStudyPrereq(examMaterial.id, exerciseChapter.id, exerciseSection?.id, content, callEvent.id)
      push({ title: 'Esercizi di base pronti', tone: 'good' })
    } catch {
      push({ title: 'Generazione non riuscita', description: 'Riprova tra poco.', tone: 'warn' })
    } finally {
      setGeneratingPrereq(false)
    }
  }

  // Un solo punto d'invio (2026-08-26, richiesta esplicita: "l'utente deve
  // poter semplicemente dare ad aria il prompt nel contesto e inviare") --
  // la nota è un prompt libero, "Invia e genera" (o Ctrl/Cmd+Invio dalla
  // textarea stessa) lancia la generazione per l'area scelta sopra, senza
  // dover scendere fino al pulsante della card. Esercizio/materiale/skill
  // già imparate entrano comunque in automatico (stessa exerciseText/
  // prepareSkillCall di sempre) -- la nota si aggiunge, non li sostituisce.
  const activeGenerate = trainingArea === 'solution' ? generateSolution : trainingArea === 'exercise' ? generateExerciseOutput : trainingArea === 'prereq' ? generatePrereqOutput : undefined
  const activeGenerating = trainingArea === 'solution' ? generatingSolution : trainingArea === 'exercise' ? generatingExercise : trainingArea === 'prereq' ? generatingPrereq : false

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Dumbbell size={22} className="text-[var(--color-primary)]" />
          Allenamento skill
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Genera un output di Cheat Study, correggilo se serve, e Aria impara cosa cambiare la prossima volta. Le correzioni aggiornano il record vero — le
          rivedrai identiche in Cheat Study.
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
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-[var(--color-ink-muted)]">
            <ArrowLeft size={16} />
            Scegli una materia qui sopra per iniziare.
          </div>
          <PersonalSkillsPanel />
        </div>
      )}

      {subjectId && (
        <div className="flex flex-col gap-4">
          <Card>
            <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">Traccia</p>
            <label
              className={cn(
                'mb-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-xs font-medium transition-colors',
                'border-[var(--color-border)] text-[var(--color-ink-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]',
              )}
            >
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
              {uploading ? 'Analizzo...' : 'Carica un nuovo esempio (PDF o foto) — non viene salvato il file, solo il testo estratto'}
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) handleUploadNoStorage(file)
                }}
              />
            </label>
            {examMaterials.length > 0 && (
              <>
                <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">...oppure allenati su una traccia già in Cheat Study</p>
                <div className="flex flex-wrap gap-2">
                  {examMaterials.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => pickExamMaterial(m.id)}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-xs font-medium',
                        examMaterialId === m.id ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
                      )}
                    >
                      {m.title}
                    </button>
                  ))}
                </div>
              </>
            )}
          </Card>

          {examMaterial && picks.length > 0 && (
            <Card>
              <div className="mb-2 flex items-center gap-2">
                <BookOpen size={15} className="text-[var(--color-primary)]" />
                <CardTitle>Esercizio</CardTitle>
              </div>
              <div className="flex flex-wrap gap-2">
                {picks.map((p) => {
                  const active = p.chapterId === exerciseChapterId && (p.sectionId ?? '') === exerciseSectionId
                  return (
                    <button
                      key={`${p.chapterId}:${p.sectionId ?? ''}`}
                      onClick={() => pickExercise(p)}
                      className={cn('rounded-full px-3 py-1.5 text-left text-xs font-medium', active ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]')}
                    >
                      {p.title}
                    </button>
                  )
                })}
              </div>
            </Card>
          )}

          {exerciseChapter && (
            <>
              <Card>
                <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">Allena per...</p>
                <CardSubtitle className="mb-2">Scegli UNA area per questo esercizio -- non serve generare tutte e tre insieme, un materiale può essere dedicato a una sola.</CardSubtitle>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { key: 'solution', label: 'Spiegazione', icon: Sparkles, has: Boolean(activeSolution) },
                      { key: 'exercise', label: 'Esercizio equivalente', icon: RefreshCw, has: Boolean(activeExercise) },
                      { key: 'prereq', label: 'Esercizi di base', icon: BookOpen, has: Boolean(activePrereq) },
                    ] as const
                  ).map((area) => (
                    <button
                      key={area.key}
                      onClick={() => setTrainingArea(area.key)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
                        trainingArea === area.key ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
                      )}
                    >
                      <area.icon size={13} />
                      {area.label}
                      {area.has && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-good)]" />}
                    </button>
                  ))}
                </div>
              </Card>

              {trainingArea && (
                <Card>
                  <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">Nota per questa generazione (opzionale)</p>
                  <CardSubtitle className="mb-2">
                    Passata ad Aria come contesto in più — l'esercizio scelto sopra, il materiale collegato e le skill già imparate entrano comunque in automatico, non serve ripeterli qui. Se la
                    nota è troppo legata a questo esempio per generalizzarla, non entra nella skill distillata.
                  </CardSubtitle>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && activeGenerate && !activeGenerating) activeGenerate()
                    }}
                    rows={2}
                    placeholder='Es. "vorrei il passaggio grafico prima della formula" — Ctrl/Cmd+Invio per generare subito'
                    className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm leading-relaxed text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
                  />
                  {activeGenerate && (
                    <div className="mt-2 flex justify-end">
                      <Button size="sm" onClick={activeGenerate} disabled={activeGenerating}>
                        {activeGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Invia e genera
                      </Button>
                    </div>
                  )}
                </Card>
              )}

              {trainingArea === 'solution' && (
                <TrainableOutputCard
                  icon={Sparkles}
                  title="Spiegazione"
                  area="solution"
                  content={activeSolution?.content}
                  callEvent={callEventFor(activeSolution?.callEventId)}
                  generating={generatingSolution}
                  onGenerate={generateSolution}
                  exerciseTitle={exerciseTitle}
                  note={note}
                  onPersist={(edited) => examMaterial && setCheatStudySolution(examMaterial.id, exerciseChapter.id, exerciseSection?.id, edited, activeSolution?.callEventId)}
                />
              )}
              {trainingArea === 'exercise' && (
                <TrainableOutputCard
                  icon={RefreshCw}
                  title="Esercizio equivalente"
                  area="exercise"
                  content={activeExercise?.content}
                  callEvent={callEventFor(activeExercise?.callEventId)}
                  generating={generatingExercise}
                  onGenerate={generateExerciseOutput}
                  exerciseTitle={exerciseTitle}
                  note={note}
                  onPersist={(edited) => examMaterial && setCheatStudyExercise(examMaterial.id, exerciseChapter.id, exerciseSection?.id, edited, activeExercise?.callEventId)}
                />
              )}
              {trainingArea === 'prereq' && (
                <TrainableOutputCard
                  icon={BookOpen}
                  title="Esercizi di base"
                  area="prereq"
                  content={activePrereq?.content}
                  callEvent={callEventFor(activePrereq?.callEventId)}
                  generating={generatingPrereq}
                  onGenerate={generatePrereqOutput}
                  exerciseTitle={exerciseTitle}
                  note={note}
                  onPersist={(edited) => examMaterial && setCheatStudyPrereq(examMaterial.id, exerciseChapter.id, exerciseSection?.id, edited, activePrereq?.callEventId)}
                />
              )}
            </>
          )}

          <PersonalSkillsPanel />
        </div>
      )}
    </div>
  )
}
