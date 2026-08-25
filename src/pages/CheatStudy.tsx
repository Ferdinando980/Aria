import { useMemo, useState } from 'react'
import { GraduationCap, Sparkles, Loader2, ArrowLeft, BookOpen, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { Card, CardTitle, CardSubtitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useAppStore } from '../store/useAppStore'
import { useToastStore } from '../store/toastStore'
import { generateCheatStudySolution, hasGeminiKey, GEMINI_MODEL } from '../lib/gemini'
import { isViewableInline, getChapterScopedText } from '../lib/materialContent'
import { cn, contrastTextColor } from '../lib/utils'
import type { SkillEvent, ChapterSection, MaterialChapter } from '../lib/types'
import { routeSkills, skillsAsPromptContext, tagsFromText, maybeDistillFromExchanges } from '../lib/skills'
import { enforceSkillBudget } from '../lib/contextBudget'
import { MessageFeedback } from '../components/shared/MessageFeedback'
import { MarkdownLite } from '../components/shared/MarkdownLite'

/**
 * Cheat Study (2026-08-25, real user request) -- "esattamente come studiano
 * gli studenti": parti da una traccia d'esame (un materiale già diviso in
 * capitoli, riusati come esercizi -- niente concetto "esame" separato),
 * scegli l'esercizio, l'app trova da sola le parti del TUO materiale di
 * studio reale (stessa materia, overlap di tag sui titoli di capitolo/
 * sezione -- niente embeddings, stessa scelta di routeSkills) che parlano di
 * quell'argomento e te le mostra per esercitarti -- non le genera, le
 * mostra. Solo dopo, su richiesta, una spiegazione della soluzione generata
 * ma ancorata a QUEL materiale reale (mai al solo testo dell'esercizio),
 * stessa disciplina di fs_cite_before_claim.
 */

interface MatchedSection {
  materialId: string
  materialTitle: string
  chapter: MaterialChapter
  section?: ChapterSection
  overlap: number
}

const MAX_MATCHES = 4

export default function CheatStudy() {
  const subjects = useAppStore((s) => s.subjects)
  const materials = useAppStore((s) => s.materials)
  const chapters = useAppStore((s) => s.chapters)
  const solutions = useAppStore((s) => s.cheatStudySolutions)
  const setCheatStudySolution = useAppStore((s) => s.setCheatStudySolution)
  const skills = useAppStore((s) => s.skills)
  const librarianEnabled = useAppStore((s) => s.librarianEnabled)
  const logSkillCall = useAppStore((s) => s.logSkillCall)
  const addSkill = useAppStore((s) => s.addSkill)
  const push = useToastStore((s) => s.push)

  const [subjectId, setSubjectId] = useState('')
  const [examMaterialId, setExamMaterialId] = useState('')
  const [exerciseChapterId, setExerciseChapterId] = useState('')
  const [exerciseSectionId, setExerciseSectionId] = useState('')
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null)
  const [matchTexts, setMatchTexts] = useState<Record<string, string>>({})
  const [loadingMatch, setLoadingMatch] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [lastCallEvent, setLastCallEvent] = useState<SkillEvent | undefined>(undefined)

  const subjectMaterials = materials.filter((m) => m.subjectId === subjectId && isViewableInline(m))
  // "Materiale d'esame" = qualunque materiale della materia già diviso in
  // capitoli -- riusa "Rileva capitoli", non un secondo concetto da creare.
  const examMaterials = subjectMaterials.filter((m) => chapters.some((c) => c.materialId === m.id))
  const examMaterial = materials.find((m) => m.id === examMaterialId)
  const examChapters = chapters.filter((c) => c.materialId === examMaterialId).sort((a, b) => a.order - b.order)
  const exerciseChapter = examChapters.find((c) => c.id === exerciseChapterId)
  const exerciseSection = exerciseChapter?.subsections.find((s) => s.id === exerciseSectionId)
  const exerciseTitle = exerciseSection?.title ?? exerciseChapter?.title ?? ''

  const activeSolution = solutions.find((s) => s.examMaterialId === examMaterialId && s.chapterId === exerciseChapterId && s.sectionId === (exerciseSectionId || undefined))

  // Cerca nel materiale di studio VERO della stessa materia (esclude il
  // materiale d'esame stesso) i capitoli/sezioni con overlap di tag sul
  // titolo dell'esercizio -- stessa logica deterministica di routeSkills(),
  // niente chiamata al modello per la ricerca stessa.
  const matches = useMemo<MatchedSection[]>(() => {
    if (!exerciseChapter) return []
    const exerciseTags = new Set(tagsFromText(exerciseTitle))
    if (exerciseTags.size === 0) return []
    const candidates: MatchedSection[] = []
    for (const m of subjectMaterials) {
      if (m.id === examMaterialId) continue
      for (const c of chapters.filter((x) => x.materialId === m.id)) {
        const chapterOverlap = tagsFromText(c.title).filter((t) => exerciseTags.has(t)).length
        if (chapterOverlap > 0 && c.subsections.length === 0) {
          candidates.push({ materialId: m.id, materialTitle: m.title, chapter: c, overlap: chapterOverlap })
        }
        for (const sec of c.subsections) {
          const secOverlap = tagsFromText(sec.title).filter((t) => exerciseTags.has(t)).length
          if (secOverlap > 0) candidates.push({ materialId: m.id, materialTitle: m.title, chapter: c, section: sec, overlap: secOverlap })
        }
      }
    }
    return candidates.sort((a, b) => b.overlap - a.overlap).slice(0, MAX_MATCHES)
  }, [exerciseChapter, exerciseTitle, subjectMaterials, examMaterialId, chapters])

  function pickSubject(id: string) {
    setSubjectId(id)
    setExamMaterialId('')
    setExerciseChapterId('')
    setExerciseSectionId('')
    setExpandedMatch(null)
    setLastCallEvent(undefined)
  }
  function pickExamMaterial(id: string) {
    setExamMaterialId(id)
    setExerciseChapterId('')
    setExerciseSectionId('')
    setExpandedMatch(null)
    setLastCallEvent(undefined)
  }
  function pickExercise(chapterId: string, sectionId: string) {
    setExerciseChapterId(chapterId)
    setExerciseSectionId(sectionId)
    setExpandedMatch(null)
    setLastCallEvent(undefined)
  }

  async function toggleMatch(match: MatchedSection) {
    const key = `${match.chapter.id}:${match.section?.id ?? ''}`
    if (expandedMatch === key) {
      setExpandedMatch(null)
      return
    }
    setExpandedMatch(key)
    if (matchTexts[key]) return
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

  function prepareSkillCall(tagSourceText: string, baseText: string): { skillContext: string; callEvent: SkillEvent } {
    if (!librarianEnabled) return { skillContext: '', callEvent: logSkillCall('cheat_study', 'B', [], GEMINI_MODEL) }
    const retrieved = routeSkills(skills, 'cheat_study', [`material:${examMaterialId}`, ...tagsFromText(tagSourceText)], 2, 1, useAppStore.getState().skillEvents)
    const budgeted = enforceSkillBudget(baseText, retrieved, GEMINI_MODEL)
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
    if (matches.length === 0) {
      push({ title: 'Nessun materiale di studio collegato trovato', description: 'Senza materiale reale non genero una spiegazione inventata.', tone: 'warn' })
      return
    }
    setGenerating(true)
    try {
      const { text: exerciseText } = await getChapterScopedText(examMaterial, exerciseChapter, exerciseSection)
      const matchTextsList = await Promise.all(
        matches.map(async (m) => {
          const key = `${m.chapter.id}:${m.section?.id ?? ''}`
          if (matchTexts[key]) return matchTexts[key]
          const material = materials.find((x) => x.id === m.materialId)
          if (!material) return ''
          const { text } = await getChapterScopedText(material, m.chapter, m.section)
          setMatchTexts((cur) => ({ ...cur, [key]: text }))
          return `[${m.materialTitle} — ${m.section?.title ?? m.chapter.title}]\n${text}`
        }),
      )
      const studyContext = matchTextsList.filter(Boolean).join('\n\n')
      const { skillContext, callEvent } = prepareSkillCall(exerciseTitle, studyContext)
      const content = await generateCheatStudySolution(exerciseTitle, exerciseText, studyContext, skillContext)
      if (!content) {
        push({ title: 'Non sono riuscita a generare una spiegazione', tone: 'warn' })
        return
      }
      setCheatStudySolution(examMaterial.id, exerciseChapter.id, exerciseSection?.id, content)
      setLastCallEvent(callEvent)
      push({ title: 'Soluzione pronta', tone: 'good' })
    } catch {
      push({ title: 'Generazione non riuscita', description: 'Riprova tra poco.', tone: 'warn' })
    } finally {
      setGenerating(false)
    }
  }

  function tryDistill() {
    if (!lastCallEvent || !activeSolution) return
    const messages = [
      { role: 'user' as const, text: `Esercizio: ${exerciseTitle}` },
      { role: 'model' as const, text: activeSolution.content, skillEventRef: lastCallEvent.id },
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
          Scegli una traccia d'esame, trova da sola dove sta l'argomento nel tuo materiale reale, esercitati, poi chiedi la soluzione spiegata.
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
              {examMaterials.length === 0 && (
                <p className="text-xs text-[var(--color-ink-muted)]">
                  Nessun materiale con capitoli qui — carica la traccia in Materiali e usa "Rileva capitoli" prima, ogni capitolo diventa un esercizio.
                </p>
              )}
            </div>
          </Card>

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

          {exerciseChapter && (
            <Card>
              <div className="mb-1 flex items-center gap-2">
                <BookOpen size={15} className="text-[var(--color-primary)]" />
                <CardTitle>Materiale di studio collegato</CardTitle>
              </div>
              <CardSubtitle className="mb-3">Trovato nella tua materia, non generato — per esercitarti prima di vedere la soluzione.</CardSubtitle>
              {matches.length === 0 && (
                <p className="text-xs text-[var(--color-ink-muted)]">
                  Nessuna corrispondenza trovata per "{exerciseTitle}" — prova a rilevare i capitoli anche sugli altri materiali di questa materia.
                </p>
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
                <CardTitle>Soluzione</CardTitle>
              </div>
              {activeSolution ? (
                <>
                  <MarkdownLite text={activeSolution.content} className="mb-3 rounded-xl bg-[var(--color-surface-2)] p-5 text-base leading-loose" />
                  {lastCallEvent && <MessageFeedback key={lastCallEvent.id} callEvent={lastCallEvent} onGiven={tryDistill} />}
                  <Button size="sm" variant="soft" onClick={generateSolution} disabled={generating}>
                    {generating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Rigenera
                  </Button>
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <CardSubtitle>Prova prima con il materiale qui sopra — poi chiedi la spiegazione.</CardSubtitle>
                  <Button size="sm" onClick={generateSolution} disabled={generating}>
                    {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Genera spiegazione
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
