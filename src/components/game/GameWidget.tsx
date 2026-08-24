import { Gamepad2, Lock } from 'lucide-react'
import { useFocusStore } from '../../store/focusStore'
import { useGameStore } from '../../store/gameStore'
import { cn } from '../../lib/utils'

export function GameWidget({ compact = false, iconOnly = false }: { compact?: boolean; iconOnly?: boolean }) {
  const running = useFocusStore((s) => s.running)
  const secondsRemaining = useGameStore((s) => s.secondsRemaining())
  const locked = running

  const label = 'Pausa gioco (Tetris)'
  const sublabel = locked ? 'Sbloccato a timer fermo' : secondsRemaining > 0 ? `${Math.ceil(secondsRemaining / 60)} min oggi · apre una scheda` : 'Finito per oggi'

  return (
    <button
      onClick={() => !locked && window.open('/gioco', '_blank', 'noopener,noreferrer,width=520,height=760')}
      disabled={locked}
      title={iconOnly ? `${label} — ${sublabel}` : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] text-left transition-colors',
        locked ? 'cursor-not-allowed opacity-60' : 'hover:border-[var(--color-primary)]',
        iconOnly ? 'h-11 w-11 justify-center p-0' : 'w-full px-3.5 py-3',
        compact && !iconOnly && 'py-2.5',
      )}
    >
      <span className={cn('grid shrink-0 place-items-center rounded-xl bg-[var(--color-surface)]', iconOnly ? 'h-8 w-8' : 'h-8 w-8')}>
        {locked ? <Lock size={14} className="text-[var(--color-ink-muted)]" /> : <Gamepad2 size={15} className="text-[var(--color-accent)]" />}
      </span>
      {!iconOnly && (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-[var(--color-ink)]">{label}</span>
          <span className="block truncate text-[11px] text-[var(--color-ink-muted)]">{sublabel}</span>
        </span>
      )}
    </button>
  )
}
