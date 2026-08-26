/**
 * Visual base-10 blocks for a number's tens/units (2026-08-26, real user
 * mockup: "il valore posizionale è mostrato con blocchi visivi (barre da 10
 * + unità), non solo testo"). Gemini emits a `[BLOCCHI] N` line when a
 * number's place value is actually the point of the exercise (see
 * CHEAT_STUDY prompts' BLOCKS_RULE) -- parsed by RichBlock.tsx, not shown
 * for every number that happens to appear in an explanation.
 */
export function PlaceValueBlocks({ value, caption }: { value: number; caption?: string }) {
  const tens = Math.floor(Math.abs(value) / 10)
  const units = Math.abs(value) % 10
  return (
    <div className="my-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      {caption && <p className="mb-3 text-sm font-semibold text-[var(--color-ink)]">{caption}</p>}
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: tens }, (_, i) => (
              <div key={i} className="h-14 w-3.5 rounded-sm" style={{ background: 'var(--color-warn)' }} />
            ))}
            {tens === 0 && <span className="text-xs text-[var(--color-ink-muted)]">nessuna decina</span>}
          </div>
          <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
            <strong className="text-[var(--color-ink)]">{tens}</strong> decine → {tens * 10}
          </p>
        </div>
        <div>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: units }, (_, i) => (
              <div key={i} className="h-3.5 w-3.5 rounded-sm" style={{ background: 'var(--cs-coral, var(--color-warn))', opacity: 0.55 }} />
            ))}
            {units === 0 && <span className="text-xs text-[var(--color-ink-muted)]">nessuna unità</span>}
          </div>
          <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
            <strong className="text-[var(--color-ink)]">{units}</strong> unità → {units}
          </p>
        </div>
      </div>
    </div>
  )
}
