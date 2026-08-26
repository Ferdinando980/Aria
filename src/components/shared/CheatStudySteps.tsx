import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MarkdownLite } from './MarkdownLite'
import { RichBlock } from './RichBlock'
import { cn } from '../../lib/utils'

/**
 * Renders Cheat Study's Spiegazione/Esercizio equivalente/Esercizi di base
 * output as digestible chunks instead of one long scroll (2026-08-26, real
 * user report: "esce uno spiegone a destra" -- a real generated explanation
 * was one continuous run of [PASSO] callouts, screenshot-verified live
 * before writing this). MarkdownLite itself is untouched -- this wraps it
 * (via RichBlock, which also opts in [SCELTA] multiple-choice cards and
 * [BLOCCHI] place-value visuals when the model emits them), splitting the
 * SAME text it would already render into pieces, so every existing
 * consumer of MarkdownLite (Riassunti, Flashcards, ...) is unaffected.
 *
 * Two independent groupings, chosen by what the text actually contains:
 * - [PASSO] segments render as an always-visible numbered Timeline (real
 *   user mockup: "la spiegazione è una timeline numerata invece di un
 *   blocco di testo") -- every step visible, just visually separated, not
 *   gated behind navigation.
 * - Multiple "## " headers (the prerequisite ladder's "## Esercizio base N",
 *   one per mini-exercise) -> the SECTIONS page through a StepNav, one
 *   exercise visible at a time -- kept paginated on purpose, a genuinely
 *   different shape (separate mini-exercises, not a sequential narrative).
 *   A single "## " header (Esercizio equivalente's "## Soluzione") just
 *   renders inline instead, no nav needed for one section.
 */

const LABEL_LINE_RE = /^\[([A-ZÀ-Ý][A-ZÀ-Ý\s]{1,24})\]/
const HEADER_LINE_RE = /^##\s+(.*)$/

interface Segment {
  label: string | null
  lines: string[]
}

function splitLabelSegments(lines: string[]): Segment[] {
  const segments: Segment[] = []
  for (const line of lines) {
    const m = line.match(LABEL_LINE_RE)
    // FIGURA/FORMULA are illustrative asides ATTACHED to the passage that
    // introduced them (a diagram/equation for the step just described), not
    // navigation stops of their own -- stepping "past" the step would hide
    // the very thing it's illustrating. Merged into the previous segment
    // instead of starting a new one.
    if (m && (m[1] === 'FIGURA' || m[1] === 'FORMULA') && segments.length > 0) {
      segments[segments.length - 1].lines.push(line)
      continue
    }
    if (m) {
      segments.push({ label: m[1].trim(), lines: [line] })
    } else if (segments.length > 0) {
      segments[segments.length - 1].lines.push(line)
    } else {
      segments.push({ label: null, lines: [line] })
    }
  }
  return segments
}

function joinSegments(segs: Segment[]): string {
  return segs
    .map((s) => s.lines.join('\n'))
    .join('\n\n')
    .trim()
}

function splitSteps(body: string): { before: string; steps: string[]; after: string } {
  const segments = splitLabelSegments(body.split('\n'))
  const firstStepIdx = segments.findIndex((s) => s.label === 'PASSO')
  if (firstStepIdx === -1) return { before: body.trim(), steps: [], after: '' }
  let lastStepIdx = firstStepIdx
  for (let i = firstStepIdx; i < segments.length; i++) if (segments[i].label === 'PASSO') lastStepIdx = i
  // Any non-PASSO segment caught between the first and last PASSO (should be
  // rare -- the prompts ask for RAGIONAMENTO before, RISULTATO/ATTENZIONE
  // after -- but never silently dropped if the model doesn't follow that
  // order exactly) attaches to the step right before it, same reasoning as
  // FIGURA/FORMULA above, just applied defensively at the step-grouping
  // level too.
  const steps: string[] = []
  for (const seg of segments.slice(firstStepIdx, lastStepIdx + 1)) {
    if (seg.label === 'PASSO' || steps.length === 0) steps.push(seg.lines.join('\n'))
    else steps[steps.length - 1] += '\n\n' + seg.lines.join('\n')
  }
  return {
    before: joinSegments(segments.slice(0, firstStepIdx)),
    steps,
    after: joinSegments(segments.slice(lastStepIdx + 1)),
  }
}

interface Section {
  header: string | null
  body: string
}

function splitSections(text: string): Section[] {
  const lines = text.split('\n')
  const raw: { header: string | null; lines: string[] }[] = [{ header: null, lines: [] }]
  for (const line of lines) {
    const m = line.match(HEADER_LINE_RE)
    if (m) raw.push({ header: m[1].trim(), lines: [] })
    else raw[raw.length - 1].lines.push(line)
  }
  return raw.map((s) => ({ header: s.header, body: s.lines.join('\n').trim() })).filter((s) => s.header !== null || s.body.length > 0)
}

/** Small numbered-pill + prev/next nav, shared by both stepping levels
 * (section ladder, [PASSO] list) -- same control, different content. */
function StepNav({ count, active, onChange, itemLabel }: { count: number; active: number; onChange: (i: number) => void; itemLabel: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <button
        onClick={() => onChange(Math.max(0, active - 1))}
        disabled={active === 0}
        className="rounded-full p-1 text-[var(--color-ink-muted)] hover:text-[var(--color-primary)] disabled:opacity-30"
        aria-label="Precedente"
      >
        <ChevronLeft size={16} />
      </button>
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            onClick={() => onChange(i)}
            title={`${itemLabel} ${i + 1}`}
            className={cn(
              'flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold',
              i === active ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <button
        onClick={() => onChange(Math.min(count - 1, active + 1))}
        disabled={active === count - 1}
        className="rounded-full p-1 text-[var(--color-ink-muted)] hover:text-[var(--color-primary)] disabled:opacity-30"
        aria-label="Successivo"
      >
        <ChevronRight size={16} />
      </button>
      <span className="ml-1 text-[11px] text-[var(--color-ink-muted)]">
        {itemLabel} {active + 1} di {count}
      </span>
    </div>
  )
}

/** Numbered timeline, all steps visible at once (2026-08-26, real user
 * mockup: "la spiegazione è una timeline numerata invece di un blocco di
 * testo") -- replaces an earlier one-step-at-a-time nav for this specific
 * level (see the section-level StepNav above, kept as-is for the
 * prerequisite ladder, a genuinely different shape: separate mini-exercises
 * to page through, not a sequential narrative to read start to finish). A
 * numbered circle + connecting line reads as "steps in order" without
 * hiding any of them behind a click, closer to what a wall of [PASSO]
 * callouts was missing in the first place -- just visual separation, not
 * navigation friction. */
function Timeline({ steps }: { steps: string[] }) {
  return (
    <div className="my-2">
      {steps.map((step, i) => (
        <div key={i} className="relative flex gap-3 pb-5 last:pb-0">
          {i < steps.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-px bg-[var(--color-border)]" />}
          <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-xs font-bold text-white">{i + 1}</span>
          <div className="min-w-0 flex-1 pt-0.5">
            <RichBlock text={step} />
          </div>
        </div>
      ))}
    </div>
  )
}

function SectionBody({ header, body }: { header?: string | null; body: string }) {
  const { before, steps, after } = splitSteps(body)
  return (
    <div>
      {header && <MarkdownLite text={`## ${header}`} />}
      {before && <RichBlock text={before} />}
      {steps.length > 0 && <Timeline steps={steps} />}
      {after && <RichBlock text={after} />}
    </div>
  )
}

export function CheatStudySteps({ text }: { text: string }) {
  const sections = splitSections(text)
  const [active, setActive] = useState(0)
  if (sections.length === 0) return null

  const leading = sections[0].header === null ? sections[0] : null
  const headed = leading ? sections.slice(1) : sections

  return (
    <div>
      {leading && <SectionBody body={leading.body} />}
      {headed.length === 1 && <SectionBody header={headed[0].header} body={headed[0].body} />}
      {headed.length >= 2 && (
        <div className="my-2">
          <StepNav count={headed.length} active={Math.min(active, headed.length - 1)} onChange={setActive} itemLabel="Esercizio" />
          <SectionBody header={headed[Math.min(active, headed.length - 1)].header} body={headed[Math.min(active, headed.length - 1)].body} />
        </div>
      )}
    </div>
  )
}
