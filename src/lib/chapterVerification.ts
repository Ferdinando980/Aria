import type { ChapterSuggestion } from './gemini'

/**
 * Foundation skill pilot: self-verification via independent recomputation
 * (fs_self_verification_recompute) -- see the 2026-08-25 taxonomy artifact.
 * Generalizes formulaExamples.ts's verifyRecurrenceExample to a second, genuinely
 * different domain (chapter detection vs. numeric recurrences) using the same
 * principle: never ask the model whether its own output is correct -- compute
 * an independent ground truth (here: the REAL page count from the actual PDF
 * extraction, never from the model's own declared ranges) and check the
 * declared structure against it with pure arithmetic.
 *
 * Deliberately does NOT block chapter creation on failure (unlike formula_example's
 * hard gate) -- a study material with imperfect chapter boundaries is still far
 * more useful than none at all, and this is a research pilot measuring whether
 * the check catches real defects, not a UX change users asked for. The caller
 * decides what to do with the result (today: a console log + a softer toast
 * instead of the success one on a real failure -- see ChaptersPanel.tsx).
 */

export interface ChapterVerification {
  pass: boolean
  reason?: string
  coverageRatio: number
  overlapCount: number
  gapCount: number
  outOfBoundsCount: number
}

const MIN_COVERAGE_RATIO = 0.85
// Consecutive chapters are allowed to touch or overlap by exactly one page
// (a boundary page legitimately described by both) -- anything wider is a
// real structural defect, not a labeling choice.
const OVERLAP_TOLERANCE_PAGES = 1
const GAP_TOLERANCE_PAGES = 2

export function verifyChapterCoverage(chapters: ChapterSuggestion[], totalPages: number): ChapterVerification {
  if (chapters.length === 0 || totalPages <= 0) {
    return { pass: false, reason: 'nessun capitolo o pagina totale non valida', coverageRatio: 0, overlapCount: 0, gapCount: 0, outOfBoundsCount: 0 }
  }

  const outOfBoundsCount = chapters.filter((c) => c.startPage < 1 || c.endPage > totalPages || c.startPage > c.endPage).length

  const sorted = [...chapters].sort((a, b) => a.startPage - b.startPage)
  let overlapCount = 0
  let gapCount = 0
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    const overlap = prev.endPage - cur.startPage + 1
    if (overlap > OVERLAP_TOLERANCE_PAGES) overlapCount++
    const gap = cur.startPage - prev.endPage - 1
    if (gap > GAP_TOLERANCE_PAGES) gapCount++
  }

  // Independent recomputation: real covered pages from the declared ranges
  // themselves (pure arithmetic), never the model's own claim about coverage.
  const coveredPages = sorted.reduce((sum, c) => sum + Math.max(0, c.endPage - c.startPage + 1), 0)
  const coverageRatio = Math.min(1, coveredPages / totalPages)

  const pass = outOfBoundsCount === 0 && overlapCount === 0 && coverageRatio >= MIN_COVERAGE_RATIO
  const reasons: string[] = []
  if (outOfBoundsCount > 0) reasons.push(`${outOfBoundsCount} capitolo/i fuori dal range reale del documento`)
  if (overlapCount > 0) reasons.push(`${overlapCount} sovrapposizione/i tra capitoli`)
  if (coverageRatio < MIN_COVERAGE_RATIO) reasons.push(`copertura reale ${(coverageRatio * 100).toFixed(0)}% (< ${MIN_COVERAGE_RATIO * 100}%)`)

  return { pass, reason: reasons.length > 0 ? reasons.join('; ') : undefined, coverageRatio, overlapCount, gapCount, outOfBoundsCount }
}
