import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function uid() {
  return crypto.randomUUID()
}

export function nowIso() {
  return new Date().toISOString()
}

/** Black or white, whichever reads better on `hexColor` -- relative
 * luminance (WCAG's own formula, sRGB gamma-corrected, not a plain RGB
 * average which gets bright yellows/ambers wrong). Fixes a real bug
 * (2026-08-21, user report: "i tag non funzionano benissimo, di colore"):
 * every place a Subject's color was used as a background hardcoded white
 * text on top of it, unreadable on the lighter colors in SubjectDialog.tsx's
 * palette (amber #FDCB6E, mint #55EFC4, light blue #74B9FF, peach #FAB1A0) --
 * confirmed visually on a real calendar event chip before fixing. Falls
 * back to white on a malformed color rather than throwing -- a subject's
 * color is free-text-adjacent (picked from a fixed palette today, but nothing
 * enforces that at the type level) and a broken swatch must never crash a
 * render. */
export function contrastTextColor(hexColor: string): '#000000' | '#ffffff' {
  const hex = hexColor.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '#ffffff'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
  // WCAG contrast ratio of white text (luminance 1) vs black text (luminance
  // 0) against this background, pick whichever clears the higher bar --
  // equivalent to the standard 0.179 luminance threshold, written this way
  // so the formula's origin (WCAG's own contrast-ratio definition) stays visible.
  const contrastWithWhite = (1.05) / (luminance + 0.05)
  const contrastWithBlack = (luminance + 0.05) / 0.05
  return contrastWithWhite >= contrastWithBlack ? '#ffffff' : '#000000'
}

/** Nearest upcoming (or today's) 'esame' calendar event for a subject --
 * shared lookup, extracted 2026-08-24 so daysUntilNextExam and the study
 * plan panels' "vedi/cambia data esame" UI (real user report: "non vedo
 * modo di decidere la data" -- the date-picker prompt only ever showed
 * ONCE, when no date existed yet; once set, there was no visible way to see
 * or change it) read the exact same real event instead of two separate
 * implementations of "which one counts as next" that could quietly drift
 * apart. Undefined when there's no exam event at all. */
export function nextExamEvent<T extends { subjectId?: string; start: string; type?: 'evento' | 'esame' }>(events: T[], subjectId: string): T | undefined {
  const now = Date.now()
  const candidates = events
    .filter((e) => e.subjectId === subjectId && e.type === 'esame')
    .map((e) => ({ e, t: new Date(e.start).getTime() }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t)
  const upcoming = candidates.find((x) => x.t >= now - 86400000)
  return (upcoming ?? candidates[candidates.length - 1])?.e
}

/** Nearest upcoming (or today's) 'esame' calendar event for a subject, in
 * whole days from now -- undefined when there's no exam date set, which
 * callers must treat as "don't mention a deadline" rather than assuming 0. */
export function daysUntilNextExam(events: { subjectId?: string; start: string; type?: 'evento' | 'esame' }[], subjectId: string): number | undefined {
  const event = nextExamEvent(events, subjectId)
  if (!event) return undefined
  return Math.ceil((new Date(event.start).getTime() - Date.now()) / 86400000)
}

/** Spreads `count` items evenly across `days` days starting `startOffsetDays`
 * from today, returning one ISO date (YYYY-MM-DD) per item in order
 * (2026-08-24, study-plan day-by-day scheduling). Pure linear distribution,
 * no weighting by estimated difficulty/density -- deliberately simple: the
 * roadmap's own "densità concettuale" idea needs a real signal to weight by
 * that doesn't exist yet (no per-step time/difficulty estimate anywhere in
 * this codebase), so guessing weights now would be inventing precision this
 * data can't support. `days` < 1 (exam today/passed) collapses everything
 * onto today rather than producing a negative or empty range. */
/** Same job as distributeAcrossDays, but bin-packed by real WEIGHT (minutes)
 * instead of raw count (2026-08-24, "difficolta' stimata/densita'
 * concettuale" from the roadmap -- explicit instruction: "usa la difficolta'
 * che credi piu' adatta"). Chosen proxy: the model's own per-chapter DURATA
 * estimate (see gemini.ts's STUDY_PLAN_PROMPT), spread evenly across a
 * chapter's steps -- grounded in content the model actually read, not a
 * client-side guess from page count or word count alone (which conflates
 * "long" with "hard": a long chapter of simple material and a short one
 * dense with formulas would get the same weight from a length-only proxy).
 * Greedy bin-pack: fill each day up to its fair share (total/days) before
 * moving to the next, capped at the last available day so nothing ever
 * lands after the exam. */
export function distributeByWeight(weights: number[], days: number, startOffsetDays = 0): string[] {
  const usableDays = Math.max(1, days)
  const total = weights.reduce((a, b) => a + b, 0)
  const perDay = total > 0 ? total / usableDays : 1
  const dates: string[] = []
  let dayIndex = 0
  let dayLoad = 0
  for (const w of weights) {
    if (dayLoad > 0 && dayLoad + w > perDay && dayIndex < usableDays - 1) {
      dayIndex++
      dayLoad = 0
    }
    const date = new Date()
    date.setDate(date.getDate() + startOffsetDays + dayIndex)
    dates.push(date.toISOString().slice(0, 10))
    dayLoad += w
  }
  return dates
}

export function distributeAcrossDays(count: number, days: number, startOffsetDays = 0): string[] {
  const usableDays = Math.max(1, days)
  const perDay = Math.max(1, Math.ceil(count / usableDays))
  const dates: string[] = []
  for (let i = 0; i < count; i++) {
    const dayIndex = Math.floor(i / perDay)
    const date = new Date()
    date.setDate(date.getDate() + startOffsetDays + dayIndex)
    dates.push(date.toISOString().slice(0, 10))
  }
  return dates
}
