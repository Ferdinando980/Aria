import { useEffect, useRef, useState } from 'react'
import { uid } from '../../lib/utils'

/**
 * Renders a ```mermaid fenced block from Gemini's own output as a real
 * diagram (2026-08-26, real user request: Cheat Study exercises/
 * explanations involving a figure -- a tree, a graph, a flowchart -- had no
 * way to show one. Real image generation needs a Gemini model outside the
 * free tier (verified live: `limit: 0` on the free tier for every image
 * model, not just exhausted quota) -- Mermaid is the free alternative:
 * same already-working TEXT model describes the structure, this renders it
 * client-side, zero extra API cost. Lazy-imported (not a top-level import)
 * so the ~250KB library only loads for someone who actually opens a screen
 * with a diagram on it, not every Cheat Study/Riassunti visitor.
 */

let mermaidInitialized = false

async function getMermaid() {
  const mod = await import('mermaid')
  const mermaid = mod.default
  if (!mermaidInitialized) {
    // Same dark palette as the rest of the app (index.css) -- this app has
    // no light theme to branch on, so a single fixed themeVariables set
    // (not mermaid's own 'dark' base theme, which doesn't match these
    // exact tones) keeps a diagram from looking like a mismatched pasted-in
    // widget.
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        background: '#171a21',
        primaryColor: '#1f232c',
        primaryTextColor: '#f2f2f7',
        primaryBorderColor: '#6c5ce7',
        lineColor: '#9aa0ac',
        secondaryColor: '#1f232c',
        tertiaryColor: '#1f232c',
        fontFamily: 'var(--font-sans)',
      },
    })
    mermaidInitialized = true
  }
  return mermaid
}

export function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const idRef = useRef(`mermaid-${uid()}`)

  useEffect(() => {
    let cancelled = false
    setSvg(null)
    setError(false)
    getMermaid()
      .then((mermaid) => mermaid.render(idRef.current, code))
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg)
      })
      .catch(() => {
        // Honest fallback, not a crash -- same "disclose, don't fake"
        // pattern as FormulaExamplePanel's unverified-example note: a
        // figure the model described in a way Mermaid can't parse still
        // shows the raw description instead of breaking the whole card.
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  if (error) {
    return (
      <div className="my-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-warn)]">Figura non renderizzabile</p>
        <pre className="overflow-x-auto text-xs text-[var(--color-ink-muted)]">
          <code>{code}</code>
        </pre>
      </div>
    )
  }

  if (!svg) {
    return <div className="my-2 h-24 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
  }

  return <div className="my-2 overflow-x-auto rounded-lg bg-[var(--color-surface-2)] p-3" dangerouslySetInnerHTML={{ __html: svg }} />
}
