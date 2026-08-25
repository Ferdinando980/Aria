import type { ChapterSuggestion } from './gemini'

/**
 * Foundation skill pilot #5: fs_contradiction_check (2026-08-25 — see
 * FOUNDATION_SKILLS_LOG.md). generateChapters()'s continuation prompt
 * (gemini.ts) explicitly TELLS the model a fact it must not contradict: "le
 * pagine 1-N sono gia' state divise... il primo capitolo qui deve iniziare a
 * pagina N+1". This checks whether the model's own next output actually
 * respects the fact it was just given -- an independently known prior state
 * (lastEndPage, computed from the app's own data, never from the model),
 * compared against the model's new claim. Real contradiction detection, not
 * a synthetic constructed case: this is the ONE place in the real codebase
 * where the model is handed a fact and asked to build on it without
 * repeating it wholesale, so a violation here IS a genuine contradiction, not
 * a coincidence of a made-up test.
 *
 * Log-only: a violation is auto-corrected already by generateChapters()'s
 * existing clamp (Math.max(1, ...)), so this doesn't change behavior --  it
 * makes a silent clamp VISIBLE as a real contradiction event instead of an
 * invisible one, which is the whole point (see chapterVerification.ts's
 * comment on the same clamp for the parallel).
 */

export interface ContradictionCheck {
  contradicted: boolean
  pass: boolean
  reason?: string
}

export function verifyNoContradiction(newChapters: ChapterSuggestion[], priorLastEndPage: number): ContradictionCheck {
  if (newChapters.length === 0) return { contradicted: false, pass: true }
  const first = newChapters[0]
  const contradicted = first.startPage <= priorLastEndPage
  return {
    contradicted,
    pass: !contradicted,
    reason: contradicted
      ? `il nuovo primo capitolo inizia a pagina ${first.startPage}, ma il capitolo precedente arrivava fino a pagina ${priorLastEndPage} -- il modello ha ignorato il vincolo dato`
      : undefined,
  }
}
