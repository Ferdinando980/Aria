import { Fragment } from 'react'
import { MarkdownLite } from './MarkdownLite'
import { ChoiceCards } from './ChoiceCards'
import { PlaceValueBlocks } from './PlaceValueBlocks'

/**
 * Scans a text blob for the two opt-in structured conventions Cheat Study's
 * prompts can emit -- `[SCELTA]`/`[RISPOSTA]` (multiple choice) and
 * `[BLOCCHI] N` (base-10 place-value blocks) -- rendering each as its own
 * component and everything else through the normal MarkdownLite. Neither is
 * forced: a text with no `[SCELTA]`/`[BLOCCHI]` line renders exactly as
 * plain MarkdownLite would (2026-08-26, real user instruction: multiple
 * choice "solo dove ha senso... non serve forzarla").
 */

type RichSegment = { type: 'md'; text: string } | { type: 'choice'; options: { letter: string; text: string }[]; correct: string } | { type: 'blocks'; value: number; caption?: string }

function parseRich(text: string): RichSegment[] {
  const lines = text.split('\n')
  const segments: RichSegment[] = []
  let buffer: string[] = []
  const flush = () => {
    const joined = buffer.join('\n').trim()
    if (joined) segments.push({ type: 'md', text: joined })
    buffer = []
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    if (trimmed === '[SCELTA]') {
      let end = i + 1
      const optionLines: string[] = []
      while (end < lines.length && !/^\[RISPOSTA\]/.test(lines[end].trim())) {
        optionLines.push(lines[end])
        end++
      }
      if (end < lines.length) {
        const options = optionLines
          .map((l) => l.trim().match(/^\(([A-Za-z])\)\s*(.+)$/))
          .filter((m): m is RegExpMatchArray => !!m)
          .map((m) => ({ letter: m[1].toUpperCase(), text: m[2] }))
        const answerMatch = lines[end].trim().match(/^\[RISPOSTA\]\s*([A-Za-z])/)
        if (options.length >= 2 && answerMatch) {
          flush()
          segments.push({ type: 'choice', options, correct: answerMatch[1].toUpperCase() })
          i = end
          continue
        }
      }
      // Malformed block (no matching [RISPOSTA], or fewer than 2 parsed
      // options) -- falls through and gets treated as a normal text line
      // instead of silently dropping the model's output.
    }

    const blocksMatch = trimmed.match(/^\[BLOCCHI\]\s*(-?\d{1,3})(?:\s+(.*))?$/)
    if (blocksMatch) {
      flush()
      segments.push({ type: 'blocks', value: parseInt(blocksMatch[1], 10), caption: blocksMatch[2]?.trim() || undefined })
      continue
    }

    buffer.push(lines[i])
  }
  flush()
  return segments
}

export function RichBlock({ text }: { text: string }) {
  return (
    <>
      {parseRich(text).map((seg, i) => {
        if (seg.type === 'choice') return <ChoiceCards key={i} options={seg.options} correct={seg.correct} />
        if (seg.type === 'blocks') return <PlaceValueBlocks key={i} value={seg.value} caption={seg.caption} />
        return (
          <Fragment key={i}>
            <MarkdownLite text={seg.text} />
          </Fragment>
        )
      })}
    </>
  )
}
