import type { ChapterSection, Material, MaterialChapter } from './types'
import { getMaterialFileBlob } from './storage'
import { loadPdfjs } from './pdfjs'

const MAX_CHARS = 15000

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
  return res.arrayBuffer()
}

/** Resolves a file material's real bytes, cache-aware for cloud-stored
 * files (2026-08-24, real user diagnosis: this and getMaterialFileUrl's
 * other callers were each independently re-downloading the same file from
 * Supabase Storage). fileDataUrl (the local-only base64 fallback) is
 * already free to read -- a data: URL resolves in-memory, no network --
 * so only the filePath branch goes through the shared blob cache. */
async function resolveMaterialArrayBuffer(material: Material): Promise<ArrayBuffer | null> {
  if (material.fileDataUrl) return fetchArrayBuffer(material.fileDataUrl)
  if (material.filePath) {
    const blob = await getMaterialFileBlob(material.filePath, material.fileUpdatedAt)
    return blob ? blob.arrayBuffer() : null
  }
  return null
}

export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjsLib = await loadPdfjs()
  const pdf = await pdfjsLib.getDocument({ data }).promise
  let text = ''
  const maxPages = Math.min(pdf.numPages, 40)
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    text += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n\n'
    if (text.length > MAX_CHARS) break
  }
  return text.trim()
}

export interface PageTextResult {
  pages: { page: number; text: string }[]
  /** True if there was more document left when extraction stopped (hit
   * maxPages or the char cap) -- callers (ChaptersPanel) use this to offer
   * a "Continua rilevamento" step instead of ever silently truncating
   * coverage of the material. */
  truncated: boolean
  /** Total page count in the source PDF, for showing "pagine X-Y di Z". */
  totalPages: number
}

/** Same extraction as extractPdfText, but keeping page boundaries. Two
 * different callers need very different per-page budgets, so both are
 * parameters rather than one fixed constant:
 *  - Chapter detection (ChaptersPanel) needs every page of a whole real
 *    document, but only enough of each to name its topic -- a small
 *    charBudgetPerPage (~700) so the page-count ceiling, not the char cap,
 *    is what actually limits coverage.
 *  - Flashcards/summaries (Flashcards.tsx) are already scoped to one
 *    chapter/section's page range (a handful of pages), and need the FULL
 *    text of those pages to generate anything good -- default budgets here
 *    (no per-page truncation, a generous overall cap) are sized for that.
 * `fromPage` lets a second pass resume where an earlier truncated pass left
 * off (see ChaptersPanel's "Continua rilevamento"), instead of re-extracting
 * pages already covered. */
// How many pages pdf.js extracts concurrently in extractPdfTextByPage
// (2026-08-24, real user report: "il piano su questo file lo vedo ancora
// lentissimo" -- measured live, not assumed: a strictly sequential loop over
// 82 real pages of "Progettazione di Algoritmi" took over 2 MINUTES with
// zero network activity during that time (confirmed via
// performance.getEntriesByType('resource') -- the arraybuffer fetch itself
// was 2.8s, everything after was pure single-threaded pdf.js
// getPage()/getTextContent() CPU work, one page at a time). pdf.js's page
// rendering/text-extraction pipeline tolerates real concurrency (its own
// internal worker already parallelizes across pages when asked to), so
// batching instead of awaiting one page at a time is a real wall-clock win,
// not just a cosmetic reorder -- not literal parallel CPU (JS is
// single-threaded), but overlapping the async work each page's
// getTextContent() actually waits on.
const PDF_PAGE_EXTRACTION_CONCURRENCY = 8

export async function extractPdfTextByPage(
  data: ArrayBuffer,
  opts: { fromPage?: number; maxPages?: number; charBudgetPerPage?: number; charCap?: number } = {},
): Promise<PageTextResult> {
  const { fromPage = 1, maxPages: maxPagesOpt = 600, charBudgetPerPage = Infinity, charCap = 450000 } = opts
  const pdfjsLib = await loadPdfjs()
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const maxPages = Math.min(pdf.numPages, maxPagesOpt)
  const pages: { page: number; text: string }[] = []
  let total = 0
  let truncated = false
  // Batches of PDF_PAGE_EXTRACTION_CONCURRENCY pages extracted concurrently,
  // but appended to `pages` and checked against charCap in page order once
  // each batch resolves -- keeps the exact same output (page order, and
  // "stop once charCap is hit") as the old sequential loop, just with the
  // actual per-page work overlapped instead of serialized.
  outer: for (let batchStart = fromPage; batchStart <= maxPages; batchStart += PDF_PAGE_EXTRACTION_CONCURRENCY) {
    const batchEnd = Math.min(batchStart + PDF_PAGE_EXTRACTION_CONCURRENCY - 1, maxPages)
    const batchNumbers = Array.from({ length: batchEnd - batchStart + 1 }, (_, k) => batchStart + k)
    const batchTexts = await Promise.all(
      batchNumbers.map(async (i) => {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        const fullText = content.items.map((it) => ('str' in it ? it.str : '')).join(' ').trim()
        return fullText.slice(0, charBudgetPerPage)
      }),
    )
    for (let k = 0; k < batchNumbers.length; k++) {
      const text = batchTexts[k]
      if (total + text.length > charCap) {
        truncated = true
        break outer
      }
      pages.push({ page: batchNumbers[k], text })
      total += text.length
    }
  }
  if (maxPages < pdf.numPages) truncated = true
  return { pages, truncated, totalPages: pdf.numPages }
}

// 2026-08-21: raised well past what any real textbook needs -- at
// CHAPTER_PAGE_CHAR_BUDGET=700/page this ceiling alone allows ~600 pages
// before the char cap even matters. Gemini Flash's context window
// comfortably fits a whole real document's worth of per-page snippets in
// one call, so the old artificial low caps (60 pages/15000 chars, then
// 200/60000 -- and computed from each page's FULL untruncated text before
// truncating for the prompt, so dense pages ate the budget fast) were
// leaving chapters covering only the start of the book for no real
// model-limit reason.
export const CHAPTER_DETECTION_OPTS = { maxPages: 600, charBudgetPerPage: 700, charCap: 450000 }

/** Moved here from Flashcards.tsx (2026-08-21) so StudyPlanPanel/
 * MaterialPlanPanel can reuse the exact same page-range text extraction for
 * study-plan generation instead of duplicating it a third time -- real bug
 * fix, user report: the study plan was generated from a flat text blob of
 * the whole material, re-discovering chapter structure the model itself
 * invented, instead of respecting the material's own already-detected
 * MaterialChapter page ranges (the same ones flashcards/summaries already
 * use). Same scoping rule as flashcards/summaries: a chapter, optionally
 * narrowed to one of its subsections. */
/** Real bug fix (2026-08-21, user report: "il piano di studi non è fatto sui
 * capitoli generati... deve essere fatto sui capitoli generati"). Before
 * this, generateStudyPlan() got one flat text blob per material and had to
 * re-discover chapter structure itself -- a SEPARATE, possibly different
 * split from the one ChaptersPanel already detected and flashcards/
 * summaries already use. This builds the real input instead: one entry per
 * ALREADY-DETECTED MaterialChapter (id kept, so the caller can link the
 * resulting StudyPlanChapter back to it -- see gemini.ts's generateStudyPlan
 * materialChapterId matching).
 *
 * Section-level (2026-08-24, real user report: "manca la divisione per
 * sezioni... come avevamo detto" -- this was flagged as missing before, not
 * a new ask): a chapter WITH real detected subsections now contributes one
 * entry PER SUBSECTION (its own page-scoped text) instead of one entry for
 * the whole chapter -- the model gets the real finer structure to plan
 * against, the same one Flashcards/summaries already key off, instead of
 * silently re-flattening it back to chapter-only. A chapter with no
 * subsections still contributes one whole-chapter entry, unchanged (nothing
 * finer exists to split into). A material with NO detected chapters yet
 * still falls back to one whole-material entry (both ids omitted) so it
 * isn't silently dropped just because "Rileva capitoli" hasn't been run. */
export async function buildStudyPlanChapterInputs(
  materials: Material[],
  allChapters: MaterialChapter[],
): Promise<{ chapterId?: string; sectionId?: string; title: string; text: string }[]> {
  const inputs: { chapterId?: string; sectionId?: string; title: string; text: string }[] = []
  for (const material of materials) {
    const materialChapters = allChapters.filter((c) => c.materialId === material.id).sort((a, b) => a.order - b.order)
    if (materialChapters.length === 0) {
      const { text, truncated } = await getMaterialText(material)
      inputs.push({ title: material.title, text: text ? `${text}${truncated ? '\n(...troncato)' : ''}` : '(contenuto non leggibile)' })
      continue
    }
    for (const chapter of materialChapters) {
      if (chapter.subsections.length === 0) {
        const { text } = await getChapterScopedText(material, chapter, undefined)
        inputs.push({ chapterId: chapter.id, title: chapter.title, text: text || '(pagine di questo capitolo non leggibili)' })
        continue
      }
      for (const section of chapter.subsections) {
        const { text } = await getChapterScopedText(material, chapter, section)
        inputs.push({
          chapterId: chapter.id,
          sectionId: section.id,
          title: `${chapter.title} — ${section.title}`,
          text: text || '(pagine di questa sezione non leggibili)',
        })
      }
    }
  }
  return inputs
}

// Keyed by materialId, caches the full per-page extraction (not just the
// scoped slice) -- 2026-08-24, found live while testing section-level study
// plan generation: buildStudyPlanChapterInputs now calls this once PER
// SUBSECTION, and without this cache each call re-fetched and re-parsed the
// WHOLE pdf from scratch (~30 full re-parses of an 82-page real document for
// one plan generation). A Promise (not the resolved value) is cached so
// concurrent calls for the same material -- sequential here, but Flashcards/
// summary generation can call this per-chapter too -- dedupe onto the same
// in-flight extraction instead of racing separate fetches.
const chapterScopedPagesCache = new Map<string, Promise<PageTextResult>>()

export async function getChapterScopedText(material: Material, chapter: MaterialChapter, section: ChapterSection | undefined): Promise<{ text: string; scopeLabel: string }> {
  const range = section ?? chapter
  const scopeLabel = section ? `capitolo "${chapter.title}", sezione "${section.title}"` : `capitolo "${chapter.title}"`
  let pagesPromise = chapterScopedPagesCache.get(material.id)
  if (!pagesPromise) {
    const buf = await resolveMaterialArrayBuffer(material)
    if (!buf) return { text: '', scopeLabel }
    pagesPromise = extractPdfTextByPage(buf)
    chapterScopedPagesCache.set(material.id, pagesPromise)
  }
  const { pages } = await pagesPromise
  const text = pages
    .filter((p) => p.page >= range.startPage && p.page <= range.endPage)
    .map((p) => p.text)
    .join('\n')
  return { text, scopeLabel }
}

export interface MaterialTextResult {
  text: string | null
  truncated: boolean
}

// In-memory cache, keyed by material id (2026-08-24, real user report:
// "l'accesso al file da parte di aria è molto lento, non dovrebbe ogni
// volta ricaricarlo tutto"). getMaterialText re-fetches the file AND
// re-runs full PDF text extraction on every call -- expensive for a large
// PDF (the real 82-page document tested this session), and was happening
// on every material re-open even within the same session (the effect only
// dedupes while the SAME material stays open, not across switching away and
// back). A material's underlying file never changes in place in this app
// (no "replace file" feature exists), so caching by id for the lifetime of
// the page is safe -- cleared naturally on reload, not persisted to
// localStorage (a full-text cache there would bloat it for no real benefit,
// since a fresh page load re-extracting once is not the complaint here).
const materialTextCache = new Map<string, MaterialTextResult>()

/**
 * Best-effort extraction of a material's actual readable content, so AI
 * features (study plan, per-material chat) work on what's really inside the
 * file — not just its title. Returns text:null when we honestly can't read
 * the format yet (images, docx, pptx, links whose page we can't fetch due
 * to CORS) — callers must say so rather than pretend they read it.
 */
export async function getMaterialText(material: Material): Promise<MaterialTextResult> {
  // Notes are live/editable (material.content can change between opens) --
  // caching would silently serve stale text after an edit. They're also
  // already cheap (no fetch, no parsing), so there's nothing to cache FOR.
  if (material.type !== 'file') return getMaterialTextUncached(material)
  const cached = materialTextCache.get(material.id)
  if (cached) return cached
  const result = await getMaterialTextUncached(material)
  // Never cache a failed read (text:null) -- a transient network hiccup
  // shouldn't become a permanent "can't read this" for the rest of the
  // session, and null results are cheap to retry anyway (no parsing done).
  if (result.text !== null) materialTextCache.set(material.id, result)
  return result
}

async function getMaterialTextUncached(material: Material): Promise<MaterialTextResult> {
  if (material.type === 'note') {
    return { text: material.content ?? '', truncated: false }
  }
  if (material.type !== 'file') {
    return { text: null, truncated: false }
  }

  const name = material.fileName?.toLowerCase() ?? ''

  try {
    if (name.endsWith('.pdf') || /\.(txt|md|markdown|csv|json)$/.test(name)) {
      const buf = await resolveMaterialArrayBuffer(material)
      if (!buf) return { text: null, truncated: false }
      if (name.endsWith('.pdf')) {
        const text = await extractPdfText(buf)
        return { text, truncated: text.length >= MAX_CHARS }
      }
      const text = new TextDecoder('utf-8').decode(buf)
      return { text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS }
    }
  } catch {
    return { text: null, truncated: false }
  }
  return { text: null, truncated: false }
}

export function isViewableInline(material: Material): 'pdf' | 'image' | 'text' | 'note' | null {
  if (material.type === 'note') return 'note'
  if (material.type !== 'file') return null
  const name = material.fileName?.toLowerCase() ?? ''
  if (name.endsWith('.pdf')) return 'pdf'
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(name)) return 'image'
  if (/\.(txt|md|markdown|csv|json)$/.test(name)) return 'text'
  return null
}
