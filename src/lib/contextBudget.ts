import { skillsAsPromptContext } from './skills'
import type { Skill } from './types'

/**
 * Mirror of cognitive_rpg/librarian/context_budget.py, ported the same day
 * (2026-08-21) for the same reason: a hard ceiling on how much context one
 * call may consume, independent of routeSkills()'s relevance scoring.
 * routeSkills() only sees the skills it found -- it has no idea how big the
 * REST of the request (system prompt, chat history, material content) already
 * is. That's why this lives where callers assemble the final request (the
 * four routeSkills() call sites: Assistant.tsx, MaterialAskPanel.tsx,
 * StudyPlanPanel.tsx, MaterialPlanPanel.tsx), not inside routeSkills() itself.
 *
 * Same two-step separation as the Python original: base content over budget
 * (nothing to do with skills) is reported differently from skills not fitting
 * in what's left. Same whole-skill-drop rule (never truncate mid-text -- a
 * skill's content is short and dense enough already, at most MAX_DISTILLED_
 * WORDS=60, that cutting it mid-sentence is worse than dropping it). Same
 * relevance-ordered prefix-kept/suffix-dropped rule (routeSkills() already
 * returns skills sorted most-relevant-first).
 *
 * One deliberate difference from the Python side: token counts here are
 * ESTIMATED (chars/4), not measured via a real countTokens() call. The Python
 * adapters already pay for real token counting as part of existing cost
 * tracking, so measuring was free there. Aria has no such infra, and adding a
 * blocking Gemini API round-trip before every single chat/plan call to get an
 * exact count would add real latency to a live UI -- for a user whose #1
 * design requirement (see CLAUDE.md) is immediate feedback, that tradeoff is
 * backwards for a risk this codebase's own current numbers put at "near
 * zero" (skills capped at 60 words, gemini-3.6-flash's context window in the
 * hundreds of thousands of tokens). An estimate is precise enough for a
 * coarse ceiling meant to catch a genuine runaway, not to be exact.
 */

// Same model->window table as context_budget.py, Aria-relevant subset only.
// gemini-3.6-flash (the model Aria actually calls, see GEMINI_MODEL in
// gemini.ts) is NOT covered by any skill available in this project (same gap
// noted in CLAUDE.md's own warning about Gemini model names/behavior
// changing under us) -- verified instead via WebFetch against the live
// official docs (ai.google.dev/gemini-api/docs/models/gemini-3.6-flash) on
// 2026-08-21, input token limit field, exact figure. This mattered concretely
// here: the first version of this table was a guessed round number (1,000,000)
// never checked against the real docs -- caught the same day a companion
// review pointed out the equivalent guess on the Python side was flat-out
// wrong for the model actually configured there. Falls back to
// FALLBACK_CONTEXT_WINDOW_TOKENS for any other id.
const CONTEXT_WINDOW_TOKENS: Record<string, number> = {
  'gemini-3.6-flash': 1_048_576, // verified 2026-08-21, ai.google.dev -- kept for any log/event still referencing this now-superseded pin
  // 2026-08-24: GEMINI_MODEL bumped 3.6 -> 3.7 (gemini.ts). Verified via a
  // real models.list() call (see gemini.ts's GEMINI_MODEL comment) that
  // 3.7-flash reports the identical 1,048,576 input token limit -- without
  // this entry, the lookup below for the NOW-active model would silently
  // miss and fall through to FALLBACK_CONTEXT_WINDOW_TOKENS (128,000),
  // under-budgeting real calls by 8x for no real reason.
  'gemini-3.7-flash': 1_048_576, // verified 2026-08-24, models.list() with the user's own key
}
// Deliberately conservative for any unrecognized model id -- confirmed the
// right direction (not just asserted): gemini-3.6-flash's real window
// (1,048,576, verified above) is well above this fallback, so hitting it
// under-budgets rather than over-budgets.
const FALLBACK_CONTEXT_WINDOW_TOKENS = 128_000

// Same rationale and same value as context_budget.py's CONTEXT_BUDGET_FRACTION
// -- not derived from a measurement, headroom for output + safety margin,
// named and commented rather than a bare number in a comparison.
const CONTEXT_BUDGET_FRACTION = 0.8

export function contextBudgetFor(model: string): number {
  const window = CONTEXT_WINDOW_TOKENS[model] ?? FALLBACK_CONTEXT_WINDOW_TOKENS
  return Math.floor(window * CONTEXT_BUDGET_FRACTION)
}

/** chars/4 is the standard rough estimate for English; Italian runs slightly
 * denser but not enough to change any real decision at this app's actual
 * content sizes (skills capped at 60 words, chat/material text far below the
 * hundreds-of-thousands-of-tokens budget) -- see the module doc for why an
 * estimate, not a real countTokens() call, is the right tradeoff here. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export interface BudgetedSkills {
  skills: Skill[]
  baseOverBudget: boolean
  droppedSkillIds: string[]
}

/**
 * baseText: everything else that will occupy the request alongside the skill
 * context (system prompt is fixed/small and not included -- callers pass
 * whatever variable content they already have in scope: chat history,
 * material content, materials summary). Not exact, same estimate tradeoff as
 * estimateTokens() -- see module doc.
 */
export function enforceSkillBudget(baseText: string, skills: Skill[], model: string): BudgetedSkills {
  const budget = contextBudgetFor(model)
  const baseTokens = estimateTokens(baseText)

  if (baseTokens > budget) {
    return { skills: [], baseOverBudget: true, droppedSkillIds: skills.map((s) => s.id) }
  }
  if (skills.length === 0) {
    return { skills, baseOverBudget: false, droppedSkillIds: [] }
  }

  const kept: Skill[] = []
  let dropped: string[] = []
  for (let i = 0; i < skills.length; i++) {
    const candidate = [...kept, skills[i]]
    const candidateTokens = estimateTokens(skillsAsPromptContext(candidate))
    if (baseTokens + candidateTokens > budget) {
      dropped = skills.slice(i).map((s) => s.id)
      break
    }
    kept.push(skills[i])
  }

  return { skills: kept, baseOverBudget: false, droppedSkillIds: dropped }
}
