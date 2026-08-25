/**
 * Foundation skill pilot #2: fs_task_decomposition_structure_check
 * (2026-08-25 — see FOUNDATION_SKILLS_LOG.md and the taxonomy artifact, §12
 * "manca lo strumento" class). Generalizes the RULE already written in
 * seed_task_breakdown_first_step ("il primo passo deve essere sotto i 2
 * minuti e senza congiunzioni") from prose the model is merely TOLD, into a
 * structural property checked by pure text parsing after the fact.
 *
 * Weaker than fs_self_verification_recompute on purpose, and honestly
 * labeled as such in the taxonomy ("caso ristretto", not "testabile ora"
 * unconditionally): task_breakdown's output is free chat text, not
 * structured JSON like chapters/formula_example, so step extraction and the
 * "e" (conjunction) check are both heuristics on natural language, not exact
 * arithmetic. This never blocks anything -- it only logs a structural
 * finding, same non-destructive posture as chapterVerification.ts's soft
 * warning path.
 */

export interface TaskDecompositionCheck {
  stepCount: number
  firstStepHasConjunction: boolean
  firstStepWordCount: number
  firstStepTooLong: boolean
  pass: boolean
  reason?: string
}

const MAX_FIRST_STEP_WORDS = 20 // rough proxy for "meccanico, sotto i 2 minuti" -- a long first step is almost never atomic, even though the reverse isn't guaranteed

// Matches "1. ", "1) ", "- ", "* " at the start of a line -- the shapes Gemini
// actually produces for a numbered/bulleted breakdown in this app's real chat
// output (verified against real replies, not assumed).
const STEP_LINE = /^\s*(?:\d+[.)]|[-*])\s+(.*)$/

export function extractSteps(replyText: string): string[] {
  return replyText
    .split('\n')
    .map((line) => line.match(STEP_LINE)?.[1]?.trim())
    .filter((s): s is string => Boolean(s && s.length > 0))
}

/** " e " as a coordinating conjunction between two clauses -- deliberately
 * conservative (real Italian has plenty of non-conjunctive " e ", e.g. names,
 * fixed phrases): only flags when " e " sits roughly in the middle of the
 * step with real content on both sides, matching the seed skill's own
 * documented anti-pattern ("fai X e Y") rather than any occurrence at all. */
function hasCoordinatingConjunction(step: string): boolean {
  const idx = step.toLowerCase().indexOf(' e ')
  if (idx === -1) return false
  const before = step.slice(0, idx).trim()
  const after = step.slice(idx + 3).trim()
  return before.split(/\s+/).length >= 2 && after.split(/\s+/).length >= 2
}

export function verifyTaskDecomposition(replyText: string): TaskDecompositionCheck {
  const steps = extractSteps(replyText)
  if (steps.length === 0) {
    return { stepCount: 0, firstStepHasConjunction: false, firstStepWordCount: 0, firstStepTooLong: false, pass: false, reason: 'nessun passo numerato/puntato riconosciuto nella risposta' }
  }
  const first = steps[0]
  const firstStepHasConjunction = hasCoordinatingConjunction(first)
  const firstStepWordCount = first.split(/\s+/).filter(Boolean).length
  const firstStepTooLong = firstStepWordCount > MAX_FIRST_STEP_WORDS

  const pass = !firstStepHasConjunction && !firstStepTooLong
  const reasons: string[] = []
  if (firstStepHasConjunction) reasons.push('il primo passo contiene una congiunzione "e" -- probabilmente due passi mascherati da uno')
  if (firstStepTooLong) reasons.push(`il primo passo ha ${firstStepWordCount} parole (> ${MAX_FIRST_STEP_WORDS}) -- probabilmente non e' atomico`)

  return { stepCount: steps.length, firstStepHasConjunction, firstStepWordCount, firstStepTooLong, pass, reason: reasons.length > 0 ? reasons.join('; ') : undefined }
}
