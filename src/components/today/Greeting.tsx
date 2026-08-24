import { useAppStore } from '../../store/useAppStore'

function timeGreeting() {
  const h = new Date().getHours()
  if (h < 6) return 'Sei sveglio/a fino a tardi'
  if (h < 12) return 'Buongiorno'
  if (h < 18) return 'Buon pomeriggio'
  return 'Buonasera'
}

const NO_TASKS_LINES = [
  'Nessun impegno fissato per oggi: va benissimo così, respira.',
  'Giornata libera sul planner. Se vuoi, aggiungi qualcosa; altrimenti riposa.',
]

export function Greeting({ pendingCount, doneCount }: { pendingCount: number; doneCount: number }) {
  const profile = useAppStore((s) => s.profile)

  let sub: string
  if (pendingCount === 0 && doneCount === 0) {
    sub = NO_TASKS_LINES[0]
  } else if (pendingCount === 0) {
    sub = 'Hai chiuso tutto quello che avevi in programma oggi. Sul serio, ottimo lavoro.'
  } else {
    sub = `Hai ${pendingCount} ${pendingCount === 1 ? 'cosa' : 'cose'} in programma. Una alla volta, nessuna fretta.`
  }

  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold text-[var(--color-ink)]">
        {timeGreeting()}, {profile.displayName || 'tu'}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{sub}</p>
    </div>
  )
}
