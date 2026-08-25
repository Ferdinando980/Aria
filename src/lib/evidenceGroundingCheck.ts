/**
 * Foundation skill pilot #7: fs_cite_before_claim (2026-08-25 — see
 * FOUNDATION_SKILLS_LOG.md). The weakest/narrowest of the batch, by design:
 * the taxonomy already flagged evidence_gathering as "caso ristretto" because
 * open-domain claim verification needs real NLP, not string matching. Scoped
 * down to the one sub-case where a coarse check has real signal instead of
 * being pure noise: NUMBERS. A specific number either appears in the source
 * text or it doesn't -- no semantic ambiguity, unlike checking whether a
 * paraphrase is "equivalent" to the source (which a substring check can't
 * tell at all). Log-only, never blocks -- explicitly the noisiest of the
 * batch, kept narrow on purpose rather than generalized to arbitrary claims.
 */

export interface GroundingCheck {
  numbersInReply: number
  numbersGrounded: number
  pass: boolean
  reason?: string
}

// Whole numbers and simple decimals, at least 2 digits -- single digits ("1
// concetto", "un capitolo") are too often incidental phrasing, not claims.
const NUMBER_PATTERN = /\b\d{2,}(?:[.,]\d+)?\b/g

export function verifyEvidenceGrounding(replyText: string, sourceText: string): GroundingCheck {
  const numbers = replyText.match(NUMBER_PATTERN) ?? []
  if (numbers.length === 0) return { numbersInReply: 0, numbersGrounded: 0, pass: true }
  const grounded = numbers.filter((n) => sourceText.includes(n))
  const pass = grounded.length === numbers.length
  return {
    numbersInReply: numbers.length,
    numbersGrounded: grounded.length,
    pass,
    reason: pass ? undefined : `${numbers.length - grounded.length}/${numbers.length} numeri citati non trovati nel testo sorgente -- possibile invenzione`,
  }
}
