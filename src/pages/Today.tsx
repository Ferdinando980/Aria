import { useMemo } from 'react'
import { AlertCircle } from 'lucide-react'
import { Greeting } from '../components/today/Greeting'
import { FocusTimer } from '../components/today/FocusTimer'
import { RecallCard } from '../components/today/RecallCard'
import { TaskItem } from '../components/today/TaskItem'
import { Card, CardTitle } from '../components/ui/Card'
import { GameWidget } from '../components/game/GameWidget'
import { useAppStore } from '../store/useAppStore'

function isToday(dateStr?: string) {
  if (!dateStr) return false
  return dateStr === new Date().toISOString().slice(0, 10)
}
function isOverdue(dateStr?: string) {
  if (!dateStr) return false
  return dateStr < new Date().toISOString().slice(0, 10)
}

export default function Today() {
  const tasks = useAppStore((s) => s.tasks)

  const { overdue, today, doneToday } = useMemo(() => {
    const overdue = tasks.filter((t) => !t.done && isOverdue(t.dueDate))
    const today = tasks.filter((t) => !t.done && isToday(t.dueDate))
    const doneToday = tasks.filter((t) => t.done && t.doneAt?.slice(0, 10) === new Date().toISOString().slice(0, 10))
    return { overdue, today, doneToday }
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
            <CardTitle>Oggi</CardTitle>
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
