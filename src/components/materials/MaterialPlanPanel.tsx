import { useState } from 'react'
import { Plus, Check, KeyRound, RotateCcw, ChevronDown, ChevronUp, X, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Link } from 'react-router-dom'
import { useToastStore } from '../../store/toastStore'
import { generateStudyPlan, reflectOnStudyPlan, hasGeminiKey, GEMINI_MODEL } from '../../lib/gemini'
import { buildStudyPlanChapterInputs, isViewableInline } from '../../lib/materialContent'
import { uid, cn, daysUntilNextExam, nextExamEvent, distributeByWeight, chapterPageRange } from '../../lib/utils'
import { routeSkills, skillsAsPromptContext, tagsFromText } from '../../lib/skills'
import { enforceSkillBudget } from '../../lib/contextBudget'
import { MarkdownLite } from '../shared/MarkdownLite'
import type { Material } from '../../lib/types'
import { EMPTY_PLAN, useStudyPlanState } from '../../lib/useStudyPlanState'

export function MaterialPlanPanel({ material, onClose }: { material: Material; onClose: () => void }) {
  const planKey = `material:${material.id}`
  const {
    rawPlan,
    setStudyPlan,
    removeStudyPlan,
    addTask,
    updateTask,
    toggleItem,
    addAsTask,
    playbook,
    setPlaybook,
    skills,
    librarianEnabled,
    logSkillCall,
    recordSkillOutcome,
    pendingCallEvent,
    skillEvents,
    events,
    setStudyPlanCallEvent,
    allChapters,
    summaries,
    addEvent,
    updateEvent,
    reassignOverdue,
  } = useStudyPlanState(planKey)
  const plan = rawPlan.every((c) => Array.isArray(c?.items)) ? rawPlan : EMPTY_PLAN
  const push = useToastStore((s) => s.push)
  const [loading, setLoading] = useState(false)
  const [openChapters, setOpenChapters] = useState<Set<string>>(new Set())
  const [examDateDraft, setExamDateDraft] = useState('')
  const [examPromptDismissed, setExamPromptDismissed] = useState(false)
  const [examEditing, setExamEditing] = useState(false)

  // "Quando viene generato un piano deve essere richiesta/associata una data
  // dell'esame... se nel calendario esiste già un evento, usa quella"
  // (2026-08-24 roadmap). daysUntilNextExam already reads a real 'esame'
  // calendar event if one exists (see generate()'s use below, pre-existing)
  // -- this just adds the missing other half: if none exists, ASK instead of
  // silently planning with no sense of deadline forever. Skippable, not
  // blocking (addEvent below only fires on explicit submit) -- an exam date
  // isn't always known yet, matches this app's no-forced-input philosophy.
  // Real user report, same day: "non vedo modo di decidere la data" -- the
  // first version only ever showed a date-picker ONCE, when no exam date
  // existed; once one was set (by this, or by an event already on the
  // calendar), there was no visible trace of it and no way to change it.
  // Now: examEditing keeps the picker reachable even when a date already
  // exists (via the persistent "Cambia" line below), not just for "none
  // set yet".
  const examEvent = material.subjectId ? nextExamEvent(events, material.subjectId) : undefined
  const examDaysLeft = material.subjectId ? daysUntilNextExam(events, material.subjectId) : undefined
  const showExamPrompt = !!material.subjectId && (examEditing || (examDaysLeft === undefined && !examPromptDismissed))

  function submitExamDate() {
    if (!examDateDraft || !material.subjectId) return
    if (examEvent) updateEvent(examEvent.id, { start: `${examDateDraft}T09:00:00.000Z`, allDay: true })
    else addEvent({ subjectId: material.subjectId, title: 'Esame', start: `${examDateDraft}T09:00:00.000Z`, allDay: true, type: 'esame' })
    setExamEditing(false)
    push({ title: 'Data esame aggiornata', tone: 'good' })
  }

  // User request (2026-08-24): "non puoi creare il piano di studi senza aver
  // fatto la generazione dei capitoli" -- a plan built without real detected
  // chapters used to silently fall back to one whole-material chunk
  // (buildStudyPlanChapterInputs' fallback for a material with no chapters
  // yet), which defeats the point of the whole capitoli->piano rewire from
  // 2026-08-21 (linkMaterialChapterIds, per-chapter summaries). Only applies
  // to PDFs -- notes/links/other file kinds have no chapter concept at all,
  // and must keep using that same fallback as their only path.
  const isPdf = material.type === 'file' && isViewableInline(material) === 'pdf'
  const hasChapters = allChapters.some((c) => c.materialId === material.id)
  const chaptersRequired = isPdf && !hasChapters

  function toggleChapterOpen(id: string) {
    setOpenChapters((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function generate() {
    if (chaptersRequired) {
      push({ title: 'Rileva prima i capitoli', description: 'Usa il pulsante "Capitoli" nel visualizzatore, poi torna qui.', tone: 'warn' })
      return
    }
    setLoading(true)
    try {
      if (plan.length > 0) {
        const allItems = plan.flatMap((c) => c.items)
        const done = allItems.filter((p) => p.done).length
        const outcome = `${done}/${allItems.length} passi completati (piano su un singolo file: "${material.title}") prima di rigenerare.`
        const priorCall = skillEvents.find((e) => e.id === pendingCallEvent)
        if (priorCall) recordSkillOutcome(priorCall, allItems.length > 0 && done / allItems.length >= 0.5 ? 'positive' : 'negative')
        try {
          const updated = await reflectOnStudyPlan(playbook, material.title, plan.map((c) => c.title), outcome)
          if (updated) setPlaybook(updated)
        } catch {
          // reflection is a bonus, never block regeneration on it
        }
      }
      const chapterInputs = await buildStudyPlanChapterInputs([material], allChapters)
      const existing = plan.map((c) => ({ title: c.title, summary: c.summary }))

      let skillContext = ''
      let callEvent
      if (librarianEnabled) {
        const retrieved = routeSkills(skills, 'study_plan', [`material:${material.id}`, ...tagsFromText(material.title)], 2, 1, skillEvents)
        const baseText = chapterInputs.map((c) => c.text).join('\n') + '\n' + playbook + '\n' + existing.map((c) => c.summary).join('\n')
        const budgeted = enforceSkillBudget(baseText, retrieved, GEMINI_MODEL)
        if (budgeted.baseOverBudget || budgeted.droppedSkillIds.length > 0) {
          console.warn('[contextBudget] skill context ridotto per budget', { domain: 'study_plan', ...budgeted })
        }
        skillContext = skillsAsPromptContext(budgeted.skills)
        callEvent = logSkillCall('study_plan', budgeted.skills.length > 0 ? 'F' : 'B', budgeted.skills.map((s) => s.id), GEMINI_MODEL)
      } else {
        callEvent = logSkillCall('study_plan', 'B', [], GEMINI_MODEL)
      }

      const chapters = await generateStudyPlan(
        material.title,
        chapterInputs,
        playbook,
        existing,
        'solo questo materiale',
        skillContext,
        examDaysLeft,
      )
      if (chapters.length === 0) {
        push({ title: 'Non ho ricevuto un piano valido', description: 'Riprova tra poco.', tone: 'warn' })
        return
      }
      setStudyPlanCallEvent(planKey, callEvent.id)
      // Day-by-day schedule (2026-08-24): weighted by real PAGE COUNT where
      // known (chapterPageRange, from the real MaterialChapter/ChapterSection
      // this StudyPlanChapter was generated from) -- real user request
      // "vorrei che dividesse il numero di pagine da studiare per ciascuna
      // [giornata]... oggi ho fatto 10-15 pagine, domani 20-25" needs day
      // boundaries that actually track page count, not just an estimate that
      // happens to correlate with it. Falls back to the model's own DURATA
      // estimate per chapter (see distributeByWeight's comment) when a
      // chapter has no detected page range -- the whole-material fallback
      // case (materialContent.ts's buildStudyPlanChapterInputs), not common
      // but real -- and to an even per-step weight (1) if DURATA didn't
      // parse either. Spread evenly across a chapter's own steps and
      // bin-packed across ALL steps in chapter order (not per-chapter
      // independently) so early chapters don't all land on day 1 while later
      // ones get crammed -- this also means a chapter straddling a day
      // boundary gets its steps split roughly in proportion to its own page
      // count, not an arbitrary cut. No dueDate at all when examDaysLeft is
      // undefined (see StudyPlanItem's comment).
      const weights = chapters.flatMap((c) => {
        if (c.steps.length === 0) return []
        const pages = chapterPageRange(c.materialChapterId, c.materialSectionId, allChapters)
        const perStep = pages
          ? (pages.end - pages.start + 1) / c.steps.length
          : c.estimatedMinutes
            ? c.estimatedMinutes / c.steps.length
            : 1
        return c.steps.map(() => perStep)
      })
      // "Giornate di revisione" (2026-08-24 roadmap): with enough runway,
      // reserve the LAST day before the exam for review instead of
      // scheduling new content right up to the deadline -- no new content
      // TYPE invented for this (RIPASSO questions already exist per
      // chapter and are the real review material); this just leaves that
      // day's schedule empty on purpose so there's something to reserve it
      // for. Below 4 days there's no real slack to spare -- scheduling
      // every day is more honest than pretending there's room for a buffer.
      const schedulingDays = examDaysLeft !== undefined && examDaysLeft > 3 ? examDaysLeft - 1 : examDaysLeft
      const dueDates = schedulingDays !== undefined ? distributeByWeight(weights, schedulingDays) : []
      let stepCursor = 0
      // User report (2026-08-24): "il piano si perde, dovrebbe mantenersi non
      // essere generato di nuovo da zero ogni volta" -- real bug, not a
      // misunderstanding: regenerate always built brand-new items with
      // done:false, discarding all checked-off progress every time (the old
      // plan's completion % was only ever read for the reflection signal
      // above, never carried into the new items). Matched by exact title
      // text (case/whitespace-insensitive) since that's the only stable
      // identity a regenerated step has -- ids are always fresh.
      const priorByTitle = new Map(plan.flatMap((c) => c.items).map((i) => [i.title.trim().toLowerCase(), i]))
      setStudyPlan(
        planKey,
        chapters.map((c) => {
          const perStep = c.estimatedMinutes && c.steps.length > 0 ? Math.round(c.estimatedMinutes / c.steps.length) : undefined
          const pageRange = chapterPageRange(c.materialChapterId, c.materialSectionId, allChapters)
          return {
            id: uid(),
            title: c.title,
            summary: c.summary,
            items: c.steps.map((title) => {
              const dueDate = dueDates[stepCursor]
              stepCursor++
              const prior = priorByTitle.get(title.trim().toLowerCase())
              // Real user request (2026-08-24): "voglio che mi assegni le
              // task giornaliere... escono nella sezione oggi... le vado a
              // spuntare" -- a scheduled step becomes a real Task, reusing
              // the PRIOR item's linked task on regenerate (matched by
              // title) instead of creating a duplicate every time.
              let taskId = prior?.taskId
              if (dueDate) {
                if (taskId) updateTask(taskId, { title, dueDate, estimateMinutes: perStep, subjectId: material.subjectId, pageRange })
                else taskId = addTask({ subjectId: material.subjectId, title, dueDate, estimateMinutes: perStep, priority: 'media', pageRange }).id
              }
              return { id: uid(), title, done: prior?.done ?? false, addedAsTask: prior?.addedAsTask ?? !!taskId, dueDate, taskId, pageRange }
            }),
            quiz: c.quiz.map((question) => ({ id: uid(), question })),
            materialChapterId: c.materialChapterId,
            materialSectionId: c.materialSectionId,
            estimatedMinutes: c.estimatedMinutes,
          }
        }),
      )
      setOpenChapters(new Set())
    } catch (err) {
      // Real cause, not always-blame-the-key (2026-08-24, same fix as
      // Assistant.tsx/MaterialAskPanel.tsx -- withRetry already retries real
      // 429/5xx up to 4 times before this is ever reached).
      console.error('[MaterialPlanPanel] generate failed', err)
      const message = err instanceof Error ? err.message : String(err)
      const looksLikeKeyIssue = /api.?key|permission|401|403/i.test(message)
      const looksOverloaded = /50[034]|429|overloaded|high demand/i.test(message)
      push({
        title: 'Non è andata',
        description: looksLikeKeyIssue
          ? 'Controlla la chiave Gemini nelle Impostazioni.'
          : looksOverloaded
            ? 'Gemini è sovraccarico in questo momento — aspetta un minuto e riprova.'
            : 'Riprova tra poco.',
        tone: 'warn',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{material.title}</p>
          <p className="mt-0.5 truncate text-xs text-[var(--color-ink-muted)]">Piano di studio su questo file</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {plan.length > 0 && (
            <>
              <button onClick={generate} disabled={loading} title="Rigenera" className="rounded-lg p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]">
                <RotateCcw size={14} />
              </button>
              <button
                onClick={() => {
                  removeStudyPlan(planKey)
                  push({ title: 'Piano eliminato', tone: 'good' })
                }}
                title="Elimina questo piano"
                className="rounded-lg p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-warn)]"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {material.subjectId && examEvent && !showExamPrompt && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-[var(--color-surface-2)] p-2.5 text-xs">
            <span className="text-[var(--color-ink)]">
              Esame: {new Date(examEvent.start).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}
              {examDaysLeft !== undefined && <span className="text-[var(--color-ink-muted)]"> ({examDaysLeft <= 0 ? 'oggi/passato' : `tra ${examDaysLeft} giorni`})</span>}
            </span>
            <button
              onClick={() => {
                setExamDateDraft(examEvent.start.slice(0, 10))
                setExamEditing(true)
              }}
              className="text-[var(--color-primary)] underline underline-offset-2"
            >
              Cambia
            </button>
          </div>
        )}
        {showExamPrompt && (
          <div className="mb-3 flex flex-col gap-2 rounded-xl bg-[var(--color-surface-2)] p-3">
            <p className="text-xs text-[var(--color-ink-muted)]">Quando è l'esame di questa materia? Aiuta Aria a dimensionare il piano sul tempo reale.</p>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={examDateDraft}
                onChange={(e) => setExamDateDraft(e.target.value)}
                className="h-9 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
              />
              <Button size="sm" disabled={!examDateDraft} onClick={submitExamDate}>
                {examEvent ? 'Aggiorna' : 'Aggiungi'}
              </Button>
            </div>
            <button
              onClick={() => {
                setExamPromptDismissed(true)
                setExamEditing(false)
              }}
              className="self-start text-[11px] text-[var(--color-ink-muted)] underline underline-offset-2"
            >
              {examEvent ? 'Annulla' : 'Non lo so ancora'}
            </button>
          </div>
        )}
        {!hasGeminiKey() ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <KeyRound size={20} className="text-[var(--color-ink-muted)]" />
            <p className="text-sm text-[var(--color-ink-muted)]">Serve una chiave Gemini gratuita.</p>
            <Link to="/impostazioni">
              <Button size="sm">Vai alle Impostazioni</Button>
            </Link>
          </div>
        ) : chaptersRequired ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Sparkles size={18} className="text-[var(--color-ink-muted)]" />
            <p className="text-sm text-[var(--color-ink-muted)]">
              Prima rileva i capitoli di questo file (pulsante "Capitoli" nel visualizzatore) — il piano si costruisce sui capitoli reali, non su un unico blocco indiviso.
            </p>
            <Button size="sm" variant="soft" onClick={onClose}>
              Torna al visualizzatore
            </Button>
          </div>
        ) : plan.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Sparkles size={18} className="text-[var(--color-ink-muted)]" />
            <p className="text-sm text-[var(--color-ink-muted)]">
              Aria analizza SOLO questo file e propone un piano diviso per capitolo, con domande di ripasso incluse.
            </p>
            <Button size="sm" onClick={generate} disabled={loading}>
              {loading ? 'Leggo il file...' : 'Genera piano su questo file'}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {(() => {
              const today = new Date().toISOString().slice(0, 10)
              const overdueCount = plan.reduce((n, c) => n + c.items.filter((i) => !i.done && i.dueDate && i.dueDate < today).length, 0)
              if (overdueCount === 0) return null
              return (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-[var(--color-warn)]/10 p-2.5">
                  <p className="text-xs text-[var(--color-warn)]">
                    {overdueCount} {overdueCount === 1 ? 'passo in ritardo' : 'passi in ritardo'}
                  </p>
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={() => {
                      const moved = reassignOverdue(planKey)
                      push({ title: moved > 0 ? `${moved} passi riassegnati` : 'Niente da riassegnare', tone: 'good' })
                    }}
                  >
                    Riassegna i task in ritardo
                  </Button>
                </div>
              )
            })()}
            {plan.map((chapter) => {
              const chapterOpen = openChapters.has(chapter.id)
              const done = chapter.items.filter((i) => i.done).length
              // Matches the exact section too, not just the parent chapter
              // (2026-08-24 -- see StudyPlanChapter.materialSectionId).
              const linkedSummary = chapter.materialChapterId
                ? summaries.find((s) => s.chapterId === chapter.materialChapterId && s.sectionId === chapter.materialSectionId)
                : undefined
              // Same range for every item in this chapter -- shown once here,
              // not per-item below (see Task.pageRange's comment).
              const pageRange = chapterPageRange(chapter.materialChapterId, chapter.materialSectionId, allChapters)
              return (
                <div key={chapter.id} className="overflow-hidden rounded-xl border border-[var(--color-border)]">
                  <button onClick={() => toggleChapterOpen(chapter.id)} className="flex w-full items-start justify-between gap-2 p-3 text-left">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{chapter.title}</p>
                      {chapter.summary && <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-ink-muted)]">{chapter.summary}</p>}
                      <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
                        {done}/{chapter.items.length} passi{chapter.estimatedMinutes ? ` · ~${chapter.estimatedMinutes} min` : ''}
                        {pageRange ? ` · p. ${pageRange.start}–${pageRange.end}` : ''}
                      </p>
                    </div>
                    {chapterOpen ? <ChevronUp size={14} className="mt-0.5 shrink-0 text-[var(--color-ink-muted)]" /> : <ChevronDown size={14} className="mt-0.5 shrink-0 text-[var(--color-ink-muted)]" />}
                  </button>

                  {chapterOpen && (
                    <ul className="flex flex-col gap-2 border-t border-[var(--color-border)] p-3 pt-2.5">
                      {linkedSummary && (
                        <li className="rounded-lg border border-dashed border-[var(--color-border)] p-2.5">
                          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">Riassunto di questa parte</p>
                          <MarkdownLite text={linkedSummary.content} className="text-xs leading-relaxed text-[var(--color-ink-muted)]" />
                        </li>
                      )}
                      {chapter.items.map((item) => (
                        <li key={item.id} className="flex items-center gap-2.5 rounded-lg bg-[var(--color-surface-2)] p-2.5">
                          <button
                            onClick={() => toggleItem(planKey, chapter.id, item.id)}
                            className={cn(
                              'grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
                              item.done ? 'border-[var(--color-good)] bg-[var(--color-good)]' : 'border-[var(--color-border)]',
                            )}
                          >
                            {item.done && <Check size={11} className="text-[var(--color-bg)]" />}
                          </button>
                          <span className={cn('min-w-0 flex-1 text-sm', item.done && 'text-[var(--color-ink-muted)] line-through')}>{item.title}</span>
                          {!item.done && item.dueDate && item.dueDate < new Date().toISOString().slice(0, 10) && (
                            <span className="shrink-0 text-[11px] text-[var(--color-warn)]">in ritardo</span>
                          )}
                          {item.addedAsTask ? (
                            <span className="shrink-0 text-xs text-[var(--color-good)]">aggiunto</span>
                          ) : (
                            <button
                              onClick={() => {
                                addAsTask(planKey, chapter.id, item.id, material.subjectId)
                                push({ title: 'Aggiunto ai tuoi task', tone: 'good' })
                              }}
                              className="flex shrink-0 items-center gap-1 rounded-lg bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                            >
                              <Plus size={12} /> task
                            </button>
                          )}
                        </li>
                      ))}
                      {chapter.quiz && chapter.quiz.length > 0 && (
                        <li className="rounded-lg border border-dashed border-[var(--color-border)] p-2.5">
                          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">Ripasso lampo</p>
                          <ul className="flex flex-col gap-1">
                            {chapter.quiz.map((q) => (
                              <li key={q.id} className="text-xs text-[var(--color-ink-muted)]">
                                · {q.question}
                              </li>
                            ))}
                          </ul>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
