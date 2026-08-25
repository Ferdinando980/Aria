import type { FlashcardSuggestion } from './gemini'

/**
 * Foundation skill pilot #3: fs_error_detection_duplicate_check (2026-08-25 —
 * see FOUNDATION_SKILLS_LOG.md). FLASHCARDS_PROMPT (gemini.ts) already TELLS
 * the model not to repeat existing fronts when generating "altre" cards --
 * but until now nothing independently checked whether it actually complied.
 * Same gap self-verification closed for chapters/formula_example, applied to
 * a genuinely different defect class: not "is this value internally
 * consistent" but "did the model violate an explicit constraint against
 * known prior state". Pure string comparison, zero model judgment.
 *
 * Unlike task_decomposition's soft/log-only check, this one is safe to ACT
 * on directly: a normalized-duplicate front is redundant by definition, so
 * filtering it out before addFlashcards() can only remove genuine waste, never
 * a legitimate card -- see FlashcardsPanel's call site.
 */

export interface DuplicateCheckResult {
  keep: FlashcardSuggestion[]
  dropped: { card: FlashcardSuggestion; duplicateOf: string }[]
  pass: boolean
}

function normalize(front: string): string {
  return front
    .toLowerCase()
    .trim()
    .replace(/[?!.,;:'"()]/g, '')
    .replace(/\s+/g, ' ')
}

/**
 * Foundation skill pilot #6: fs_targeted_error_correction (2026-08-25 — see
 * FOUNDATION_SKILLS_LOG.md). Depends on fs_error_detection_duplicate_check
 * above, exactly as predicted by the taxonomy's dependency graph (§6):
 * error_correction composes error_detection, doesn't reinvent it. When
 * duplicates were dropped, this plans a TARGETED retry request (avoid both
 * the original existing fronts AND the ones just kept, so the retry can't
 * re-collide with content already accepted this same call) instead of
 * silently accepting fewer cards than asked for.
 *
 * The retry's actual Gemini call lives in Flashcards.tsx (real API round-trip,
 * not something a throwaway script should exercise) -- this file holds only
 * the pure, testable planning/merge logic: what to avoid, and how to filter
 * the second batch. mergeCorrectedBatch reuses checkForDuplicateFlashcards
 * itself against the expanded avoid-list, so a still-duplicate retry result
 * is caught the same way, not by a second, different mechanism.
 */
export function frontsToAvoidForRetry(existingFronts: string[], keptFromFirstBatch: FlashcardSuggestion[]): string[] {
  return [...existingFronts, ...keptFromFirstBatch.map((c) => c.front)]
}

export function mergeCorrectedBatch(retryCards: FlashcardSuggestion[], frontsToAvoid: string[], neededCount: number): { accepted: FlashcardSuggestion[]; stillDuplicate: number } {
  const { keep, dropped } = checkForDuplicateFlashcards(retryCards, frontsToAvoid)
  return { accepted: keep.slice(0, neededCount), stillDuplicate: dropped.length }
}

export function checkForDuplicateFlashcards(newCards: FlashcardSuggestion[], existingFronts: string[]): DuplicateCheckResult {
  const existingNormalized = new Set(existingFronts.map(normalize))
  const seenInBatch = new Set<string>()
  const keep: FlashcardSuggestion[] = []
  const dropped: { card: FlashcardSuggestion; duplicateOf: string }[] = []

  for (const card of newCards) {
    const n = normalize(card.front)
    if (existingNormalized.has(n)) {
      dropped.push({ card, duplicateOf: 'materiale esistente' })
      continue
    }
    if (seenInBatch.has(n)) {
      dropped.push({ card, duplicateOf: 'un\'altra card appena generata' })
      continue
    }
    seenInBatch.add(n)
    keep.push(card)
  }

  return { keep, dropped, pass: dropped.length === 0 }
}
