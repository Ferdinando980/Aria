import { useEffect, useRef, useState } from 'react'
import { elementRectInPage, highlightScreenRects, textSpanAtPoint } from '../../lib/pdfHighlights'
import { cn } from '../../lib/utils'
import { Whiteboard } from './Whiteboard'
import type { Material, MaterialHighlight } from '../../lib/types'
import type { PdfDocument, PdfjsLib } from '../../lib/pdfjs'

const HIGHLIGHT_COLOR = '#fde06d' // var(--color-accent) — highlighter tone, matches the design system's existing "highlight/attention" meaning (kept in sync with index.css's 2026-08-24 accent/warn hue-separation fix)

/**
 * One page inside PdfViewer's continuous-scroll list. Owns its own canvas +
 * text layer render and its own highlighter-brush interaction -- highlights
 * are created and rendered per-page, there's no shared "current page"
 * concept anymore (see PdfViewer.tsx for why that's a deliberate change).
 */
export function PdfPage({
  pdfDoc,
  pdfjsLib,
  pageNumber,
  scale,
  estimatedHeight,
  material,
  highlights,
  highlightMode,
  highlightEraseMode,
  drawMode,
  boardVisible,
  penColor,
  eraser,
  shouldRender,
  registerEl,
  onOpenHighlight,
  addHighlight,
  removeHighlight,
}: {
  pdfDoc: PdfDocument
  pdfjsLib: PdfjsLib
  pageNumber: number
  scale: number
  /** PdfViewer's basePageHeight * scale -- the REAL on-screen height for a
   * page that hasn't rendered its own canvas yet (still assumes uniform page
   * size across the document, same as `scale` itself, see PdfViewer's
   * docstring). Two bugs fixed here on the same day (2026-08-24), both on
   * this same line: (1) an unrendered page's placeholder used to collapse to
   * ~1px tall (`pageSize.width || 1` with pageSize always {0,0} pre-render),
   * so a jump-to-chapter on a page far from the viewport landed only a few
   * pages down -- fixed once by threading a real width estimate through, but
   * (2) that first fix derived height from width via a HARDCODED US-Letter
   * aspect ratio (11/8.5 = 1.294) -- wrong for A4 (~1.414) and any other real
   * ratio, so it still under-estimated every unrendered page's height on a
   * non-Letter document (most study PDFs), still landing short on a long
   * jump, just less catastrophically. Passing the real per-document ratio
   * (basePageHeight/basePageWidth, both read from the actual first page)
   * removes the guess entirely instead of picking a better guess. */
  estimatedHeight: number
  material: Material
  highlights: MaterialHighlight[]
  highlightMode: boolean
  highlightEraseMode: boolean
  drawMode: boolean
  boardVisible: boolean
  penColor: string
  eraser: boolean
  /** Lazy-render gate driven by IntersectionObserver in PdfViewer -- once
   * true it renders and stays rendered (no teardown), see that file's notes
   * on why re-destroying pages wasn't worth the complexity here. */
  shouldRender: boolean
  registerEl: (page: number, el: HTMLDivElement | null) => void
  onOpenHighlight: (id: string, note: string | undefined) => void
  addHighlight: (h: { materialId: string; page: number; text: string; rects: MaterialHighlight['rects']; color: string }) => void
  removeHighlight: (id: string) => void
}) {
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 })
  const [renderScale, setRenderScale] = useState(scale)
  const [rendered, setRendered] = useState(false)
  const [paintedRects, setPaintedRects] = useState<{ x: number; y: number; width: number; height: number }[]>([])

  const pageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const renderGenRef = useRef(0)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const paintedSpansRef = useRef<Set<HTMLElement>>(new Set())
  const paintingRef = useRef(false)

  useEffect(() => {
    if (!shouldRender) return
    let cancelled = false
    const myGen = ++renderGenRef.current

    async function run() {
      const page = await pdfDoc.getPage(pageNumber)
      if (cancelled || myGen !== renderGenRef.current) return
      const viewport = page.getViewport({ scale })

      const canvas = canvasRef.current
      const textLayerEl = textLayerRef.current
      const pageEl = pageRef.current
      if (!canvas || !textLayerEl || !pageEl) return

      pageEl.style.width = `${viewport.width}px`
      pageEl.style.height = `${viewport.height}px`
      pageEl.style.setProperty('--scale-factor', String(scale))

      const outputScale = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const ctx = canvas.getContext('2d')!
      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
      const task = page.render({ canvas, canvasContext: ctx, viewport, transform })
      renderTaskRef.current = task
      try {
        await task.promise
      } catch {
        return // cancelled mid-render (e.g. zoom changed while this page was rendering)
      }
      if (cancelled || myGen !== renderGenRef.current) return

      textLayerEl.innerHTML = ''
      const textContent = await page.getTextContent()
      await document.fonts.ready
      if (cancelled || myGen !== renderGenRef.current) return
      const textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: textLayerEl, viewport })
      await textLayer.render()
      if (cancelled || myGen !== renderGenRef.current) return

      // Reorder the text-layer spans to match VISUAL reading order
      // (top-to-bottom, left-to-right within a row) instead of leaving them
      // in pdf.js's insertion order, which follows the PDF's internal
      // content-stream order -- on documents where that doesn't match how
      // the page actually reads (found 2026-08-20 on a numbered/indented
      // table of contents), the browser's NATIVE text selection extends
      // between two DOM positions, not two visual ones, so a small visual
      // drag could select a huge, seemingly random chunk of the page. This
      // doesn't touch pdf.js's internals or this app's own highlight brush
      // (which already hit-tests by screen position, not DOM order) -- it
      // only fixes native selection/copy-paste, by physically reordering
      // the DOM nodes to match what's on screen. appendChild on a node
      // already in the DOM moves it rather than duplicating it, so looping
      // in sorted order is enough to reorder everything in one pass.
      const spans = Array.from(textLayerEl.children) as HTMLElement[]
      const withRects = spans.map((el) => ({ el, rect: el.getBoundingClientRect() }))
      withRects.sort((a, b) => {
        const rowTolerance = Math.max(a.rect.height, b.rect.height) * 0.5
        if (Math.abs(a.rect.top - b.rect.top) > rowTolerance) return a.rect.top - b.rect.top
        return a.rect.left - b.rect.left
      })
      for (const { el } of withRects) textLayerEl.appendChild(el)

      setRenderScale(scale)
      setPageSize({ width: viewport.width, height: viewport.height })
      setRendered(true)
    }
    run().catch((err) => console.warn('[PdfPage] render failed', err))
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
    }
    // Re-render on scale change (zoom) too, not just on first becoming visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldRender, scale, pageNumber])

  // Highlighter brush -- paints whichever text-layer spans the pointer
  // physically crosses (see PdfViewer.tsx's design note: replaced an
  // earlier browser-Selection-based approach that captured unpredictably
  // more/less than what was actually dragged over on real documents).
  // A real document's PDF text often splits ONE visual line into several
  // sibling spans (e.g. a TOC's "1.3" number and "Struttura di un
  // algoritmo" title are separate text runs, unlike this app's own simple
  // test PDFs where a line happened to be one span) -- found 2026-08-20
  // from a screen recording showing the brush skipping numbered prefixes
  // while highlighting the rest of the same line. Touching any run on a
  // line now pulls in every other run at the same vertical position too,
  // so the highlight covers the whole line the pointer crossed, matching
  // what a real highlighter does.
  function siblingsOnSameLine(span: HTMLElement): HTMLElement[] {
    const textLayer = span.closest('.textLayer')
    if (!textLayer) return [span]
    const targetRect = span.getBoundingClientRect()
    const targetMidY = targetRect.top + targetRect.height / 2
    const tolerance = Math.max(2, targetRect.height * 0.4)
    return Array.from(textLayer.querySelectorAll('span')).filter((s) => {
      const r = s.getBoundingClientRect()
      return Math.abs(r.top + r.height / 2 - targetMidY) <= tolerance
    })
  }

  function paintSpanAt(clientX: number, clientY: number) {
    const span = textSpanAtPoint(clientX, clientY)
    const pageEl = pageRef.current
    if (!span || !pageEl) return
    let changed = false
    for (const s of siblingsOnSameLine(span)) {
      if (!paintedSpansRef.current.has(s)) {
        paintedSpansRef.current.add(s)
        changed = true
      }
    }
    if (changed) setPaintedRects(Array.from(paintedSpansRef.current).map((s) => elementRectInPage(s, pageEl, renderScale)))
  }

  // Erase-by-drag: hit-test whatever highlight overlay div is physically
  // under the pointer (tagged with data-highlight-id below) as it moves,
  // same drag-to-paint feel as the highlighter brush itself. Each id is
  // removed once per stroke even if the pointer crosses it again.
  const erasedThisStrokeRef = useRef<Set<string>>(new Set())

  function eraseAt(clientX: number, clientY: number) {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    const id = el?.closest<HTMLElement>('[data-highlight-id]')?.dataset.highlightId
    if (!id || erasedThisStrokeRef.current.has(id)) return
    erasedThisStrokeRef.current.add(id)
    removeHighlight(id)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!highlightMode && !highlightEraseMode) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    if (highlightEraseMode) {
      erasedThisStrokeRef.current = new Set()
      eraseAt(e.clientX, e.clientY)
      return
    }
    paintingRef.current = true
    paintedSpansRef.current = new Set()
    setPaintedRects([])
    paintSpanAt(e.clientX, e.clientY)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (highlightEraseMode) {
      e.preventDefault()
      eraseAt(e.clientX, e.clientY)
      return
    }
    if (!highlightMode || !paintingRef.current) return
    e.preventDefault()
    paintSpanAt(e.clientX, e.clientY)
  }

  function handlePointerUp() {
    if (!highlightMode || !paintingRef.current) return
    paintingRef.current = false
    const spans = Array.from(paintedSpansRef.current)
    paintedSpansRef.current = new Set()
    setPaintedRects([])
    const pageEl = pageRef.current
    if (spans.length === 0 || !pageEl) return
    spans.sort((a, b) => {
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      return ra.top - rb.top || ra.left - rb.left
    })
    const text = spans.map((s) => s.textContent ?? '').join(' ').trim()
    if (!text) return
    const rects = spans.map((s) => elementRectInPage(s, pageEl, renderScale))
    addHighlight({ materialId: material.id, page: pageNumber, text, rects, color: HIGHLIGHT_COLOR })
  }

  // Real height once this page has rendered (`pageSize.height`, from its own
  // actual pdf.js viewport) takes over from the `estimatedHeight` prop
  // (the real per-document ratio, from PdfViewer -- see that prop's comment
  // for the two bugs fixed on this exact line, same day).
  const currentEstimatedHeight = pageSize.height || estimatedHeight || undefined

  return (
    <div
      ref={(el) => {
        pageRef.current = el
        registerEl(pageNumber, el)
      }}
      data-page={pageNumber}
      className={cn('pdf-page relative mx-auto mb-4 bg-white shadow-md', highlightEraseMode && 'cursor-cell')}
      style={{ width: pageSize.width || undefined, minHeight: !rendered ? currentEstimatedHeight : undefined }}
      // Handlers live on the whole page (not just the text layer) so a
      // pointerdown that lands directly on a highlight-overlay div (which
      // stacks above the text layer, z-10) still reaches them -- needed for
      // the eraser, which hit-tests via elementFromPoint and must see that
      // div under the cursor.
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {shouldRender && (
        <>
          <canvas ref={canvasRef} className="block" />
          <div ref={textLayerRef} className={cn('textLayer', highlightMode && 'cursor-cell')} />

          {paintedRects.map((r, i) => (
            <div
              key={i}
              className="pointer-events-none absolute z-10 rounded-[2px]"
              style={{ left: r.x * renderScale, top: r.y * renderScale, width: r.width * renderScale, height: r.height * renderScale, background: HIGHLIGHT_COLOR, opacity: 0.4, mixBlendMode: 'multiply' }}
            />
          ))}

          {highlights.map((h) =>
            highlightScreenRects(h, renderScale).map((r, i) => (
              <div
                key={`${h.id}-${i}`}
                data-highlight-id={h.id}
                onClick={() => !highlightEraseMode && onOpenHighlight(h.id, h.note)}
                title={highlightEraseMode ? 'Trascina per cancellare' : h.note ? 'Ha un appunto — clic per aprirlo' : 'Clic per aggiungere un appunto'}
                className={cn('absolute z-10 rounded-[2px]', highlightEraseMode ? 'cursor-cell' : 'cursor-pointer')}
                style={{
                  left: r.left,
                  top: r.top,
                  width: r.width,
                  height: r.height,
                  background: h.color,
                  opacity: h.note ? 0.55 : 0.4,
                  mixBlendMode: 'multiply',
                  outline: h.note ? `1.5px solid ${h.color}` : 'none',
                }}
              />
            )),
          )}

          <Whiteboard material={material} page={pageNumber} active={drawMode} visible={boardVisible} color={penColor} eraser={eraser} />
        </>
      )}

      <span className="pointer-events-none absolute -left-1 top-1 -translate-x-full text-[10px] text-[var(--color-ink-muted)]">{pageNumber}</span>
    </div>
  )
}
