import { Fragment } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/**
 * Renders exactly the markdown subset this app's own prompts ask Gemini to
 * produce (gemini.ts's SUMMARY_PROMPT: "## per sotto-titoli, - per elenchi")
 * -- not a general markdown library. Real bug fix (2026-08-21, user report:
 * "il visualizzatore non prende il layout"): summaries were rendered with
 * `whitespace-pre-wrap` on the raw string, so "## Titolo" and "- punto"
 * showed up as literal characters instead of formatting. A full markdown
 * library (react-markdown, marked, ...) would be overkill for a fixed,
 * narrow, self-controlled subset -- matches this codebase's existing
 * preference for small hand-rolled renderers over a new dependency for a
 * well-defined need (see cognitive_rpg's hand-rolled inline-SVG charts).
 * Builds plain React elements, never dangerouslySetInnerHTML -- inherently
 * safe even though the input is model output, not user-authored HTML.
 *
 * EXCEPTION (2026-08-24, math): KaTeX's renderToString is the one place
 * this file uses dangerouslySetInnerHTML, deliberately -- KaTeX parses a
 * constrained LaTeX-math subset into markup, it does not execute arbitrary
 * HTML/script from its input, so the safety argument above still holds for
 * math the same way it holds for the rest: the output space is
 * structurally constrained, not attacker-controlled free-form HTML.
 * Real user report that made this necessary: raw "$T(n) \le ...$" showing
 * up as illegible literal text in a study-notes view ("le formule vanno
 * lette bene").
 */

// Extended 2026-08-24 (roadmap: "preservare almeno corsivo... codice") --
// bold/italic/inline-code/math in one pass, ordered so **bold** is tried
// before single-* italic (otherwise `**x**` would split as italic-inside-
// italic) and $$block math$$ before single-$ inline math (otherwise "$$"
// would split into two empty "$...$" matches). Still deliberately NOT a
// general markdown parser: no nested emphasis, no fenced code blocks inline
// -- this app's prompts only ever ask for this flat subset (see the module
// comment above), and a token that doesn't match any of these shapes is
// left as plain text rather than guessed at.
const INLINE_PATTERN = /(\$\$[^$]+\$\$|\$[^$]+\$|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g

// Highlighted, not just typeset (2026-08-24, real user request: "qualche
// background in piu' tipo sulle formule colorato per evidenziarle") -- a
// formula is the thing most worth an ADHD-scanning eye landing on, same
// principle as the [LABEL] callouts below, just for math specifically
// instead of a category. Block math ($$...$$) gets a full highlighted card
// (own line anyway); inline math ($...$) gets a lighter tinted pill so it
// still reads as part of the sentence around it.
function renderMath(expr: string, displayMode: boolean, key: string) {
  const html = katex.renderToString(expr, { throwOnError: false, displayMode, output: 'html' })
  if (displayMode) {
    return (
      <div
        key={key}
        className="my-3 overflow-x-auto rounded-lg border-l-4 py-3 pl-4 pr-3"
        style={{ borderColor: 'var(--color-primary)', background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }
  return (
    <span
      key={key}
      className="rounded px-1.5 py-0.5 mx-0.5"
      style={{ background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// Recursive on purpose (2026-08-24, real bug found live: "**Problema
// $\rightarrow$ Algoritmo**" rendered as a bold span with the LITERAL
// "$\rightarrow$" inside it, un-rendered). A single non-recursive pass
// stops at the first match at each position -- **bold** greedily swallows
// everything up to its closing ** (since [^*]+ doesn't exclude $), so any
// $math$ inside a bold span was captured as part of the bold text itself
// and never got a second look. Recursing into the inner text of
// bold/italic/code, not just math, so a $formula$ inside *italic* or any
// other combination gets the same treatment. Terminates safely: each
// recursive call strips the outer marker chars first, so the string handed
// to the next level is always strictly shorter.
function renderInline(line: string, keyPrefix: string): React.ReactNode[] {
  const parts = line.split(INLINE_PATTERN).filter(Boolean)
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`
    if (part.startsWith('$$') && part.endsWith('$$') && part.length > 3) return renderMath(part.slice(2, -2), true, key)
    if (part.startsWith('$') && part.endsWith('$') && part.length > 1) return renderMath(part.slice(1, -1), false, key)
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={key}>{renderInline(part.slice(2, -2), key)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      )
    }
    if ((part.startsWith('*') && part.endsWith('*') && part.length > 2) || (part.startsWith('_') && part.endsWith('_') && part.length > 2)) {
      return <em key={key}>{renderInline(part.slice(1, -1), key)}</em>
    }
    return <Fragment key={key}>{part}</Fragment>
  })
}

// Study-notes labels (2026-08-24, real user request: "etichette nei
// riassunti... come se stessi scrivendo degli appunti da cui studiare"),
// e.g. "[DEFINIZIONE] ..." or "[ESEMPIO] ..." at the start of a line/bullet
// (see gemini.ts's SUMMARY_PROMPT for the exact convention asked of the
// model). Color isn't a fixed per-word table -- a hash of the label text
// picks consistently from the theme's real accent palette, so a label word
// the prompt didn't anticipate still gets a real, stable color instead of
// falling back to plain text or a single always-the-same color for every
// label.
const LABEL_RE = /^\[([A-ZÀ-Ý][A-ZÀ-Ý\s]{1,24})\]\s*/
const LABEL_COLORS = ['var(--color-primary)', 'var(--color-calm)', 'var(--color-good)', 'var(--color-warn)', 'var(--color-accent)']

function labelColor(label: string) {
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0
  return LABEL_COLORS[hash % LABEL_COLORS.length]
}

/** Splits a line into its optional leading [LABEL] and the rendered rest --
 * null label means the line had none. Kept separate from the block wrapper
 * below so paragraphs and list items can both turn a label into a full
 * colored callout card, not just an inline chip (2026-08-24, real user
 * request: "un po' piu' cose colorate... come se stessi scrivendo degli
 * appunti da cui studiare" -- a label is a whole note category, closer to a
 * highlighter on the page than a small tag). */
function splitLabel(line: string): { label: string | null; color: string | null; rest: React.ReactNode[] } {
  const match = line.match(LABEL_RE)
  if (!match) return { label: null, color: null, rest: renderInline(line, 'l') }
  const label = match[1].trim()
  return { label, color: labelColor(label), rest: renderInline(line.slice(match[0].length), 'l') }
}

/** A labeled paragraph/list-item becomes a colored-left-border callout card
 * (label as a small caption, same color family as the border/background);
 * an unlabeled one stays a plain paragraph. `as` picks the outer tag so
 * this works both as a real <li> (kept inside <ul>, valid HTML, styled
 * directly) and as a standalone <div> wrapping a <p> for non-list lines. */
function renderCallout(line: string, key: string, as: 'li' | 'div') {
  const { label, color, rest } = splitLabel(line)
  if (!label) {
    return as === 'li' ? <li key={key}>{rest}</li> : (
      <p key={key} className="leading-relaxed">
        {rest}
      </p>
    )
  }
  const style = { borderColor: color!, background: `color-mix(in srgb, ${color} 8%, transparent)` }
  const inner = (
    <>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: color! }}>
        {label}
      </span>
      <span className="leading-relaxed">{rest}</span>
    </>
  )
  return as === 'li' ? (
    <li key={key} className="!list-none rounded-r-lg border-l-4 py-2 pl-3 pr-2 -ml-5" style={style}>
      {inner}
    </li>
  ) : (
    <div key={key} className="my-2 rounded-r-lg border-l-4 py-2 pl-3 pr-2" style={style}>
      {inner}
    </div>
  )
}

export function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n')
  const blocks: React.ReactNode[] = []
  let listBuffer: string[] = []

  function flushList(key: string) {
    if (listBuffer.length === 0) return
    blocks.push(
      <ul key={key} className="my-2 list-disc space-y-1.5 pl-5 marker:text-[var(--color-primary)]">
        {listBuffer.map((item, i) => renderCallout(item, `${key}-li-${i}`, 'li'))}
      </ul>,
    )
    listBuffer = []
  }

  // for-loop, not forEach (2026-08-24) -- fenced code blocks need to consume
  // multiple lines at once (scan ahead to the closing ```), which a forEach
  // callback can't do without its own separate state machine.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const key = `b-${i}`
    if (!line) {
      flushList(key)
      continue
    }
    if (line.startsWith('```')) {
      flushList(key)
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      blocks.push(
        <pre key={key} className="my-2 overflow-x-auto rounded-lg bg-[var(--color-surface-2)] p-3 text-xs">
          <code className="font-mono">{codeLines.join('\n')}</code>
        </pre>,
      )
      continue
    }
    // A line that's PURELY a block formula ("su una riga a sé", exactly
    // what SUMMARY_PROMPT asks for) is its own block, not a paragraph --
    // real React hydration warning found live (2026-08-24): renderMath's
    // display-mode output is a <div>, and a <div> can't be a child of <p>
    // (invalid HTML) -- happened because a whole-line "$$...$$" was still
    // being wrapped in <p> by the paragraph fallback below. Same treatment
    // as headers: bypass the paragraph/callout wrapper entirely.
    if (/^\$\$[^$]+\$\$$/.test(line)) {
      flushList(key)
      blocks.push(renderMath(line.slice(2, -2), true, key))
      continue
    }
    // Both "## " and "### " -- the model sometimes reaches for a deeper
    // level on its own (2026-08-24, found live: a real summary used "### "
    // sub-headers that this renderer didn't recognize yet, falling through
    // to a literal "### Titolo" line instead of formatting).
    if (line.startsWith('### ')) {
      flushList(key)
      blocks.push(
        <h4 key={key} className="mt-3 text-sm font-semibold text-[var(--color-ink)]">
          {renderInline(line.slice(4), key)}
        </h4>,
      )
      continue
    }
    if (line.startsWith('## ')) {
      flushList(key)
      blocks.push(
        <h3
          key={key}
          className="mt-5 border-b-2 pb-1.5 text-base font-semibold text-[var(--color-ink)] first:mt-0"
          style={{ borderColor: 'color-mix(in srgb, var(--color-primary) 35%, transparent)' }}
        >
          {renderInline(line.slice(3), key)}
        </h3>,
      )
      continue
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      listBuffer.push(line.slice(2))
      continue
    }
    flushList(key)
    blocks.push(renderCallout(line, key, 'div'))
  }
  flushList('tail')

  return <div className={className}>{blocks}</div>
}
