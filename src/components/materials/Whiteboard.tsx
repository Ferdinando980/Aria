import { useEffect, useRef } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/utils'
import type { Material } from '../../lib/types'

const CANVAS_W = 1000
const CANVAS_H = 1400

/** Overlays one PDF page (see PdfViewer.tsx) — keyed by page number so a
 * sketch stays anchored to the page it was drawn on, not to whatever happens
 * to be on screen (the old single-canvas-over-the-whole-viewer version lost
 * this the moment you scrolled or changed page). */
export function Whiteboard({
  material,
  page,
  active,
  visible,
  color,
  eraser,
}: {
  material: Material
  page: number
  active: boolean
  visible: boolean
  color: string
  eraser: boolean
}) {
  const updateMaterial = useAppStore((s) => s.updateMaterial)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const dataUrl = material.annotations?.[page]

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (dataUrl) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      img.src = dataUrl
    }
  }, [material.id, page, dataUrl])

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!active) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = true
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = pointerPos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!active || !drawingRef.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = pointerPos(e)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = eraser ? 40 : 5
    // destination-out erases by the STROKE'S ALPHA, not its RGB -- passing a
    // transparent color here (alpha=0) meant the eraser wiped out exactly
    // nothing, no matter the line width. Any fully-opaque color works; the
    // actual hue is irrelevant under this composite mode.
    ctx.strokeStyle = eraser ? '#000000' : color
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over'
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  function onPointerUp() {
    if (!active || !drawingRef.current) return
    drawingRef.current = false
    const canvas = canvasRef.current
    if (canvas) updateMaterial(material.id, { annotations: { ...material.annotations, [page]: canvas.toDataURL('image/png') } })
  }

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      className={cn(
        'absolute inset-0 h-full w-full touch-none transition-opacity',
        active ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    />
  )
}

export function clearWhiteboardPage(material: Material, page: number, updateMaterial: (id: string, patch: Partial<Material>) => void) {
  if (!material.annotations) return
  const { [page]: _removed, ...rest } = material.annotations
  updateMaterial(material.id, { annotations: rest })
}
