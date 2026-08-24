import { useState } from 'react'
import { Plus, Check, KeyRound, RotateCcw, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { CardSubtitle } from '../ui/Card'
import { Button } from '../ui/Button'
import { SidePanel } from '../ui/SidePanel'
import { Link } from 'react-router-dom'
import { useToastStore } from '../../store/toastStore'
import { generateStudyPlan, reflectOnStudyPlan, hasGeminiKey, GEMINI_MODEL } from '../../lib/gemini'
import { buildStudyPlanChapterInputs } from '../../lib/materialContent'
import { uid, cn, daysUntilNextExam, nextExamEvent, distributeByWeight } from '../../lib/utils'
import { routeSkills, skillsAsPromptContext, tagsFromText } from '../../lib/skills'
import { enforceSkillBudget } from '../../lib/contextBudget'
import { MarkdownLite } from '../shared/MarkdownLite'
import type { Material, Subject } from '../../lib/types'
import { EMPTY_PLAN, useStudyPlanState } from '../../lib/useStudyPlanState'

export function StudyPlanPanel({
  subject,
  materials,
  open,
  onClose,
}: {
  subject: Subject
  materials: Material[]
  open: boolean
  onClose: () => void
}) {
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
  } = useStudyPlanState(subject.id)
  // Guards against a plan saved locally in the old flat-list shape before
  // chapters existed — fall back to "no plan yet" instead of crashing.
  const plan = rawPlan.every((c) => Array.isArray(c?.items)) ? rawPlan : EMPTY_PLAN
  const push = useToastStore((s) => s.push)
  const [loading, setLoading] = useState(false)
  const [openChapters, setOpenChapters] = useState<Set<string>>(new Set())
  const [examDateDraft, setExamDateDraft] = useState('')
  const [examPromptDismissed, setExamPromptDismissed] = useState(false)
  const [examEditing, setExamEditing] = useState(false)

  // See MaterialPlanPanel's identical block for the full rationale (asks for
  // an exam date if the calendar doesn't have one, and -- real user report,
  // 2026-08-24, "non vedo modo di decidere la data" -- stays reachable via
  // "Cambia" even once a date already exists, not just for "none set yet").
  const examEvent = nextExamEvent(events, subject.id)
  const examDaysLeft = daysUntilNextExam(events, subject.id)
  const showExamPrompt = examEditing || (examDaysLeft === undefined && !examPromptDismissed)

  function submitExamDate() {
    if (!examDateDraft) return
    if (examEvent) updateEvent(examEvent.id, { start: `${examDateDraft}T09:00:00.000Z`, allDay: true })
    else addEvent({ subjectId: subject.id, title: 'Esame', start: `${examDateDraft}T09:00:00.000Z`, allDay: true, type: 'esame' })
    setExamEditing(false)
    push({ title: 'Data esame aggiornata', tone: 'good' })
  }

  function toggleChapterOpen(id: string) {
    setOpenChapters((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function generate() {
    setLoading(true)
    try {
      // Regenerating an existing plan is itself a signal it wasn't quite
      // right — before replacing it, let Aria reflect on what happened
      // (how much got done) and refine her own playbook for next time.
      if (plan.length > 0) {
        const allItems = plan.flatMap((c) => c.items)
        const done = allItems.filter((p) => p.done).length
        const outcome = `${done}/${allItems.length} passi completati (su ${plan.length} capitoli) prima di rigenerare il piano.`
        // Structured OUTCOME for the skill library, same threshold used elsewhere
        // in the plan: at least half the steps done before regenerating counts as
        // the previous plan (and whatever skills shaped it) having worked.
        const priorCall = skillEvents.find((e) => e.id === pendingCallEvent)
        if (priorCall) recordSkillOutcome(priorCall, allItems.length > 0 && done / allItems.length >= 0.5 ? 'positive' : 'negative')
        try {
          const updated = await reflectOnStudyPlan(playbook, subject.name, plan.map((c) => c.title), outcome)
          if (updated) setPlaybook(updated)
        } catch {
          // reflection is a bonus, never block regeneration on it
        }
      }
      const chapterInputs = await buildStudyPlanChapterInputs(materials, allChapters)
      const existing = plan.map((c) => ({ title: c.title, summary: c.summary }))

      let skillContext = ''
      let callEvent
      if (librarianEnabled) {
        const retrieved = routeSkills(skills, 'study_plan', tagsFromText(subject.name), 2, 1, skillEvents)
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

      const chapters = await generateStudyPlan(subject.name, chapterInputs, playbook, existing, undefined, skillContext, examDaysLeft)
      if (chapters.length === 0) {
        push({ title: 'Non ho ricevuto un piano valido', description: 'Riprova tra poco.', tone: 'warn' })
        return
      }
      setStudyPlanCallEvent(subject.id, callEvent.id)
      // See MaterialPlanPanel's identical block for the full rationale
      // (scheduling weighted by real DURATA, and the priorByTitle done-state
      // carryover -- 2026-08-24 user reports: "il piano si perde... non
      // essere generato di nuovo da zero ogni volta" and difficulty/density
      // weighting for the day-by-day schedule).
      const weights = chapters.flatMap((c) => {
        const perStep = c.estimatedMinutes && c.steps.length > 0 ? c.estimatedMinutes / c.steps.length : 1
        return c.steps.map(() => perStep)
      })
      // See MaterialPlanPanel's identical block: reserves the last day
      // before the exam for review (RIPASSO questions) instead of
      // scheduling content up to the deadline, when there's enough runway.
      const schedulingDays = examDaysLeft !== undefined && examDaysLeft > 3 ? examDaysLeft - 1 : examDaysLeft
      const dueDates = schedulingDays !== undefined ? distributeByWeight(weights, schedulingDays) : []
      let stepCursor = 0
      const priorByTitle = new Map(plan.flatMap((c) => c.items).map((i) => [i.title.trim().toLowerCase(), i]))
      setStudyPlan(
        subject.id,
        chapters.map((c) => {
          const perStep = c.estimatedMinutes && c.steps.length > 0 ? Math.round(c.estimatedMinutes / c.steps.length) : undefined
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
              // spuntare" -- a scheduled step becomes a real Task (see
              // useAppStore.ts's Task type), not just an internal dueDate.
              // Reuses the PRIOR item's linked task on regenerate (matched
              // by title, same continuity trick as `done`/`addedAsTask`
              // just below) instead of creating a duplicate every time.
              let taskId = prior?.taskId
              if (dueDate) {
                if (taskId) updateTask(taskId, { title, dueDate, estimateMinutes: perStep, subjectId: subject.id })
                else taskId = addTask({ subjectId: subject.id, title, dueDate, estimateMinutes: perStep, priority: 'media' }).id
              }
              return { id: uid(), title, done: prior?.done ?? false, addedAsTask: prior?.addedAsTask ?? !!taskId, dueDate, taskId }
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
      // See MaterialPlanPanel's identical block for the full rationale.
      console.error('[StudyPlanPanel] generate failed', err)
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
    <SidePanel
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Piano di studio — tutta la materia"
      subtitle={
        plan.length > 0 ? (
          <div className="flex items-center gap-3">
            <button onClick={generate} disabled={loading} className="flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
              <RotateCcw size={11} /> {loading ? 'Aggiorno...' : 'rigenera'}
            </button>
            <button
              onClick={() => {
                removeStudyPlan(subject.id)
                push({ title: 'Piano eliminato', tone: 'good' })
              }}
              className="flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-warn)]"
              title="Elimina questo piano"
            >
              <Trash2 size={11} /> elimina
            </button>
          </div>
        ) : undefined
      }
    >
      {examEvent && !showExamPrompt && (
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
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <KeyRound size={18} className="text-[var(--color-ink-muted)]" />
          <CardSubtitle>Serve una chiave Gemini gratuita per generarlo.</CardSubtitle>
          <Link to="/impostazioni">
            <Button size="sm">Vai alle Impostazioni</Button>
          </Link>
        </div>
      ) : plan.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CardSubtitle>
            Aria guarda TUTTI i materiali di questa materia insieme e propone un piano diviso per capitolo. Per un piano su un singolo file, apri quel file e usa "Piano (questo file)".
          </CardSubtitle>
          <Button size="sm" onClick={generate} disabled={loading}>
            {loading ? 'Leggo i materiali...' : 'Genera piano di studio'}
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
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
                    const moved = reassignOverdue(subject.id)
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
            // Real user request (2026-08-21): "quando clicco su una parte
            // che è stata generata mostri il riassunto di quella parte" --
            // materialChapterId links this plan chapter to the real
            // MaterialChapter it came from; MaterialSummary is scoped the
            // same way (chapterId + optional sectionId -- matches the exact
            // section too now, 2026-08-24, not just its parent chapter).
            const linkedSummary = chapter.materialChapterId
              ? summaries.find((s) => s.chapterId === chapter.materialChapterId && s.sectionId === chapter.materialSectionId)
              : undefined
            return (
              <div key={chapter.id} className="overflow-hidden rounded-xl border border-[var(--color-border)]">
                <button onClick={() => toggleChapterOpen(chapter.id)} className="flex w-full items-start justify-between gap-2 p-3 text-left">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{chapter.title}</p>
                    {chapter.summary && <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-ink-muted)]">{chapter.summary}</p>}
                    <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
                      {done}/{chapter.items.length} passi{chapter.estimatedMinutes ? ` · ~${chapter.estimatedMinutes} min` : ''}
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
                          onClick={() => toggleItem(subject.id, chapter.id, item.id)}
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
                              addAsTask(subject.id, chapter.id, item.id)
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
    </SidePanel>
  )
}
