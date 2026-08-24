import type { TextEdit } from './types'

/** Visual hints sampled from the original text run at the moment a
 * correction is created (see PdfEditor.tsx) -- not persisted, purely to
 * pick a closer-matching replacement font than a flat default Helvetica. */
export interface TextEditStyleHint {
  bold: boolean
  italic: boolean
  serif: boolean
}

/**
 * Produces a real, downloadable PDF with "Modifica testo" corrections
 * actually written into the file -- not a picture of the page glued on top.
 * For each edited span this draws a white rectangle over the original
 * glyphs and a REAL, selectable PDF text object (drawn with pdf-lib's
 * `drawText`, a genuine content-stream operator, not a rasterized canvas
 * image) with the replacement, directly onto that same page. Every other
 * page, and everything else on an edited page, is untouched original vector
 * content -- nothing in the document is rasterized.
 *
 * Honest limit that remains: the original glyphs are covered, not deleted.
 * True in-place text replacement would mean locating and rewriting the
 * exact Tj/TJ operator(s) for that span inside the page's content stream --
 * infeasible to do reliably across arbitrary real-world PDFs (subset/
 * embedded fonts, kerning arrays, compressed streams) without a full PDF
 * content-stream editor, which is out of scope here. Covering + drawing new
 * real text on top is the same technique standard "fill and sign" / redact
 * tools use when they don't rewrite the stream either -- checked against
 * pdf.js's own FreeText/redaction annotation editor (which Firefox's "Edit
 * PDF" feature uses) and PDF-editing tools generally: none of them rewrite
 * existing content-stream text either, for the same reason.
 */
export async function exportPdfWithEdits(fileUrl: string, edits: TextEdit[], styleHints?: Map<string, TextEditStyleHint>): Promise<Blob> {
  const editsByPage = new Map<number, TextEdit[]>()
  for (const e of edits) {
    const list = editsByPage.get(e.page) ?? []
    list.push(e)
    editsByPage.set(e.page, list)
  }

  const res = await fetch(fileUrl)
  const buf: ArrayBuffer = await res.arrayBuffer()
  const originalBytes = new Uint8Array(buf)

  // Lazy-imported like pdfjs-dist (see pdfjs.ts) -- only someone actually
  // exporting a corrected PDF needs pdf-lib's weight in their bundle.
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const outPdf = await PDFDocument.load(originalBytes)

  // One of the 4 combinations of bold/italic x sans/serif -- embedded lazily
  // per combination actually used, not all 8 standard fonts up front.
  const fontCache = new Map<string, Awaited<ReturnType<typeof outPdf.embedFont>>>()
  async function fontFor(hint: TextEditStyleHint | undefined) {
    const key = hint ? `${hint.serif ? 's' : ''}${hint.bold ? 'b' : ''}${hint.italic ? 'i' : ''}` : ''
    const cached = fontCache.get(key)
    if (cached) return cached
    const std = !hint
      ? StandardFonts.Helvetica
      : hint.serif
        ? hint.bold && hint.italic
          ? StandardFonts.TimesRomanBoldItalic
          : hint.bold
            ? StandardFonts.TimesRomanBold
            : hint.italic
              ? StandardFonts.TimesRomanItalic
              : StandardFonts.TimesRoman
        : hint.bold && hint.italic
          ? StandardFonts.HelveticaBoldOblique
          : hint.bold
            ? StandardFonts.HelveticaBold
            : hint.italic
              ? StandardFonts.HelveticaOblique
              : StandardFonts.Helvetica
    const embedded = await outPdf.embedFont(std)
    fontCache.set(key, embedded)
    return embedded
  }

  for (const [pageNumber, pageEdits] of editsByPage) {
    const page = outPdf.getPage(pageNumber - 1)
    const { height: pageHeight } = page.getSize()
    for (const edit of pageEdits) {
      const font = await fontFor(styleHints?.get(edit.id))
      // TextEdit's x/y/width/height are top-down page-space (0,0 at the
      // page's top-left, same convention as MaterialHighlight.rects and
      // PdfPage.tsx's on-screen overlay) -- pdf-lib's drawing API uses the
      // PDF's native bottom-up space, so every y here is flipped against
      // the page's real height.
      const fontSize = Math.max(6, edit.height * 0.95)
      const textWidth = font.widthOfTextAtSize(edit.replacement, fontSize)
      // Widen the cover rect to fit the new text too, in case the
      // replacement is longer than the span it's replacing -- otherwise a
      // longer correction would spill out past the white cover and overlap
      // whatever original text sits immediately to the right.
      const rectWidth = Math.max(edit.width, textWidth + 4)
      const pad = edit.height * 0.18
      const rectBottom = pageHeight - (edit.y + edit.height) - pad
      const rectHeight = edit.height + pad * 2
      page.drawRectangle({ x: edit.x - 1, y: rectBottom, width: rectWidth + 2, height: rectHeight, color: rgb(1, 1, 1) })
      const baselineY = pageHeight - (edit.y + edit.height * 0.88)
      page.drawText(edit.replacement, { x: edit.x + 1, y: baselineY, size: fontSize, font, color: rgb(0, 0, 0) })
    }
  }

  const outBytes = await outPdf.save()
  return new Blob([outBytes.slice()], { type: 'application/pdf' })
}
