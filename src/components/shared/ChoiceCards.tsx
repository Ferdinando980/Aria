import { useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Big clickable answer cards for exercises that are genuinely multiple-
 * choice (2026-08-26, real user mockup: "le risposte sono card grandi e
 * cliccabili (min. 44px), non checkbox piccoli"). Only rendered when Gemini
 * emits a `[SCELTA]`/`[RISPOSTA]` block (see RichBlock.tsx) -- never forced
 * onto an open-ended/proof exercise that has no discrete options (real user
 * instruction: "scelta multipla solo dove ha senso... non serve forzarla").
 * Click reveals the right answer in green -- a wrong pick gets a soft
 * amber/coral marker, never red, same "mai colpevolizzare" principle as the
 * rest of the app (see index.css's palette comment). Re-clickable (2026-08-26,
 * real user correction: "devo poter cambiare le risposte... non avrebbe
 * senso" se restasse bloccata) -- picking a different option after seeing
 * the first reveal just updates the selection, same as changing your mind
 * before submitting; there's no "final answer" step to lock against.
 */
export function ChoiceCards({ options, correct }: { options: { letter: string; text: string }[]; correct: string }) {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div className="my-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map((opt) => {
        const isCorrect = opt.letter === correct
        const isSelected = opt.letter === selected
        const revealed = selected !== null
        return (
          <button
            key={opt.letter}
            onClick={() => setSelected(opt.letter)}
            className={cn(
              'flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left text-sm transition-colors',
              revealed && isCorrect
                ? 'border-[var(--color-good)] bg-[color-mix(in_srgb,var(--color-good)_16%,var(--color-surface))]'
                : revealed && isSelected
                  ? 'border-[var(--color-warn)] bg-[color-mix(in_srgb,var(--color-warn)_14%,var(--color-surface))]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary)]',
            )}
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                revealed && isCorrect ? 'bg-[var(--color-good)] text-[#0a1f16]' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
              )}
            >
              {revealed && isCorrect ? <Check size={14} /> : opt.letter}
            </span>
            <span className={cn('leading-snug', revealed && isCorrect ? 'font-semibold text-[var(--color-ink)]' : 'text-[var(--color-ink)]')}>{opt.text}</span>
          </button>
        )
      })}
    </div>
  )
}
