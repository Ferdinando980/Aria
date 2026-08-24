import { useRef, useState } from 'react'
import { X, Download, Move } from 'lucide-react'
import { Button } from '../ui/Button'

const DEFAULT_W = 820
const DEFAULT_H = 640
const POS_KEY = 'aria.attachmentViewerPos'

function loadSavedPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AttachmentViewer({
  name,
  mimeType,
  dataUrl,
  onClose,
}: {
  name: string
  mimeType?: string
  dataUrl?: string
  onClose: () => void
}) {
  const isImage = mimeType?.startsWith('image/')
  const isPdf = mimeType === 'application/pdf'
  const isText = mimeType?.startsWith('text/')

  const [pos, setPos] = useState(() => {
    const saved = loadSavedPos()
    if (saved) {
      return {
        x: Math.min(saved.x, window.innerWidth - 120),
        y: Math.min(saved.y, window.innerHeight - 60),
      }
    }
    return {
      x: Math.max(16, (window.innerWidth - DEFAULT_W) / 2),
      y: Math.max(16, (window.innerHeight - DEFAULT_H) / 2),
    }
  })
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  function onDragStart(e: React.PointerEvent) {
    // don't start a window-drag from the close/download buttons
    if ((e.target as HTMLElement).closest('button, a')) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onDragMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    const { startX, startY, origX, origY } = dragRef.current
    setPos({
      x: Math.min(Math.max(0, origX + (e.clientX - startX)), window.innerWidth - 120),
      y: Math.min(Math.max(0, origY + (e.clientY - startY)), window.innerHeight - 60),
    })
  }
  function onDragEnd() {
    dragRef.current = null
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos))
    } catch {
      // ignore quota errors
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
        style={{
          left: pos.x,
          top: pos.y,
          width: DEFAULT_W,
          height: DEFAULT_H,
          minWidth: 320,
          minHeight: 240,
          maxWidth: '95vw',
          maxHeight: '95vh',
          resize: 'both',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex cursor-grab items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3 active:cursor-grabbing"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Move size={13} className="shrink-0 text-[var(--color-ink-muted)]" />
            <p className="min-w-0 truncate text-sm font-medium">{name}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {dataUrl && (
              <a href={dataUrl} download={name}>
                <Button size="sm" variant="soft">
                  <Download size={14} /> Scarica
                </Button>
              </a>
            )}
            <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {!dataUrl && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-[var(--color-ink-muted)]">
              <p>Questo file era troppo grande per essere tenuto in memoria — non posso rimostrartelo, ma la risposta di Aria resta qui sopra.</p>
            </div>
          )}
          {dataUrl && isImage && <img src={dataUrl} alt={name} className="mx-auto max-h-full max-w-full rounded-lg" />}
          {dataUrl && isPdf && <iframe src={dataUrl} title={name} className="h-full w-full rounded-lg border border-[var(--color-border)]" />}
          {dataUrl && isText && <iframe src={dataUrl} title={name} className="h-full w-full rounded-lg border border-[var(--color-border)] bg-white" />}
          {dataUrl && !isImage && !isPdf && !isText && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-[var(--color-ink-muted)]">
              <p>Non riesco a mostrare l'anteprima di questo formato, ma puoi scaricarlo.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
