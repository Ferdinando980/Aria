import type { MaterialHighlight } from './types'

// Deliberately NOT here anymore (2026-08-20): a browser-Selection/Range-based
// capture (captureSelectionInPage) and a caretRangeFromPoint-driven drag
// variant were both tried for the "Evidenzia" highlighter and both dropped --
// on real documents (mixed heading sizes, multi-level indentation) the
// resulting Range/rects captured many more lines than were actually dragged
// over, unpredictably. The brush below (paint whichever span the pointer
// physically crosses) replaced them entirely, not just for touch.

/** Bounding rect of a single DOM element (typically one pdf.js text-layer
 * span), in the same unscaled page-space as captureSelectionInPage's rects
 * -- used by the "Evidenzia" brush tool, which highlights whichever spans
 * the pointer physically crosses rather than a browser text Selection. */
export function elementRectInPage(el: HTMLElement, pageEl: HTMLElement, scale: number) {
  const r = el.getBoundingClientRect()
  const pageRect = pageEl.getBoundingClientRect()
  return { x: (r.left - pageRect.left) / scale, y: (r.top - pageRect.top) / scale, width: r.width / scale, height: r.height / scale }
}

/** Topmost pdf.js text-layer SPAN under a viewport point, or null if the
 * point is in a gap (between lines, margins) with no text there. */
export function textSpanAtPoint(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y)
  if (el && el.tagName === 'SPAN' && el.closest('.textLayer')) return el as HTMLElement
  return null
}

/** Inverse of the above — on-screen CSS px position for a saved highlight's
 * rects at the current render scale, relative to the same page container. */
export function highlightScreenRects(highlight: MaterialHighlight, scale: number) {
  return highlight.rects.map((r) => ({
    left: r.x * scale,
    top: r.y * scale,
    width: r.width * scale,
    height: r.height * scale,
  }))
}
