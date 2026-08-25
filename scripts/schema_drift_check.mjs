#!/usr/bin/env node
// Flags columns declared inside a `create table if not exists` body that
// (a) carry a dated comment right above them (this file's own convention
// for "added on YYYY-MM-DD", every real later-addition already follows it --
// see research_consent/skill_sharing_consent/events.type below) and (b)
// have no matching `alter table ... add column if not exists` companion
// anywhere in the file. That combination is the exact shape of three
// separate real bugs found in one day (2026-08-25): events.type,
// skills.domain+status, profiles.research_consent -- a column added to an
// existing table's CREATE TABLE body months after the table first shipped.
// On a project where the table already exists, create-table-if-not-exists
// is a no-op and silently never adds it -- syncUpsert's fail-open swallowed
// every one of these with no visible error until something finally forced
// a real sync attempt on that column.
//
// Same principle as tools/mirror_drift.py in the sibling cognitive_rpg
// project (warn on a structural gap instead of re-finding it by hand a
// fourth time), but simpler than that script's git-commit-time approach:
// tried git blame here first, dropped it -- this file gets hand-edited/
// reformatted as a whole, so a table's CREATE TABLE line and an old
// column's line can share the same commit as a column added years later,
// erasing the "when" signal blame relies on. The dated-comment convention
// this file already follows for every real later-addition is a more
// reliable signal here, and cheaper: no git subprocess at all.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SCHEMA_PATH = join(REPO_ROOT, 'supabase/schema.sql')
const sql = readFileSync(SCHEMA_PATH, 'utf8')

const CONSTRAINT_KEYWORDS = /^(primary\s+key|unique|check|foreign\s+key|constraint)\b/i
const DATED_COMMENT = /\(20\d\d-\d\d-\d\d/

// Blank out everything from the first "--" to end of line (whole-line
// comments AND trailing ones like "section_id uuid, -- ...(2026-08-21..."
// alike) before any comma/paren structural scan -- a comment's own commas
// and unbalanced parens otherwise corrupt both the split and the depth
// count for everything after it. Same length in, same length out --
// offsets into the blanked string are valid offsets into the real one, so
// chunk boundaries found here can slice the ORIGINAL body (comments intact)
// for the date check.
function blankCommentLines(text) {
  return text
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--')
      return idx === -1 ? line : line.slice(0, idx) + ' '.repeat(line.length - idx)
    })
    .join('\n')
}

// A chunk boundary that lands mid-line (right after "section_id uuid,"
// with an inline "-- ...(2026-08-21..." comment still trailing on that same
// line) would otherwise hand that leftover comment text to the START of
// the NEXT chunk instead of discarding it -- contaminating a column that
// has nothing to do with that date. Once a boundary is found, if the rest
// of ITS OWN line (per the structural, comment-blanked string) is blank,
// the next chunk starts at the following line instead of mid-line.
function splitTopLevel(structural, original) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < structural.length; i++) {
    const ch = structural[i]
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(original.slice(start, i))
      let next = i + 1
      const eol = structural.indexOf('\n', next)
      if (eol !== -1 && !structural.slice(next, eol).trim()) next = eol + 1
      start = next
    }
  }
  if (original.slice(start).trim()) parts.push(original.slice(start))
  return parts
}

// create table if not exists <name> ( ... ) -- brace-matched, not regex-only,
// since column bodies nest parens (check (x in (...)), default '[]', ...).
function findTableBodies(text) {
  const tables = []
  const re = /create\s+table\s+if\s+not\s+exists\s+(\w+)\s*\(/gi
  let m
  while ((m = re.exec(text))) {
    const name = m[1]
    const start = m.index + m[0].length
    let depth = 1
    let i = start
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth++
      if (text[i] === ')') depth--
      i++
    }
    tables.push({ name, body: text.slice(start, i - 1) })
  }
  return tables
}

// Each top-level chunk is 0+ comment lines followed by exactly one real
// column-definition line (or a pure constraint, skipped). The chunk itself
// -- comments included -- is what gets checked for a dated annotation.
function datedColumnsWithoutCompanion(body, tableName, alteredSet) {
  const findings = []
  for (const chunk of splitTopLevel(blankCommentLines(body), body)) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean)
    const declLine = lines.find((l) => !l.startsWith('--'))
    if (!declLine || CONSTRAINT_KEYWORDS.test(declLine)) continue
    const colMatch = declLine.match(/^"?(\w+)"?\s+\S/)
    if (!colMatch) continue
    const col = colMatch[1]
    if (alteredSet.has(`${tableName}.${col}`)) continue
    if (DATED_COMMENT.test(chunk)) findings.push(col)
  }
  return findings
}

function alteredColumns(text) {
  const set = new Set()
  // Both forms count as "the drift is covered": ADD COLUMN for a genuinely
  // new column, ALTER COLUMN ... TYPE for an existing one whose type
  // changed later (skills.id/derived_from's uuid -> text fix is this shape
  // -- see migration_2026-08-24c.sql -- and was a false positive here until
  // this regex learned to recognize it too).
  const addRe = /alter\s+table\s+(\w+)\s+add\s+column\s+if\s+not\s+exists\s+"?(\w+)"?/gi
  const typeRe = /alter\s+table\s+(\w+)\s+alter\s+column\s+"?(\w+)"?\s+type\b/gi
  let m
  while ((m = addRe.exec(text))) set.add(`${m[1]}.${m[2]}`)
  while ((m = typeRe.exec(text))) set.add(`${m[1]}.${m[2]}`)
  return set
}

const tables = findTableBodies(sql)
const altered = alteredColumns(sql)

const findings = []
for (const { name, body } of tables) {
  for (const col of datedColumnsWithoutCompanion(body, name, altered)) {
    findings.push(`${name}.${col}`)
  }
}

if (findings.length === 0) {
  console.log('[schema_drift] no dated column is missing its ALTER TABLE ADD COLUMN IF NOT EXISTS companion.')
} else {
  console.log(`[schema_drift] ${findings.length} column(s) with a dated "(YYYY-MM-DD...)" comment but no ALTER companion in schema.sql:`)
  for (const f of findings) console.log(`  - ${f}`)
  console.log("[schema_drift] Same shape as 2026-08-25's events.type / skills.domain+status / profiles.research_consent bugs --")
  console.log('[schema_drift] on a project where the table already exists, this column silently never gets added.')
}
