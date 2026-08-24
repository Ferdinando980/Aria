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

function renderMath(expr: string, displayMode: boolean, key: string) {
  const html = katex.renderToString(expr, { throwOnError: false, displayMode, output: 'html' })
  const Tag = displayMode ? 'div' : 'span'
  return <Tag key={key} className={displayMode ? 'my-2 overflow-x-auto' : undefined} dangerouslySetInnerHTML={{ __html: html }} />
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

function renderLine(line: string, key: string) {
  const match = line.match(LABEL_RE)
  if (!match) return renderInline(line, key)
  const color = labelColor(match[1])
  const rest = line.slice(match[0].length)
  return (
    <>
      <span
        key={`${key}-label`}
        className="mr-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
        style={{ background: `color-mix(in srgb, ${color} 20%, transparent)`, color }}
      >
        {match[1].trim()}
      </span>
      {renderInline(rest, key)}
    </>
  )
}

export function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n')
  const blocks: React.ReactNode[] = []
  let listBuffer: string[] = []

  function flushList(key: string) {
    if (listBuffer.length === 0) return
    blocks.push(
      <ul key={key} className="my-2 list-disc space-y-1.5 pl-5">
        {listBuffer.map((item, i) => (
          <li key={i}>{renderLine(item, `${key}-li-${i}`)}</li>
        ))}
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
        <h3 key={key} className="mt-4 text-base font-semibold text-[var(--color-ink)] first:mt-0">
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
    blocks.push(
      <p key={key} className="leading-relaxed">
        {renderLine(line, key)}
      </p>,
    )
  }
  flushList('tail')

  return <div className={className}>{blocks}</div>
}
