// Regenerates the "ogni superficie AI dell'app" domain list inside README.md
// from the real SkillDomain type + DOMAIN_LABEL map in the source -- not
// hand-typed. This exists because that exact list went stale for real once
// already (2026-08-21): three Gemini call sites -- generateChapters,
// generateFlashcards, generateSummary -- were completely unrouted and
// uninstrumented for a while before anyone grepped the codebase and noticed.
// A README that lists domains by hand can silently fall behind the same way
// again; this can't, because it reads the same two files the app itself
// reads. No LLM calls, pure text parsing, mirrors cognitive_rpg's
// experiment/readme_update.py in spirit (zero-cost, marker-delimited,
// idempotent).
//
// Run: node scripts/readme_update.mjs
// Writes README.md in place (only the block between the AUTO:DOMAINS markers).

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const MARKER_START = '<!-- AUTO:DOMAINS:START -->'
const MARKER_END = '<!-- AUTO:DOMAINS:END -->'

function readDomains() {
  const typesSrc = readFileSync(path.join(ROOT, 'src/lib/types.ts'), 'utf-8')
  const domainLine = typesSrc.match(/export type SkillDomain\s*=\s*(.+)/)
  if (!domainLine) throw new Error('SkillDomain type not found in src/lib/types.ts -- did it move?')
  const domains = [...domainLine[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  if (domains.length === 0) throw new Error('SkillDomain union parsed to zero members -- regex is probably stale')
  return domains
}

function readLabels() {
  const settingsSrc = readFileSync(path.join(ROOT, 'src/pages/Settings.tsx'), 'utf-8')
  const block = settingsSrc.match(/const DOMAIN_LABEL:[^{]*\{([^}]*)\}/)
  if (!block) throw new Error('DOMAIN_LABEL map not found in src/pages/Settings.tsx -- did it move?')
  const labels = {}
  for (const m of block[1].matchAll(/(\w+):\s*'([^']*)'/g)) labels[m[1]] = m[2]
  return labels
}

function lowerFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

function italianList(items) {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}

function buildDomainList() {
  const domains = readDomains()
  const labels = readLabels()
  const readable = domains.map((d) => lowerFirst(labels[d] ?? d))
  return italianList(readable)
}

function updateReadme() {
  const readmePath = path.join(ROOT, 'README.md')
  const text = readFileSync(readmePath, 'utf-8')
  const start = text.indexOf(MARKER_START)
  const end = text.indexOf(MARKER_END)
  if (start === -1 || end === -1) {
    throw new Error(`README.md is missing ${MARKER_START}/${MARKER_END} markers -- add them once by hand first.`)
  }
  const replacement = MARKER_START + buildDomainList() + MARKER_END
  const newText = text.slice(0, start) + replacement + text.slice(end + MARKER_END.length)
  const changed = newText !== text
  if (changed) writeFileSync(readmePath, newText, 'utf-8')
  return changed
}

const changed = updateReadme()
console.log(`[readme_update] ${changed ? 'README.md aggiornato.' : 'README.md già allineato al codice, nessuna modifica.'}`)
