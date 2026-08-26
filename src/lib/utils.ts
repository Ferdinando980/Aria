import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { MaterialChapter } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function uid() {
  return crypto.randomUUID()
}

export function nowIso() {
  return new Date().toISOString()
}

/** LOCAL calendar-day string (YYYY-MM-DD), not UTC -- real bug fix
 * (2026-08-25, user report: "la sezione completati oggi, prende anche
 * quelli di ieri"). `doneAt`/"is this today" comparisons across the app
 * used `new Date().toISOString().slice(0, 10)`, which is the UTC date, not
 * the user's local one -- for a positive UTC-offset timezone (Italy is
 * UTC+1/+2), the two disagree for roughly the first two hours after local
 * midnight: a task completed at, say, 00:20 local (already "today" to the
 * user) and one completed the PREVIOUS evening at 23:00 local both land on
 * the same UTC date string during that window, so "Completati oggi" showed
 * both. Same `pad()`-based local-date construction already used in
 * Calendar.tsx's onEventDrop for the identical class of bug. Only wired
 * into Today.tsx/Progress.tsx for now (the two places the report and its
 * directly-adjacent "last 7 days" count actually surface) -- the app has
 * several other `toISOString().slice(0, 10)` call sites (study-plan
 * scheduling, streak day-boundary, flashcard/recall due dates) with the
 * same latent skew, deliberately left alone here to keep this fix scoped
 * to what was actually reported. */
export function localDateStr(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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
/** Same job as distributeAcrossDays, but weighted by real WEIGHT (minutes or
 * pages) instead of raw count (2026-08-24, "difficolta' stimata/densita'
 * concettuale" from the roadmap -- explicit instruction: "usa la difficolta'
 * che credi piu' adatta"). Chosen proxy: real page count where known
 * (chapterPageRange), the model's own per-chapter DURATA estimate otherwise
 * (see gemini.ts's STUDY_PLAN_PROMPT) -- grounded in content the model
 * actually read, not a client-side guess from page count or word count alone
 * (which conflates "long" with "hard": a long chapter of simple material and
 * a short one dense with formulas would get the same weight from a
 * length-only proxy).
 *
 * Placement is PROPORTIONAL to cumulative weight (each step's own midpoint
 * through the total workload maps to the same fraction through the
 * available days), not greedy bin-packing (2026-08-26, real bug found live:
 * "il piano di studio non si spalma nel calendario anche se ho messo una
 * data di esame"). The original greedy version filled each day up to its
 * "fair share" (total/days) before moving to the next -- fine when there are
 * MANY small steps, but for the common case of a handful of steps against a
 * long runway to the exam (e.g. 6 steps, 29 usable days), the fair share
 * (total/29) is smaller than almost any single step's weight, so the very
 * first comparison already overflows it and every step lands on its own
 * consecutive day starting from TODAY -- all 6 steps crammed into the next
 * 6 days, days 7-29 left completely empty, which reads as "not spread out"
 * even though the code never puts two steps on the same day. Proportional
 * placement fixes this: a step covering, say, the last quarter of the total
 * workload lands about three-quarters of the way to the exam regardless of
 * how few total steps there are -- e.g. those same 6 equal-weight steps land
 * on days [2, 7, 12, 16, 21, 26] of 29, actually spanning the runway.
 * Multiple steps can still legitimately share a day when there's more
 * content than days (the reverse case, where greedy bin-packing already
 * worked fine) -- this is a strict generalization, not a special case. */
export function distributeByWeight(weights: number[], days: number, startOffsetDays = 0): string[] {
  const usableDays = Math.max(1, days)
  const total = weights.reduce((a, b) => a + b, 0)
  const dates: string[] = []
  let cumulative = 0
  for (const w of weights) {
    const midpoint = cumulative + w / 2
    const fraction = total > 0 ? midpoint / total : 0
    const dayIndex = Math.min(usableDays - 1, Math.floor(fraction * usableDays))
    const date = new Date()
    date.setDate(date.getDate() + startOffsetDays + dayIndex)
    dates.push(date.toISOString().slice(0, 10))
    cumulative += w
  }
  return dates
}

/** The real page range a StudyPlanChapter was generated from, looked up in
 * the real MaterialChapter/ChapterSection it's linked to (2026-08-24, real
 * user request: "vorrei che dividesse il numero di pagine da studiare per
 * ciascuna [giornata]... oggi ho fatto 10-15 pagine, domani 20-25"). Returns
 * undefined for a chapter with no materialChapterId (the whole-material
 * fallback used when a material has no detected chapters yet, see
 * materialContent.ts's buildStudyPlanChapterInputs) or one whose linked
 * chapter/section has since been deleted -- no invented range, same
 * philosophy as dueDate staying undefined with no known exam date. */
export function chapterPageRange(
  materialChapterId: string | undefined,
  materialSectionId: string | undefined,
  allChapters: MaterialChapter[],
): { start: number; end: number } | undefined {
  if (!materialChapterId) return undefined
  const chapter = allChapters.find((c) => c.id === materialChapterId)
  if (!chapter) return undefined
  if (materialSectionId) {
    const section = chapter.subsections.find((s) => s.id === materialSectionId)
    if (section) return { start: section.startPage, end: section.endPage }
  }
  return { start: chapter.startPage, end: chapter.endPage }
}

/** Splits a chapter/section's page range into `count` contiguous
 * sub-ranges, one per study-plan step (2026-08-26, real user request: "le
 * task che vengono date nel piano di studio devono essere divise su
 * pagine... tipo studiare pagine 2-5 6-8"). Before this, every step of a
 * chapter carried the SAME whole-chapter range (see Task.pageRange's old
 * comment) -- fine for a one-step chapter, but for "pagine 2-15" split
 * across 4 daily steps it told the user nothing about which day covers
 * which pages. Split evenly by page COUNT, not by weight/difficulty (same
 * "no invented precision" reasoning as distributeAcrossDays), rounded so
 * ranges stay contiguous and gapless. Degrades to overlapping single-page
 * ranges when there are more steps than pages -- still better than the old
 * "same full range for every step" default. */
export function splitPageRange(pages: { start: number; end: number }, index: number, count: number): { start: number; end: number } {
  if (count <= 1) return pages
  const totalPages = pages.end - pages.start + 1
  const startOffset = Math.round((index / count) * totalPages)
  const endOffset = Math.round(((index + 1) / count) * totalPages) - 1
  const start = pages.start + startOffset
  const end = Math.max(start, pages.start + endOffset)
  return { start, end }
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
