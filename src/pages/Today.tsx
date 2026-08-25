import { useMemo } from 'react'
import { AlertCircle } from 'lucide-react'
import { Greeting } from '../components/today/Greeting'
import { FocusTimer } from '../components/today/FocusTimer'
import { RecallCard } from '../components/today/RecallCard'
import { TaskItem } from '../components/today/TaskItem'
import { Card, CardTitle } from '../components/ui/Card'
import { GameWidget } from '../components/game/GameWidget'
import { useAppStore } from '../store/useAppStore'
import { localDateStr } from '../lib/utils'

function isToday(dateStr?: string) {
  if (!dateStr) return false
  return dateStr === localDateStr()
}
function isOverdue(dateStr?: string) {
  if (!dateStr) return false
  return dateStr < localDateStr()
}

export default function Today() {
  const tasks = useAppStore((s) => s.tasks)

  const { overdue, today, doneToday, todayPageRange } = useMemo(() => {
    const overdue = tasks.filter((t) => !t.done && isOverdue(t.dueDate))
    const today = tasks.filter((t) => !t.done && isToday(t.dueDate))
    const doneToday = tasks.filter((t) => t.done && t.doneAt && localDateStr(new Date(t.doneAt)) === localDateStr())
    // Real user request (2026-08-24): "oggi ho fatto 10-15 pagine, domani
    // 20-25" -- aggregate of whichever of today's tasks actually carry a real
    // page range (see Task.pageRange); undefined, not a guess, when none do.
    const ranges = today.map((t) => t.pageRange).filter((r): r is NonNullable<typeof r> => !!r)
    const todayPageRange = ranges.length > 0
      ? { start: Math.min(...ranges.map((r) => r.start)), end: Math.max(...ranges.map((r) => r.end)) }
      : undefined
    return { overdue, today, doneToday, todayPageRange }
  }, [tasks])

  const pendingCount = overdue.length + today.length

  return (
    <div>
      <Greeting pendingCount={pendingCount} doneCount={doneToday.length} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-5">
          {overdue.length > 0 && (
            <Card className="border-[color-mix(in_srgb,var(--color-warn)_45%,var(--color-border))]">
              <div className="mb-3 flex items-center gap-2 text-[var(--color-warn)]">
                <AlertCircle size={16} />
                <CardTitle className="text-[var(--color-warn)]">Rimaste indietro — nessun dramma</CardTitle>
              </div>
              <div className="flex flex-col gap-2">
                {overdue.map((t) => (
                  <TaskItem key={t.id} task={t} />
                ))}
              </div>
            </Card>
          )}

          <Card>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Oggi</CardTitle>
              {todayPageRange && (
                <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-muted)]">
                  Pagine di oggi: {todayPageRange.start}–{todayPageRange.end}
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {today.length === 0 && (
                <p className="rounded-xl bg-[var(--color-surface-2)] p-4 text-sm text-[var(--color-ink-muted)]">
                  Niente in programma per oggi. Usa il tasto + per catturare qualcosa quando ti viene in mente.
                </p>
              )}
              {today.map((t) => (
                <TaskItem key={t.id} task={t} />
              ))}
            </div>
          </Card>

          {doneToday.length > 0 && (
            <Card>
              <CardTitle>Completati oggi</CardTitle>
              <div className="mt-3 flex flex-col gap-2">
                {doneToday.map((t) => (
                  <TaskItem key={t.id} task={t} />
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <RecallCard />
          <FocusTimer />
          <div className="lg:hidden">
            <GameWidget />
          </div>
        </div>
      </div>
    </div>
  )
}
