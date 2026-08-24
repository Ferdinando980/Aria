import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Sparkles, ListChecks, Loader2, Pencil, Eraser, Trash2, Eye, EyeOff, Maximize2, Minimize2, Highlighter, BookOpen, PencilLine, FileEdit, FileType2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Input'
import { useAppStore } from '../../store/useAppStore'
import { getMaterialFileBlob } from '../../lib/storage'
import { isViewableInline } from '../../lib/materialContent'
import { Whiteboard } from './Whiteboard'
import { PdfViewer } from './PdfViewer'
import { ChaptersPanel } from './ChaptersPanel'
import { PdfEditor } from './PdfEditor'
import { WordEditFlow } from './WordEditFlow'
import { cn } from '../../lib/utils'
import type { Material } from '../../lib/types'
import { MarkdownLite } from '../shared/MarkdownLite'

const PEN_COLORS = ['#FDE06D', '#FF7675', '#74B9FF', '#55EFC4', '#F5F3FF'] // first entry kept in sync with index.css's --color-accent

export function MaterialViewer({
  material,
  onAskAria,
  onOpenPlan,
  jumpTarget,
  onPageChange,
}: {
  material: Material
  onAskAria: () => void
  onOpenPlan: () => void
  jumpTarget?: { page: number; nonce: number; highlightId?: string }
  /** See PdfViewer's onPageInViewChange -- threaded straight through, no kind
   * (pdf/note/link) knows or cares about this except PdfViewer itself. */
  onPageChange?: (page: number) => void
}) {
  const updateMaterial = useAppStore((s) => s.updateMaterial)
  const [noteDraft, setNoteDraft] = useState(material.content ?? '')
  const [fileUrl, setFileUrl] = useState<string | null>(material.fileDataUrl ?? null)
  const [textContent, setTextContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [fullscreen, setFullscreen] = useState(false)
  const [drawMode, setDrawMode] = useState(false)
  const [boardVisible, setBoardVisible] = useState(true)
  const [penColor, setPenColor] = useState(PEN_COLORS[0])
  const [eraser, setEraser] = useState(false)
  const [highlightMode, setHighlightMode] = useState(false)
  const [highlightEraseMode, setHighlightEraseMode] = useState(false)
  const [chaptersOpen, setChaptersOpen] = useState(false)
  const [breadcrumbPage, setBreadcrumbPage] = useState(1)
  const allChapters = useAppStore((s) => s.chapters)
  const subjects = useAppStore((s) => s.subjects)
  const [editorOpen, setEditorOpen] = useState(false)
  const [wordFlowOpen, setWordFlowOpen] = useState(false)
  const textEdits = useAppStore((s) => s.textEdits)
  const pendingEditCount = textEdits.filter((t) => t.materialId === material.id).length
  const [localJump, setLocalJump] = useState<{ page: number; nonce: number; highlightId?: string } | undefined>()
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState(material.title)
  const [notePreview, setNotePreview] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const hasSketch = !!material.annotations && Object.keys(material.annotations).length > 0

  useEffect(() => {
    setTitleDraft(material.title)
  }, [material.id, material.title])

  function saveTitle() {
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== material.title) updateMaterial(material.id, { title: trimmed })
    else setTitleDraft(material.title)
    setRenaming(false)
  }

  // Merges two jump sources into the one PdfViewer actually consumes: the
  // "collegamenti" list in Materials.tsx (external prop) and this viewer's
  // own Chapters panel (internal). Whichever fired most recently wins.
  useEffect(() => {
    if (jumpTarget) setLocalJump(jumpTarget)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget?.nonce])

  useEffect(() => {
    setNoteDraft(material.content ?? '')
  }, [material.id, material.content])

  // Esc as a reliable way out of fullscreen regardless of where the exit
  // button ends up on screen (2026-08-20: reported as "can't shrink back
  // down") -- the fixed inset-0 overlay can end up with other floating UI
  // (toasts, dialogs opened from inside it) stacking above the toolbar in
  // some states, so a keyboard escape hatch doesn't depend on hitting a
  // specific pixel.
  useEffect(() => {
    if (!fullscreen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setTextContent(null)
    setFileUrl(material.fileDataUrl ?? null)

    async function load() {
      if (material.type !== 'file') return
      let url = material.fileDataUrl ?? null
      let blob: Blob | null = null
      if (!url && material.filePath) {
        setLoading(true)
        // getMaterialFileBlob, not getMaterialFileUrl+fetch (2026-08-24,
        // real user diagnosis: every open was re-downloading the whole
        // file from Storage, even to re-view a section read minutes
        // earlier -- this is the single most-hit call site for that,
        // MaterialViewer is what "opening a material" actually mounts).
        // A local blob: URL, not the remote signed URL, so pdf.js/download
        // never touch the network on a cache hit either.
        blob = await getMaterialFileBlob(material.filePath)
        if (blob) {
          objectUrl = URL.createObjectURL(blob)
          url = objectUrl
        }
        if (!cancelled) setLoading(false)
      }
      if (cancelled) return
      setFileUrl(url)
      if (isViewableInline(material) === 'text' && (blob || url)) {
        try {
          const text = blob ? await blob.text() : await (await fetch(url!)).text()
          if (!cancelled) setTextContent(text)
        } catch {
          if (!cancelled) setTextContent('(non sono riuscita a leggere il file)')
        }
      }
    }
    load()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material.id, material.filePath])

  function saveNote() {
    if (noteDraft !== material.content) updateMaterial(material.id, { content: noteDraft })
  }

  // The note field is raw markdown source (MarkdownLite's subset: ## / - / **)
  // -- wrapping the selection is what makes "premi Grassetto" actually do
  // something, instead of the user needing to type ** by hand and never
  // seeing it rendered (previous bug report: "non prende il grassetto").
  function wrapSelection(before: string, after = before) {
    const el = noteRef.current
    if (!el) return
    const { selectionStart: start, selectionEnd: end } = el
    const selected = noteDraft.slice(start, end)
    const next = noteDraft.slice(0, start) + before + selected + after + noteDraft.slice(end)
    setNoteDraft(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  function toggleDrawMode() {
    setDrawMode((d) => {
      const next = !d
      if (next) {
        setBoardVisible(true) // no point drawing on a hidden board
        setHighlightMode(false) // one tool active at a time
      }
      return next
    })
  }

  function toggleHighlightMode() {
    setHighlightMode((h) => {
      const next = !h
      if (next) {
        setDrawMode(false)
        setHighlightEraseMode(false)
      }
      return next
    })
  }

  // User request (2026-08-24): removing a highlight only existed via
  // click-to-open-then-"Rimuovi" (still there, one at a time) -- this adds a
  // brush-style eraser matching the drawing tool's "Gomma", so dragging over
  // several highlights clears them in one pass instead of one dialog per hit.
  function toggleHighlightEraseMode() {
    setHighlightEraseMode((h) => {
      const next = !h
      if (next) {
        setDrawMode(false)
        setHighlightMode(false)
      }
      return next
    })
  }

  function clearBoard() {
    updateMaterial(material.id, { annotations: undefined })
  }

  const kind = isViewableInline(material)

  // Breadcrumb "Materia > Capitolo > Sezione" (2026-08-24 roadmap: "il
  // viewer deve poter mostrare chiaramente la posizione corrente"). Derived
  // live from breadcrumbPage, same page-range lookup already used for
  // chapter/section-scoped skill retrieval (MaterialAskPanel's
  // currentLocation) -- not a new concept, just surfaced in this header too.
  const subjectName = subjects.find((s) => s.id === material.subjectId)?.name
  const breadcrumbChapter =
    kind === 'pdf' ? allChapters.find((c) => c.materialId === material.id && breadcrumbPage >= c.startPage && breadcrumbPage <= c.endPage) : undefined
  const breadcrumbSection = breadcrumbChapter?.subsections.find((s) => breadcrumbPage >= s.startPage && breadcrumbPage <= s.endPage)

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]',
        fullscreen ? 'fixed inset-0 z-50 rounded-none' : 'h-full min-h-[420px]',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <div className="min-w-0 flex-1">
        {(subjectName || breadcrumbChapter) && (
          <p className="mb-0.5 truncate text-[11px] text-[var(--color-ink-muted)]">
            {[subjectName, breadcrumbChapter?.title, breadcrumbSection?.title].filter(Boolean).join(' › ')}
          </p>
        )}
        {renaming ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle()
              if (e.key === 'Escape') {
                setTitleDraft(material.title)
                setRenaming(false)
              }
            }}
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-primary)] bg-[var(--color-surface-2)] px-2 py-1 text-sm font-medium text-[var(--color-ink)] outline-none"
          />
        ) : (
          <button onClick={() => setRenaming(true)} className="group flex min-w-0 items-center gap-1.5 text-left" title="Rinomina">
            <p className="min-w-0 truncate text-sm font-medium">{material.title}</p>
            <PencilLine size={12} className="shrink-0 text-[var(--color-ink-muted)] opacity-50 group-hover:opacity-100" />
          </button>
        )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {kind === 'pdf' && (
            <button
              onClick={toggleHighlightMode}
              className={cn(
                'flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium',
                highlightMode ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
              )}
              title="Evidenzia trascinando il dito/mouse sul testo — comodo su tablet"
            >
              <Highlighter size={13} /> Evidenzia
            </button>
          )}

          {kind === 'pdf' && (
            <button
              onClick={toggleHighlightEraseMode}
              className={cn(
                'flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium',
                highlightEraseMode ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
              )}
              title="Trascina sopra le evidenziazioni per rimuoverle"
            >
              <Eraser size={13} /> Cancella evidenziazione
            </button>
          )}

          {kind === 'pdf' && (
            <button
              onClick={() => setEditorOpen(true)}
              className="relative flex items-center gap-1 rounded-lg bg-[var(--color-surface-2)] px-2 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              title="Apri l'editor per correggere il testo del PDF"
            >
              <FileEdit size={13} /> Modifica
              {pendingEditCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-warn)] text-[9px] font-bold text-white">
                  {pendingEditCount}
                </span>
              )}
            </button>
          )}

          {kind === 'pdf' && (
            <button
              onClick={() => setWordFlowOpen(true)}
              className="flex items-center gap-1 rounded-lg bg-[var(--color-surface-2)] px-2 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              title="Riscrive davvero il testo, passando per Word (richiede il servizio locale sul tuo PC)"
            >
              <FileType2 size={13} /> Modifica in Word
            </button>
          )}

          {kind === 'pdf' && (
            <button
              onClick={() => setChaptersOpen(true)}
              className="flex items-center gap-1 rounded-lg bg-[var(--color-surface-2)] px-2 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              title="Capitoli"
            >
              <BookOpen size={13} /> Capitoli
            </button>
          )}

          <button
            onClick={toggleDrawMode}
            className={cn(
              'flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium',
              drawMode ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
            )}
            title="Disegna sul materiale"
          >
            <Pencil size={13} /> Disegna
          </button>

          {drawMode && (
            <>
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setPenColor(c)
                    setEraser(false)
                  }}
                  className="h-5 w-5 shrink-0 rounded-full"
                  style={{ background: c, outline: !eraser && penColor === c ? '2px solid var(--color-ink)' : 'none', outlineOffset: 2 }}
                />
              ))}
              <button
                onClick={() => setEraser((e) => !e)}
                className={cn('rounded-lg p-1.5', eraser ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]')}
                title="Gomma"
              >
                <Eraser size={13} />
              </button>
              <button onClick={clearBoard} className="rounded-lg bg-[var(--color-surface-2)] p-1.5 text-[var(--color-warn)]" title="Cancella disegno">
                <Trash2 size={13} />
              </button>
            </>
          )}

          {hasSketch && !drawMode && (
            <button
              onClick={() => setBoardVisible((v) => !v)}
              className="flex items-center gap-1 rounded-lg bg-[var(--color-surface-2)] px-2 py-1.5 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              title={boardVisible ? 'Nascondi disegno' : 'Mostra disegno'}
            >
              {boardVisible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          )}

          <Button size="sm" variant="soft" onClick={onOpenPlan}>
            <ListChecks size={14} /> Piano (questo file)
          </Button>

          <Button size="sm" variant="soft" onClick={onAskAria}>
            <Sparkles size={14} /> Chiedi ad Aria
          </Button>

          <button
            onClick={() => setFullscreen((f) => !f)}
            className="rounded-lg bg-[var(--color-surface-2)] p-1.5 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            title={fullscreen ? 'Comprimi' : 'Schermo intero'}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto p-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
            <Loader2 size={14} className="animate-spin" /> Carico...
          </div>
        )}

        {!loading && material.type === 'note' && (
          <div className="flex h-full flex-col gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => wrapSelection('**')}
                disabled={notePreview}
                className="rounded-lg px-2 py-1 text-xs font-bold text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] disabled:opacity-40"
                title="Grassetto"
              >
                B
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => wrapSelection('## ', '')}
                disabled={notePreview}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] disabled:opacity-40"
                title="Titolo sezione"
              >
                H
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => wrapSelection('- ', '')}
                disabled={notePreview}
                className="rounded-lg px-2 py-1 text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] disabled:opacity-40"
                title="Elenco puntato"
              >
                •
              </button>
              <button
                type="button"
                onClick={() => {
                  saveNote()
                  setNotePreview((p) => !p)
                }}
                className={cn(
                  'ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium',
                  notePreview ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
                )}
                title={notePreview ? 'Torna a modificare' : 'Anteprima formattata'}
              >
                {notePreview ? <EyeOff size={13} /> : <Eye size={13} />} {notePreview ? 'Modifica' : 'Anteprima'}
              </button>
            </div>
            {notePreview ? (
              <MarkdownLite text={noteDraft || '(vuoto)'} className="flex-1 overflow-auto text-sm" />
            ) : (
              <Textarea
                ref={noteRef}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onBlur={saveNote}
                rows={18}
                placeholder="Scrivi qui il tuo appunto... (## per un titolo, - per un elenco, **testo** per il grassetto)"
                className="h-full min-h-[380px] flex-1 resize-none border-none bg-transparent p-0 text-sm leading-relaxed focus:border-none"
              />
            )}
          </div>
        )}

        {!loading && material.type === 'link' && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <p className="max-w-xs text-sm text-[var(--color-ink-muted)]">
              Molti siti non permettono l'anteprima dentro un'altra pagina — lo apro in una scheda nuova.
            </p>
            <a href={material.url} target="_blank" rel="noreferrer">
              <Button>
                <ExternalLink size={14} /> Apri il link
              </Button>
            </a>
          </div>
        )}

        {!loading && material.type === 'file' && kind === 'pdf' && fileUrl && (
          <PdfViewer
            material={material}
            fileUrl={fileUrl}
            drawMode={drawMode}
            boardVisible={boardVisible}
            penColor={penColor}
            eraser={eraser}
            highlightMode={highlightMode}
            highlightEraseMode={highlightEraseMode}
            jumpTarget={localJump}
            onPageInViewChange={(page) => {
              setBreadcrumbPage(page)
              onPageChange?.(page)
            }}
          />
        )}

        {!loading && material.type === 'file' && kind === 'image' && fileUrl && (
          <div className="relative mx-auto max-h-[70dvh] max-w-full">
            <img src={fileUrl} alt={material.title} className="max-h-[70dvh] max-w-full rounded-lg" />
            <Whiteboard material={material} page={1} active={drawMode} visible={boardVisible} color={penColor} eraser={eraser} />
          </div>
        )}

        {!loading && material.type === 'file' && kind === 'text' && (
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink)]">{textContent ?? '...'}</pre>
        )}

        {!loading && material.type === 'file' && !kind && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <p className="max-w-xs text-sm text-[var(--color-ink-muted)]">
              Non riesco ancora a mostrare l'anteprima di "{material.fileName}" — puoi comunque scaricarlo.
            </p>
            {fileUrl && (
              <a href={fileUrl} download={material.fileName}>
                <Button variant="soft">Scarica</Button>
              </a>
            )}
          </div>
        )}
      </div>

      {kind === 'pdf' && (
        <ChaptersPanel
          material={material}
          fileUrl={fileUrl}
          open={chaptersOpen}
          onOpenChange={setChaptersOpen}
          onJumpToPage={(page) => setLocalJump({ page, nonce: Date.now() })}
        />
      )}

      {kind === 'pdf' && (
        <PdfEditor material={material} fileUrl={fileUrl} open={editorOpen} onOpenChange={setEditorOpen} onSaved={(newUrl) => setFileUrl(newUrl)} />
      )}

      {kind === 'pdf' && (
        <WordEditFlow material={material} fileUrl={fileUrl} open={wordFlowOpen} onOpenChange={setWordFlowOpen} onSaved={(newUrl) => setFileUrl(newUrl)} />
      )}
    </div>
  )
}
