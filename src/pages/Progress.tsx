import { useMemo } from 'react'
import { Flame, Trophy, Snowflake, CheckCircle2 } from 'lucide-react'
import { Card, CardTitle, CardSubtitle } from '../components/ui/Card'
import { Progress } from '../components/ui/Progress'
import { useAppStore } from '../store/useAppStore'
import { XP_PER_LEVEL } from '../lib/types'
import { localDateStr } from '../lib/utils'

const MILESTONES = [3, 7, 14, 30, 60, 100]

export default function ProgressPage() {
  const profile = useAppStore((s) => s.profile)
  const tasks = useAppStore((s) => s.tasks)

  const xpInLevel = profile.xp % XP_PER_LEVEL
  const totalDone = useMemo(() => tasks.filter((t) => t.done).length, [tasks])
  const nextMilestone = MILESTONES.find((m) => m > profile.streakCount) ?? null

  const last7 = useMemo(() => {
    const days: { label: string; done: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = localDateStr(d)
      const done = tasks.filter((t) => t.done && t.doneAt && localDateStr(new Date(t.doneAt)) === key).length
      days.push({ label: d.toLocaleDateString('it-IT', { weekday: 'short' }).slice(0, 1).toUpperCase(), done })
    }
    return days
  }, [tasks])
  const maxDone = Math.max(1, ...last7.map((d) => d.done))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">I tuoi progressi</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Non è una gara. È solo per vedere quanta strada hai fatto.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="text-center">
          <Flame className="mx-auto mb-2 text-[var(--color-accent)]" size={22} />
          <p className="text-2xl font-semibold">{profile.streakCount}</p>
          <CardSubtitle>giorni di streak</CardSubtitle>
        </Card>
        <Card className="text-center">
          <Trophy className="mx-auto mb-2 text-[var(--color-primary)]" size={22} />
          <p className="text-2xl font-semibold">{profile.level}</p>
          <CardSubtitle>livello</CardSubtitle>
        </Card>
        <Card className="text-center">
          <CheckCircle2 className="mx-auto mb-2 text-[var(--color-good)]" size={22} />
          <p className="text-2xl font-semibold">{totalDone}</p>
          <CardSubtitle>compiti completati</CardSubtitle>
        </Card>
        <Card className="text-center">
          <Snowflake className="mx-auto mb-2 text-[var(--color-calm)]" size={22} />
          <p className="text-2xl font-semibold">{profile.streakFreezes}</p>
          <CardSubtitle>salvastreak disponibili</CardSubtitle>
        </Card>
      </div>

      <Card className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>Livello {profile.level}</CardTitle>
          <span className="text-xs text-[var(--color-ink-muted)]">{xpInLevel}/{XP_PER_LEVEL} XP</span>
        </div>
        <Progress value={(xpInLevel / XP_PER_LEVEL) * 100} />
        {nextMilestone && (
          <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
            Mancano {nextMilestone - profile.streakCount} giorni al traguardo dei {nextMilestone} giorni di streak.
          </p>
        )}
      </Card>

      <Card className="mt-5">
        <CardTitle>Ultimi 7 giorni</CardTitle>
        <div className="mt-4 flex items-end justify-between gap-2">
          {last7.map((d, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-2">
              <div className="flex h-24 w-full items-end justify-center">
                <div
                  className="w-6 rounded-full bg-[var(--color-primary)] transition-all"
                  style={{ height: `${(d.done / maxDone) * 100}%`, minHeight: d.done > 0 ? 8 : 3, opacity: d.done > 0 ? 1 : 0.25 }}
                />
              </div>
              <span className="text-[11px] text-[var(--color-ink-muted)]">{d.label}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
