import { useState } from 'react'
import { ThumbsUp, ThumbsDown } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/useAppStore'
import type { SkillEvent } from '../../lib/types'

/**
 * The one direct outcome signal that works the same way across every
 * surface (general chat, task breakdown, material chat) — see skills.ts's
 * module comment on why a behavioral proxy is needed here instead of pytest.
 * `callEvent` is the CALL SkillEvent this message came from; undefined when
 * the Librarian was off or this message predates the feature (nothing to
 * log against, feedback UI just doesn't render). Also accepts an array
 * (2026-08-21, material_knowledge): a material-chat reply is served by TWO
 * domains at once (material_chat + material_knowledge, each logging its own
 * CALL so their F/B stats stay independently meaningful) but gets ONE
 * feedback control, not two rows of thumbs -- one click records an OUTCOME
 * against every CALL event behind that message.
 */
export function MessageFeedback({
  callEvent,
  onGiven,
}: {
  callEvent: SkillEvent | SkillEvent[] | undefined
  onGiven?: (outcome: 'positive' | 'negative') => void
}) {
  const recordSkillOutcome = useAppStore((s) => s.recordSkillOutcome)
  const [given, setGiven] = useState<'positive' | 'negative' | null>(null)

  const events = (Array.isArray(callEvent) ? callEvent : [callEvent]).filter((e): e is SkillEvent => Boolean(e))
  if (events.length === 0) return null
  if (given) {
    return <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">Grazie del feedback.</p>
  }

  function give(outcome: 'positive' | 'negative') {
    for (const e of events) recordSkillOutcome(e, outcome)
    setGiven(outcome)
    onGiven?.(outcome)
  }

  return (
    <div className="mt-1 flex items-center gap-1">
      <button
        onClick={() => give('positive')}
        aria-label="Utile"
        className={cn('rounded-lg p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-good)]')}
      >
        <ThumbsUp size={12} />
      </button>
      <button
        onClick={() => give('negative')}
        aria-label="Non utile"
        className={cn('rounded-lg p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-warn)]')}
      >
        <ThumbsDown size={12} />
      </button>
    </div>
  )
}
