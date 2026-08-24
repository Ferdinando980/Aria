import { useMemo, useState } from 'react'
import { FileText, Sparkles, Loader2, ArrowLeft, RefreshCw, Trash2, BookOpen, Plus } from 'lucide-react'
import { Card, CardTitle, CardSubtitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useAppStore } from '../store/useAppStore'
import { useToastStore } from '../store/toastStore'
import { generateSummary, hasGeminiKey, GEMINI_MODEL } from '../lib/gemini'
import { isViewableInline, getChapterScopedText } from '../lib/materialContent'
import { cn, contrastTextColor } from '../lib/utils'
import type { SkillEvent } from '../lib/types'
import { routeSkills, routeMaterialKnowledge, skillsAsPromptContext, tagsFromText, maybeDistillFromExchanges } from '../lib/skills'
import { enforceSkillBudget } from '../lib/contextBudget'
import { MessageFeedback } from '../components/shared/MessageFeedback'
import { MarkdownLite } from '../components/shared/MarkdownLite'

// Real user request (2026-08-24): "dov'è finito il tab coi riassunti?
// avevi detto che avresti fatto due schermate diverse, mi aspettavo una
// nuova sezione riassunti, fatta bene". Summaries used to live as a small
// collapsed disclosure buried inside the Flashcard page -- now its own
// section, own nav entry, same browse-grid + focused-reading two-screen
// pattern Flashcards.tsx already established the same day (real user
// approval: "farei sia un riordino e una pulizia sia dividerei in due
// schermate"), reused here instead of inventing a third layout language.
export default function Summaries() {
  const subjects = useAppStore((s) => s.subjects)
  const materials = useAppStore((s) => s.materials)
  const chapters = useAppStore((s) => s.chapters)
  const summaries = useAppStore((s) => s.summaries)
  const setSummary = useAppStore((s) => s.setSummary)
  const removeSummary = useAppStore((s) => s.removeSummary)
  const skills = useAppStore((s) => s.skills)
  const librarianEnabled = useAppStore((s) => s.librarianEnabled)
  const logSkillCall = useAppStore((s) => s.logSkillCall)
  const addSkill = useAppStore((s) => s.addSkill)
  const push = useToastStore((s) => s.push)

  const [view, setView] = useState<'browse' | 'read'>('browse')
  const [showNewPicker, setShowNewPicker] = useState(false)
  const [subjectId, setSubjectId] = useState('')
  const [materialId, setMaterialId] = useState('')
  const [chapterId, setChapterId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const [lastSummaryCall, setLastSummaryCall] = useState<SkillEvent[] | undefined>(undefined)

  const subjectMaterials = materials.filter((m) => m.subjectId === subjectId && isViewableInline(m))
  const material = materials.find((m) => m.id === materialId)
  const materialChapters = chapters.filter((c) => c.materialId === materialId).sort((a, b) => a.order - b.order)
  const chapter = materialChapters.find((c) => c.id === chapterId)
  const section = chapter?.subsections.find((s) => s.id === sectionId)
  const activeSummary = summaries.find((s) => s.materialId === materialId && s.chapterId === chapterId && s.sectionId === (sectionId || undefined))

  // Every riassunto already generated for materials in this subject --
  // same "real deck list" principle as Flashcards.tsx's decksInSubject
  // (a scope IS the entity, nothing new to store).
  const summariesInSubject = useMemo(() => {
    const bySubjectMaterialIds = new Set(subjectMaterials.map((m) => m.id))
    return summaries
      .filter((s) => bySubjectMaterialIds.has(s.materialId))
      .map((s) => {
        const m = materials.find((x) => x.id === s.materialId)
        const c = chapters.find((x) => x.id === s.chapterId)
        const sec = c?.subsections.find((x) => x.id === s.sectionId)
        return { summary: s, materialTitle: m?.title ?? '?', chapterTitle: c?.title ?? '?', sectionTitle: sec?.title }
      })
  }, [summaries, subjectMaterials, materials, chapters])

  function resetPicker(next: Partial<{ subjectId: string; materialId: string; chapterId: string; sectionId: string }>) {
    setLastSummaryCall(undefined)
    if ('subjectId' in next) {
      setSubjectId(next.subjectId!)
      setMaterialId('')
      setChapterId('')
      setSectionId('')
      setView('browse')
      setShowNewPicker(false)
    } else if ('materialId' in next) {
      setMaterialId(next.materialId!)
      setChapterId('')
      setSectionId('')
    } else if ('chapterId' in next) {
      setChapterId(next.chapterId!)
      setSectionId('')
    } else if ('sectionId' in next) {
      setSectionId(next.sectionId!)
    }
  }

  function openSummary(deckMaterialId: string, deckChapterId: string, deckSectionId?: string) {
    setMaterialId(deckMaterialId)
    setChapterId(deckChapterId)
    setSectionId(deckSectionId ?? '')
    setLastSummaryCall(undefined)
    setView('read')
  }

  function prepareSkillCall(tagSourceText: string, baseText: string, knowledgeScope: { materialId: string; chapterId?: string; sectionId?: string }): { skillContext: string; callEvents: SkillEvent[] } {
    if (!librarianEnabled) {
      return { skillContext: '', callEvents: [logSkillCall('summary', 'B', [], GEMINI_MODEL), logSkillCall('material_knowledge', 'B', [], GEMINI_MODEL)] }
    }
    const retrieved = routeSkills(skills, 'summary', tagsFromText(tagSourceText), 2, 1, useAppStore.getState().skillEvents)
    const retrievedKnowledge = routeMaterialKnowledge(skills, knowledgeScope.materialId, { chapterId: knowledgeScope.chapterId, sectionId: knowledgeScope.sectionId })
    const budgeted = enforceSkillBudget(baseText, [...retrieved, ...retrievedKnowledge], GEMINI_MODEL)
    if (budgeted.baseOverBudget || budgeted.droppedSkillIds.length > 0) {
      console.warn('[contextBudget] skill context ridotto per budget', { domain: 'summary', ...budgeted })
    }
    const kept = budgeted.skills.filter((s) => s.domain === 'summary')
    const keptKnowledge = budgeted.skills.filter((s) => s.domain === 'material_knowledge')
    return {
      skillContext: skillsAsPromptContext(budgeted.skills),
      callEvents: [
        logSkillCall('summary', kept.length > 0 ? 'F' : 'B', kept.map((s) => s.id), GEMINI_MODEL),
        logSkillCall('material_knowledge', keptKnowledge.length > 0 ? 'F' : 'B', keptKnowledge.map((s) => s.id), GEMINI_MODEL),
      ],
    }
  }

  function tryDistillSkill(callEvents: SkillEvent[], userText: string, ariaText: string) {
    const callEvent = callEvents.find((e) => e.domain === 'summary')
    if (!callEvent) return
    const messages = [
      { role: 'user' as const, text: userText },
      { role: 'model' as const, text: ariaText, skillEventRef: callEvent.id },
    ]
    maybeDistillFromExchanges('summary', messages, useAppStore.getState().skillEvents)
      .then((candidate) => candidate && addSkill(candidate))
      .catch(() => {})
  }

  async function generate() {
    if (!material || !chapter) return
    if (!hasGeminiKey()) {
      push({ title: 'Serve una chiave Gemini', description: 'Aggiungila in Impostazioni.', tone: 'warn' })
      return
    }
    setSummarizing(true)
    try {
      const { text, scopeLabel } = await getChapterScopedText(material, chapter, section)
      if (!text.trim()) {
        push({ title: 'Non ho trovato testo da usare', tone: 'warn' })
        return
      }
      const { skillContext, callEvents } = prepareSkillCall(`${material.title} ${scopeLabel}`, text, { materialId: material.id, chapterId: chapter.id, sectionId: section?.id })
      const content = await generateSummary(material.title, scopeLabel, text, skillContext)
      if (!content) {
        push({ title: 'Non sono riuscita a creare un riassunto', tone: 'warn' })
        return
      }
      setSummary(material.id, chapter.id, section?.id, content)
      setLastSummaryCall(callEvents)
      setView('read')
      setShowNewPicker(false)
      push({ title: 'Riassunto pronto', tone: 'good' })
    } catch {
      push({ title: 'Generazione non riuscita', description: 'Riprova tra poco.', tone: 'warn' })
    } finally {
      setSummarizing(false)
    }
  }

  const readLabel = section ? section.title : chapter ? chapter.title : ''

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Riassunti</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Il succo di un capitolo, pronto quando non hai tempo di rileggerlo tutto.</p>
      </div>

      <div className="mb-4">
        <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">Materia</p>
        <div className="flex flex-wrap gap-2">
          {subjects.map((s) => (
            <button
              key={s.id}
              onClick={() => resetPicker({ subjectId: s.id })}
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

      {subjectId && view === 'browse' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {summariesInSubject.map(({ summary, materialTitle, chapterTitle, sectionTitle }) => (
              <Card
                key={summary.id}
                className="group relative cursor-pointer p-4 transition-colors hover:border-[var(--color-primary)]"
                onClick={() => openSummary(summary.materialId, summary.chapterId, summary.sectionId)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText size={15} className="shrink-0 text-[var(--color-primary)]" />
                    <p className="truncate text-sm font-semibold text-[var(--color-ink)]">{sectionTitle ?? chapterTitle}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeSummary(summary.id)
                    }}
                    title="Elimina questo riassunto"
                    className="shrink-0 rounded-lg p-1 text-[var(--color-ink-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-warn)]"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--color-ink-muted)]">
                  {materialTitle}
                  {sectionTitle ? ` · ${chapterTitle}` : ''}
                </p>
                <p className="mt-2 line-clamp-2 text-xs text-[var(--color-ink-muted)]">{summary.content.replace(/[#*_>-]/g, '').trim()}</p>
              </Card>
            ))}
            <button
              onClick={() => setShowNewPicker((v) => !v)}
              className={cn(
                'flex min-h-[88px] flex-col items-center justify-center gap-1.5 rounded-[var(--radius-2xl)] border border-dashed p-4 text-xs font-medium transition-colors',
                showNewPicker
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-ink-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]',
              )}
            >
              <Plus size={16} />
              Nuovo riassunto
            </button>
          </div>

          {summariesInSubject.length === 0 && !showNewPicker && (
            <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-[var(--color-ink-muted)]">
              Ancora nessun riassunto qui — usa "Nuovo riassunto" per crearne uno da un capitolo.
            </div>
          )}

          {showNewPicker && (
            <Card className="flex flex-col gap-3">
              <div>
                <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">Materiale</p>
                <div className="flex flex-wrap gap-2">
                  {subjectMaterials.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => resetPicker({ materialId: m.id })}
                      className={cn('rounded-full px-3 py-1.5 text-xs font-medium', materialId === m.id ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]')}
                    >
                      {m.title}
                    </button>
                  ))}
                  {subjectMaterials.length === 0 && <p className="text-xs text-[var(--color-ink-muted)]">Nessun materiale leggibile in questa materia.</p>}
                </div>
              </div>

              {material && materialChapters.length === 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--color-border)] px-3 py-2.5 text-xs text-[var(--color-ink-muted)]">
                  <BookOpen size={14} className="shrink-0" />
                  Questo materiale non ha ancora capitoli — apri il PDF e usa "Capitoli" per dividerlo prima di riassumere.
                </div>
              )}

              {material && materialChapters.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">Capitolo</p>
                  <div className="flex flex-wrap gap-2">
                    {materialChapters.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => resetPicker({ chapterId: c.id })}
                        className={cn('rounded-full px-3 py-1.5 text-xs font-medium', chapterId === c.id ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]')}
                      >
                        {c.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chapter && chapter.subsections.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">Sezione</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => resetPicker({ sectionId: '' })}
                      className={cn('rounded-full px-3 py-1.5 text-xs font-medium', sectionId === '' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]')}
                    >
                      Tutto il capitolo
                    </button>
                    {chapter.subsections.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => resetPicker({ sectionId: s.id })}
                        className={cn('rounded-full px-3 py-1.5 text-xs font-medium', sectionId === s.id ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]')}
                      >
                        {s.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chapter && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={generate} disabled={summarizing}>
                    {summarizing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {activeSummary ? 'Rigenera questo riassunto' : 'Genera riassunto'}
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {subjectId && view === 'read' && (
        <div className="flex flex-col gap-3">
          <button onClick={() => setView('browse')} className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            <ArrowLeft size={14} /> Riassunti
          </button>
          <Card>
            <div className="mb-1 flex items-center gap-2">
              <FileText size={16} className="text-[var(--color-primary)]" />
              <CardTitle>{readLabel}</CardTitle>
            </div>
            <CardSubtitle className="mb-3">{material?.title}</CardSubtitle>
            {activeSummary ? (
              <>
                <MarkdownLite text={activeSummary.content} className="mb-3 rounded-xl bg-[var(--color-surface-2)] p-4 text-sm leading-relaxed" />
                {lastSummaryCall && (
                  <MessageFeedback
                    key={lastSummaryCall.map((e) => e.id).join(',')}
                    callEvent={lastSummaryCall}
                    onGiven={() => tryDistillSkill(lastSummaryCall, `${material?.title} — riassunto`, activeSummary.content)}
                  />
                )}
                <div className="flex gap-2">
                  <Button size="sm" variant="soft" onClick={generate} disabled={summarizing}>
                    {summarizing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Rigenera
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      removeSummary(activeSummary.id)
                      setView('browse')
                    }}
                  >
                    <Trash2 size={14} /> Rimuovi
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <CardSubtitle>Nessun riassunto ancora per questa parte.</CardSubtitle>
                <Button size="sm" onClick={generate} disabled={summarizing}>
                  {summarizing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Genera riassunto
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
