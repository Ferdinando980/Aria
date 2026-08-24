import { useEffect, useRef, useState } from 'react'
import { Minus, Plus, Download, Trash2, X } from 'lucide-react'
import { loadPdfjs, type PdfjsLib, type PdfDocument } from '../../lib/pdfjs'
import { useAppStore } from '../../store/useAppStore'
import { Textarea } from '../ui/Input'
import { PdfPage } from './PdfPage'
import type { Material } from '../../lib/types'

const ZOOM_MIN = 0.4
const ZOOM_MAX = 3
const ZOOM_STEP = 0.15

/**
 * Continuous-scroll PDF viewer (2026-08-20, replacing an earlier page-by-page
 * version per explicit request: "come nel visualizzatore di Google" -- all
 * pages stacked, scroll to move through the document instead of clicking
 * next/prev). Pages lazy-render once they've been scrolled near (see
 * PdfPage.tsx's `shouldRender`), driven by one IntersectionObserver here so
 * a long document doesn't render 100+ canvases on open.
 *
 * Highlighting is brush-only now (the "Evidenzia" tool) -- an earlier
 * select-text-then-confirm flow used the browser's own Selection/Range API
 * and turned out to capture unpredictably more (sometimes many unrelated
 * lines) or less than what was actually dragged over on real multi-column/
 * mixed-heading documents. The brush (paint whichever text-layer span the
 * pointer crosses, see PdfPage.tsx) doesn't have that failure mode -- it was
 * already the intentional design for touch, now it's the only path so the
 * unreliable one isn't still reachable via plain text selection.
 */
export function PdfViewer({
  material,
  fileUrl,
  drawMode,
  boardVisible,
  penColor,
  eraser,
  highlightMode,
  highlightEraseMode,
  jumpTarget,
  onPageInViewChange,
}: {
  material: Material
  fileUrl: string
  drawMode: boolean
  boardVisible: boolean
  penColor: string
  eraser: boolean
  highlightMode: boolean
  highlightEraseMode: boolean
  jumpTarget?: { page: number; nonce: number; highlightId?: string }
  /** Fires whenever the most-visible page changes (2026-08-24, chapter/section
   * skill retrieval) -- lets a parent know which chapter/section the reader
   * is currently looking at, e.g. to scope "Chiedi ad Aria" to that part of
   * the material instead of always the whole document. Optional: nothing
   * breaks for a caller that doesn't care (unchanged default behavior). */
  onPageInViewChange?: (page: number) => void
}) {
  const highlights = useAppStore((s) => s.highlights)
  const addHighlight = useAppStore((s) => s.addHighlight)
  const updateHighlightNote = useAppStore((s) => s.updateHighlightNote)
  const removeHighlight = useAppStore((s) => s.removeHighlight)

  const [pdfjsLib, setPdfjsLib] = useState<PdfjsLib | null>(null)
  const [pdfDoc, setPdfDoc] = useState<PdfDocument | null>(null)
  const [numPages, setNumPages] = useState<number | null>(null)
  const [basePageWidth, setBasePageWidth] = useState(0)
  const [basePageHeight, setBasePageHeight] = useState(0)
  const [zoomFactor, setZoomFactor] = useState(1)
  const [containerWidth, setContainerWidth] = useState(0)
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1]))
  const [currentPageInView, setCurrentPageInView] = useState(1)

  useEffect(() => {
    onPageInViewChange?.(currentPageInView)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onPageInViewChange intentionally not a dep, callers pass an inline arrow
  }, [currentPageInView])
  const [openHighlightId, setOpenHighlightId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  const scrollRef = useRef<HTMLDivElement>(null)
  const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const observerRef = useRef<IntersectionObserver | null>(null)

  const scale = containerWidth > 0 && basePageWidth > 0 ? (containerWidth / basePageWidth) * zoomFactor : 0

  // Load the document + the first page's natural size (used to derive a
  // uniform `scale` for every page -- correct for the overwhelming majority
  // of real documents, which use one page size throughout).
  useEffect(() => {
    let cancelled = false
    setPdfDoc(null)
    setNumPages(null)
    setBasePageWidth(0)
    setBasePageHeight(0)
    setVisiblePages(new Set([1]))
    setCurrentPageInView(1)
    async function load() {
      const lib = await loadPdfjs()
      if (cancelled) return
      setPdfjsLib(lib)
      const doc = await lib.getDocument({ url: fileUrl }).promise
      if (cancelled) return
      setPdfDoc(doc)
      setNumPages(doc.numPages)
      const firstPage = await doc.getPage(1)
      if (cancelled) return
      const firstViewport = firstPage.getViewport({ scale: 1 })
      setBasePageWidth(firstViewport.width)
      setBasePageHeight(firstViewport.height)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [fileUrl])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => setContainerWidth(entries[0].contentRect.width))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // One observer for the whole page list: a generous rootMargin means pages
  // start rendering just before they'd actually be scrolled into view
  // (avoids a blank flash), and once a page has been marked visible it's
  // never un-rendered again (see PdfPage's `shouldRender` prop) -- simpler
  // than tearing down/rebuilding canvases on every scroll, at the cost of
  // not reclaiming memory for pages visited earlier in a very long document.
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !numPages) return
    const obs = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          let changed = false
          const next = new Set(prev)
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.page)
            if (entry.isIntersecting && !next.has(page)) {
              next.add(page)
              changed = true
            }
          }
          return changed ? next : prev
        })
        const mostVisible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (mostVisible) setCurrentPageInView(Number((mostVisible.target as HTMLElement).dataset.page))
      },
      { root, rootMargin: '1000px 0px 1000px 0px', threshold: [0, 0.5, 1] },
    )
    observerRef.current = obs
    for (const el of pageElsRef.current.values()) obs.observe(el)
    return () => obs.disconnect()
  }, [numPages])

  function registerEl(page: number, el: HTMLDivElement | null) {
    if (el) {
      pageElsRef.current.set(page, el)
      observerRef.current?.observe(el)
    } else {
      const existing = pageElsRef.current.get(page)
      if (existing) observerRef.current?.unobserve(existing)
      pageElsRef.current.delete(page)
    }
  }

  // Jump-to-page from the "collegamenti"/Capitoli lists — nonce so the same
  // page can be re-selected twice in a row and still trigger a scroll.
  useEffect(() => {
    if (!jumpTarget) return
    const el = pageElsRef.current.get(jumpTarget.page)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    if (jumpTarget.highlightId) {
      const h = highlights.find((x) => x.id === jumpTarget.highlightId)
      if (h) {
        setOpenHighlightId(h.id)
        setNoteDraft(h.note ?? '')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget?.nonce])

  function openHighlight(id: string, note: string | undefined) {
    setOpenHighlightId(id)
    setNoteDraft(note ?? '')
  }

  function saveNote() {
    if (!openHighlightId) return
    updateHighlightNote(openHighlightId, noteDraft.trim())
  }

  const highlightsByPage = new Map<number, typeof highlights>()
  for (const h of highlights) {
    if (h.materialId !== material.id) continue
    const list = highlightsByPage.get(h.page) ?? []
    list.push(h)
    highlightsByPage.set(h.page, list)
  }
  const openHighlightData = openHighlightId ? highlights.find((h) => h.id === openHighlightId) : null

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--color-surface-2)] px-2 py-1.5 text-xs">
        <span className="min-w-[3.5rem] pl-1 tabular-nums text-[var(--color-ink-muted)]">
          {currentPageInView} / {numPages ?? '…'}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setZoomFactor((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))} className="rounded-lg p-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            <Minus size={14} />
          </button>
          <span className="min-w-[2.75rem] text-center tabular-nums">{Math.round(zoomFactor * 100)}%</span>
          <button onClick={() => setZoomFactor((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))} className="rounded-lg p-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            <Plus size={14} />
          </button>
          <a href={fileUrl} download={material.fileName} className="rounded-lg p-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" title="Scarica">
            <Download size={14} />
          </a>
        </div>
      </div>

      {openHighlightData && (
        <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 flex-1 text-xs italic text-[var(--color-ink-muted)]">"{openHighlightData.text}"</p>
            <button onClick={() => setOpenHighlightId(null)} className="shrink-0 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
              <X size={14} />
            </button>
          </div>
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={saveNote}
            rows={3}
            placeholder="Aggiungi un appunto su questo punto..."
            className="text-sm"
          />
          <div className="flex justify-end">
            <button
              onClick={() => {
                removeHighlight(openHighlightData.id)
                setOpenHighlightId(null)
              }}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--color-warn)] hover:bg-[var(--color-warn)]/10"
            >
              <Trash2 size={12} /> Rimuovi evidenziazione
            </button>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] py-3">
        {pdfjsLib && pdfDoc && scale > 0 && numPages
          ? Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
              <PdfPage
                key={n}
                pdfDoc={pdfDoc}
                pdfjsLib={pdfjsLib}
                pageNumber={n}
                scale={scale}
                estimatedHeight={basePageHeight * scale}
                material={material}
                highlights={highlightsByPage.get(n) ?? []}
                highlightMode={highlightMode}
                highlightEraseMode={highlightEraseMode}
                drawMode={drawMode}
                boardVisible={boardVisible}
                penColor={penColor}
                eraser={eraser}
                shouldRender={visiblePages.has(n)}
                registerEl={registerEl}
                onOpenHighlight={openHighlight}
                addHighlight={addHighlight}
                removeHighlight={removeHighlight}
              />
            ))
          : null}
      </div>
    </div>
  )
}
