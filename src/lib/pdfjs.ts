// Shared pdf.js loader — pdf.js (~450KB) is only needed when someone actually
// opens a PDF, so every caller loads it lazily instead of it sitting in the
// main bundle. Used both for text extraction (materialContent.ts, for AI
// features) and for real rendering (PdfViewer.tsx).
export async function loadPdfjs() {
  const pdfjsLib = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjsLib
}

export type PdfjsLib = Awaited<ReturnType<typeof loadPdfjs>>
export type PdfDocument = Awaited<ReturnType<PdfjsLib['getDocument']>['promise']>
export type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>
