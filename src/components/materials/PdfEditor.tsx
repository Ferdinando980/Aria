import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Trash2, Loader2, Save, Plus, Minus, ChevronLeft, ChevronRight, FileEdit, MousePointerClick, ListChecks } from 'lucide-react'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Input'
import { useAppStore } from '../../store/useAppStore'
import { useToastStore } from '../../store/toastStore'
import { useReplaceMaterialFile } from '../../lib/useReplaceMaterialFile'
import { loadPdfjs, type PdfjsLib, type PdfDocument } from '../../lib/pdfjs'
import { elementRectInPage, textSpanAtPoint } from '../../lib/pdfHighlights'
import type { TextEditStyleHint } from '../../lib/pdfExport'
import { cn } from '../../lib/utils'
import type { Material, TextEdit } from '../../lib/types'

// Below this drag distance (render-scale px) a pointer-down/up is treated as
// a click (edit/select whatever's under it), not an attempt to draw a new box.
const DRAG_THRESHOLD = 4
const MIN_NEW_BOX = 10

/**
 * Dedicated full-screen PDF text editor, replacing the old inline
 * click-a-span-in-the-viewer flow (2026-08-20, per explicit user request:
 * "sto editor pdf non mi piace... usami tutto quello che ha pdf.lib", then
 * "migliorami l'aspetto... impara da come fanno le altre librerie" the same
 * day). Two ways to place a correction: click an existing text run to cover
 * + replace it (its bold/italic/serif style is sampled so the replacement
 * matches instead of always landing in plain Helvetica), or drag on empty
 * space to place new text anywhere. "Salva nel file" runs the real pdf-lib
 * export (see pdfExport.ts) and overwrites the material's actual stored
 * file -- the viewer no longer carries its own live edit-preview overlay,
 * since a saved correction is now just normal PDF content the ordinary
 * viewer already renders.
 */
export function PdfEditor({
  material,
  fileUrl,
  open,
  onOpenChange,
  onSaved,
}: {
  material: Material
  fileUrl: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (newFileUrl: string) => void
}) {
  const allTextEdits = useAppStore((s) => s.textEdits)
  const setTextEdit = useAppStore((s) => s.setTextEdit)
  const removeTextEdit = useAppStore((s) => s.removeTextEdit)
  const push = useToastStore((s) => s.push)
  const replaceMaterialFile = useReplaceMaterialFile()

  const edits = useMemo(() => allTextEdits.filter((t) => t.materialId === material.id), [allTextEdits, material.id])

  const [pdfjsLib, setPdfjsLib] = useState<PdfjsLib | null>(null)
  const [pdfDoc, setPdfDoc] = useState<PdfDocument | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [renderScale, setRenderScale] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftValue, setDraftValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [dragRect, setDragRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)

  const pageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  // Sampled from the original span's computed style at the moment a
  // correction is created -- not persisted (the TextEdit records themselves
  // are transient staging data, deleted the moment they're baked into the
  // file), just carried through to the export call so the replacement text
  // picks a matching standard font instead of always plain Helvetica.
  const styleHintsRef = useRef<Map<string, TextEditStyleHint>>(new Map())

  useEffect(() => {
    if (!open) return
    setPageNumber(1)
    setSelectedId(null)
  }, [open, material.id])

  useEffect(() => {
    if (!open || !fileUrl) return
    const url = fileUrl
    let cancelled = false
    async function load() {
      const lib = await loadPdfjs()
      if (cancelled) return
      setPdfjsLib(lib)
      const doc = await lib.getDocument({ url }).promise
      if (cancelled) return
      setPdfDoc(doc)
      setNumPages(doc.numPages)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, fileUrl])

  // Single-page, fit-to-panel render: same canvas + text-layer technique
  // PdfPage.tsx uses for viewing, just one page at a time (an editing
  // session benefits more from a bigger, focused page than from scroll).
  useEffect(() => {
    if (!open || !pdfDoc || !pdfjsLib) return
    const doc = pdfDoc
    const lib = pdfjsLib
    let cancelled = false
    async function run() {
      const page = await doc.getPage(pageNumber)
      if (cancelled) return
      const container = pageRef.current?.parentElement
      const containerWidth = container && container.clientWidth > 0 ? container.clientWidth - 32 : 800
      const naturalWidth = page.getViewport({ scale: 1 }).width
      const scale = Math.min(1.6, containerWidth / naturalWidth)
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
      await page.render({ canvas, canvasContext: ctx, viewport, transform }).promise
      if (cancelled) return

      textLayerEl.innerHTML = ''
      const textContent = await page.getTextContent()
      await document.fonts.ready
      if (cancelled) return
      const textLayer = new lib.TextLayer({ textContentSource: textContent, container: textLayerEl, viewport })
      await textLayer.render()
      if (cancelled) return

      setRenderScale(scale)
    }
    run().catch((err) => console.warn('[PdfEditor] render failed', err))
    return () => {
      cancelled = true
    }
  }, [open, pdfDoc, pdfjsLib, pageNumber])

  const pageEdits = edits.filter((e) => e.page === pageNumber)

  function selectExisting(edit: TextEdit) {
    setSelectedId(edit.id)
    setDraftValue(edit.replacement)
    if (edit.page !== pageNumber) setPageNumber(edit.page)
  }

  function findEditNear(page: number, rect: { x: number; y: number }) {
    return useAppStore.getState().textEdits.find(
      (t) => t.materialId === material.id && t.page === page && Math.abs(t.x - rect.x) < 1 && Math.abs(t.y - rect.y) < 1,
    )
  }

  /** Reads the original text run's weight/style/family off the live DOM
   * span pdf.js already sized to match the underlying glyphs -- a cheap,
   * good-enough proxy for "was this bold/italic/serif in the source PDF"
   * without needing to parse font descriptors ourselves. */
  function sampleStyle(span: HTMLElement): TextEditStyleHint {
    const cs = getComputedStyle(span)
    const weight = parseInt(cs.fontWeight, 10)
    return {
      bold: (Number.isFinite(weight) && weight >= 600) || /bold/i.test(cs.fontWeight),
      italic: cs.fontStyle === 'italic' || cs.fontStyle === 'oblique',
      serif: /serif/i.test(cs.fontFamily) && !/sans-serif/i.test(cs.fontFamily),
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!pageRef.current) return
    const pageRect = pageRef.current.getBoundingClientRect()
    dragStartRef.current = { x: e.clientX, y: e.clientY, moved: false }
    setDragRect({ x: (e.clientX - pageRect.left) / renderScale, y: (e.clientY - pageRect.top) / renderScale, width: 0, height: 0 })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragStartRef.current
    if (!drag || !pageRef.current) return
    if (Math.abs(e.clientX - drag.x) > DRAG_THRESHOLD || Math.abs(e.clientY - drag.y) > DRAG_THRESHOLD) drag.moved = true
    if (!drag.moved) return
    const pageRect = pageRef.current.getBoundingClientRect()
    const x0 = (drag.x - pageRect.left) / renderScale
    const y0 = (drag.y - pageRect.top) / renderScale
    const x1 = (e.clientX - pageRect.left) / renderScale
    const y1 = (e.clientY - pageRect.top) / renderScale
    setDragRect({ x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) })
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragStartRef.current
    dragStartRef.current = null

    if (drag?.moved && dragRect && dragRect.width * renderScale > MIN_NEW_BOX && dragRect.height * renderScale > MIN_NEW_BOX) {
      setDragRect(null)
      setTextEdit(material.id, pageNumber, dragRect, '')
      const created = findEditNear(pageNumber, dragRect)
      if (created) {
        setSelectedId(created.id)
        setDraftValue('')
      }
      return
    }
    setDragRect(null)

    const span = textSpanAtPoint(e.clientX, e.clientY)
    const pageEl = pageRef.current
    if (!span || !pageEl) return
    const rect = elementRectInPage(span, pageEl, renderScale)
    const existing = edits.find((t) => t.page === pageNumber && Math.abs(t.x - rect.x) < 1 && Math.abs(t.y - rect.y) < 1)
    if (existing) {
      selectExisting(existing)
      return
    }
    setTextEdit(material.id, pageNumber, rect, span.textContent ?? '')
    const created = findEditNear(pageNumber, rect)
    if (created) {
      styleHintsRef.current.set(created.id, sampleStyle(span))
      setSelectedId(created.id)
      setDraftValue(created.replacement)
    }
  }

  function commitDraft() {
    if (!selectedId) return
    const edit = edits.find((e) => e.id === selectedId)
    if (!edit) return
    setTextEdit(material.id, edit.page, { x: edit.x, y: edit.y, width: edit.width, height: edit.height }, draftValue)
  }

  function deleteSelected() {
    if (!selectedId) return
    removeTextEdit(selectedId)
    styleHintsRef.current.delete(selectedId)
    setSelectedId(null)
  }

  function resizeSelected(delta: number) {
    if (!selectedId) return
    const edit = edits.find((e) => e.id === selectedId)
    if (!edit) return
    setTextEdit(material.id, edit.page, { x: edit.x, y: edit.y, width: edit.width, height: Math.max(6, edit.height + delta) }, draftValue)
  }

  async function saveToFile() {
    if (!fileUrl || edits.length === 0) return
    setSaving(true)
    try {
      const { exportPdfWithEdits } = await import('../../lib/pdfExport')
      const blob = await exportPdfWithEdits(fileUrl, edits, styleHintsRef.current)
      const ok = await replaceMaterialFile(material.id, material.fileName ?? 'documento.pdf', blob)
      if (!ok) {
        push({ title: 'Salvataggio non riuscito', tone: 'warn' })
        return
      }
      for (const e of edits) removeTextEdit(e.id)
      styleHintsRef.current.clear()
      onSaved(URL.createObjectURL(blob))
      push({ title: 'Modifiche salvate nel file', tone: 'good' })
      onOpenChange(false)
    } catch (err) {
      console.error('[PdfEditor] save failed', err)
      push({ title: 'Salvataggio non riuscito', tone: 'warn' })
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const selected = edits.find((e) => e.id === selectedId)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
            <FileEdit size={16} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--color-ink)]">{material.title}</p>
            <p className="truncate text-xs text-[var(--color-ink-muted)]">
              {edits.length > 0 ? `${edits.length} correzion${edits.length === 1 ? 'e' : 'i'} da salvare` : 'Clic su un testo per sostituirlo, o trascina per aggiungerne uno nuovo'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            <X size={14} /> Chiudi
          </Button>
          <Button size="sm" onClick={saveToFile} disabled={saving || edits.length === 0}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Salvo…' : 'Salva nel file'}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex flex-1 flex-col items-center overflow-auto bg-[var(--color-bg)] p-6">
          <div className="mb-4 flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-ink-muted)] shadow-sm">
            <button onClick={() => setPageNumber((p) => Math.max(1, p - 1))} disabled={pageNumber <= 1} className="rounded-full p-1.5 hover:bg-[var(--color-surface-2)] disabled:opacity-30">
              <ChevronLeft size={14} />
            </button>
            <span className="min-w-[4.5rem] text-center tabular-nums">
              pagina {pageNumber} / {numPages || '…'}
            </span>
            <button
              onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
              disabled={pageNumber >= numPages}
              className="rounded-full p-1.5 hover:bg-[var(--color-surface-2)] disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <div
            ref={pageRef}
            className="relative mx-auto rounded-sm bg-white shadow-[0_8px_30px_rgb(0,0,0,0.25)] ring-1 ring-black/5"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <canvas ref={canvasRef} className="block rounded-sm" />
            <div ref={textLayerRef} className="textLayer cursor-crosshair" />

            {pageEdits.map((e) => (
              <div
                key={e.id}
                onClick={(ev) => {
                  ev.stopPropagation()
                  selectExisting(e)
                }}
                className={cn('group absolute cursor-pointer overflow-hidden rounded-[3px] border-2 transition-shadow', e.id === selectedId ? 'shadow-[0_0_0_3px_rgba(124,92,255,0.18)]' : '')}
                style={{
                  left: e.x * renderScale - 1,
                  top: e.y * renderScale - e.height * renderScale * 0.18,
                  width: e.width * renderScale + 2,
                  height: e.height * renderScale * 1.36,
                  background: '#ffffff',
                  borderColor: e.id === selectedId ? 'var(--color-primary)' : 'transparent',
                }}
              >
                <span
                  className="pointer-events-none block truncate text-black"
                  style={{
                    marginTop: e.height * renderScale * 0.18,
                    fontSize: Math.max(6, e.height * renderScale * 0.85),
                    lineHeight: `${e.height * renderScale}px`,
                  }}
                >
                  {e.replacement}
                </span>
                {!e.replacement && e.id !== selectedId && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-[var(--color-ink-muted)]">vuoto</span>
                )}
              </div>
            ))}

            {dragRect && dragRect.width > 0 && (
              <div
                className="pointer-events-none absolute rounded-[3px] border-2 border-dashed bg-[var(--color-primary)]/5"
                style={{
                  left: dragRect.x * renderScale,
                  top: dragRect.y * renderScale,
                  width: dragRect.width * renderScale,
                  height: dragRect.height * renderScale,
                  borderColor: 'var(--color-primary)',
                }}
              />
            )}
          </div>
        </div>

        <div className="flex w-80 shrink-0 flex-col gap-4 overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          {selected ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3.5">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)]">
                  <MousePointerClick size={12} /> Correzione — pag. {selected.page}
                </p>
                <button onClick={deleteSelected} className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-[var(--color-warn)] hover:bg-[var(--color-warn)]/10">
                  <Trash2 size={12} /> Elimina
                </button>
              </div>
              <Textarea autoFocus value={draftValue} onChange={(ev) => setDraftValue(ev.target.value)} onBlur={commitDraft} rows={3} placeholder="Scrivi il testo corretto..." className="text-sm" />
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-ink-muted)]">Dimensione testo</span>
                <div className="ml-auto flex items-center gap-1 rounded-lg bg-[var(--color-surface)] p-0.5">
                  <button onClick={() => resizeSelected(-2)} className="rounded-md p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-ink)]">
                    <Minus size={12} />
                  </button>
                  <button onClick={() => resizeSelected(2)} className="rounded-md p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-ink)]">
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-6 text-center">
              <MousePointerClick size={20} className="text-[var(--color-ink-muted)]" />
              <p className="text-xs text-[var(--color-ink-muted)]">Clic su un testo esistente per sostituirlo, oppure trascina in un punto vuoto per aggiungere testo nuovo.</p>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
            <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)]">
              <ListChecks size={12} /> Tutte le correzioni ({edits.length})
            </p>
            {edits
              .slice()
              .sort((a, b) => a.page - b.page)
              .map((e) => (
                <button
                  key={e.id}
                  onClick={() => selectExisting(e)}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors',
                    e.id === selectedId ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
                        e.id === selectedId ? 'bg-white/20' : 'bg-[var(--color-surface)] text-[var(--color-ink-muted)]',
                      )}
                    >
                      p.{e.page}
                    </span>
                    <span className="truncate">{e.replacement || '(vuoto)'}</span>
                  </span>
                  <Trash2
                    size={12}
                    className="shrink-0 opacity-60 hover:opacity-100"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      removeTextEdit(e.id)
                      styleHintsRef.current.delete(e.id)
                      if (e.id === selectedId) setSelectedId(null)
                    }}
                  />
                </button>
              ))}
            {edits.length === 0 && <p className="text-xs text-[var(--color-ink-muted)]">Nessuna correzione ancora.</p>}
          </div>

          <p className="rounded-xl bg-[var(--color-surface-2)] p-2.5 text-[10px] leading-relaxed text-[var(--color-ink-muted)]">
            "Salva nel file" scrive le correzioni come testo PDF reale e selezionabile, direttamente nel documento — non un'immagine incollata sopra. Il
            testo originale coperto resta comunque presente sotto (non viene rimosso dal file, solo nascosto visivamente).
          </p>
        </div>
      </div>
    </div>
  )
}
