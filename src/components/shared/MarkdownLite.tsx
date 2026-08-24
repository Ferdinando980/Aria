import { Fragment } from 'react'

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
 */

// Extended 2026-08-24 (roadmap: "preservare almeno corsivo... codice") --
// bold/italic/inline-code in one pass, ordered so **bold** is tried before
// single-* italic (otherwise `**x**` would split as italic-inside-italic).
// Still deliberately NOT a general markdown parser: no nested emphasis, no
// fenced code blocks, no formulas -- this app's prompts only ever ask for
// this flat subset (see the module comment above), and a token that doesn't
// match any of these four shapes is left as plain text rather than guessed at.
const INLINE_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g

function renderInline(line: string, keyPrefix: string) {
  const parts = line.split(INLINE_PATTERN).filter(Boolean)
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={key} className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      )
    }
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return <em key={key}>{part.slice(1, -1)}</em>
    }
    return <Fragment key={key}>{part}</Fragment>
  })
}

export function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n')
  const blocks: React.ReactNode[] = []
  let listBuffer: string[] = []

  function flushList(key: string) {
    if (listBuffer.length === 0) return
    blocks.push(
      <ul key={key} className="my-2 list-disc space-y-1 pl-5">
        {listBuffer.map((item, i) => (
          <li key={i}>{renderInline(item, `${key}-li-${i}`)}</li>
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
    if (line.startsWith('## ')) {
      flushList(key)
      blocks.push(
        <h3 key={key} className="mt-4 text-sm font-semibold text-[var(--color-ink)] first:mt-0">
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
        {renderInline(line, key)}
      </p>,
    )
  }
  flushList('tail')

  return <div className={className}>{blocks}</div>
}
