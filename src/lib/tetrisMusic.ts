// A small Web Audio chiptune sequencer playing the well-known Korobeiniki
// folk melody (public domain, 19th-century Russian tune — associated with
// Tetris, but no copyrighted recording/arrangement is used here, just the
// bare melody synthesized from scratch).
const NOTE_FREQ: Record<string, number> = {
  A4: 440,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  F5: 698.46,
  G5: 783.99,
  A5: 880,
}

// [note, duration in eighth-notes], 'R' = rest
const MELODY: [string, number][] = [
  ['E5', 2], ['B4', 1], ['C5', 1], ['D5', 2], ['C5', 1], ['B4', 1],
  ['A4', 2], ['A4', 1], ['C5', 1], ['E5', 2], ['D5', 1], ['C5', 1],
  ['B4', 3], ['C5', 1], ['D5', 2], ['E5', 2],
  ['C5', 2], ['A4', 2], ['A4', 2], ['R', 2],
  ['D5', 3], ['F5', 1], ['A5', 2], ['G5', 1], ['F5', 1],
  ['E5', 3], ['C5', 1], ['E5', 2], ['D5', 1], ['C5', 1],
  ['B4', 2], ['B4', 1], ['C5', 1], ['D5', 2], ['E5', 2],
  ['C5', 2], ['A4', 2], ['A4', 2], ['R', 2],
]

const EIGHTH_MS = 145
const MUTE_KEY = 'aria.tetrisMuted'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let playing = false
let timeoutId: number | null = null
let step = 0

function ensureCtx() {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0.06
    master.connect(ctx.destination)
  }
  return ctx
}

function playNote(freq: number, durationMs: number) {
  if (!ctx || !master || freq === 0) return
  const osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.value = freq
  const noteGain = ctx.createGain()
  const t0 = ctx.currentTime
  noteGain.gain.setValueAtTime(0.0001, t0)
  noteGain.gain.exponentialRampToValueAtTime(1, t0 + 0.015)
  noteGain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000)
  osc.connect(noteGain)
  noteGain.connect(master)
  osc.start(t0)
  osc.stop(t0 + durationMs / 1000)
}

function tick() {
  if (!playing || isMuted()) return
  const [note, beats] = MELODY[step % MELODY.length]
  const dur = beats * EIGHTH_MS
  playNote(NOTE_FREQ[note] ?? 0, dur * 0.85)
  step++
  timeoutId = window.setTimeout(tick, dur)
}

export function startMusic() {
  if (playing || isMuted()) return
  ensureCtx()
  if (ctx!.state === 'suspended') ctx!.resume()
  playing = true
  step = 0
  tick()
}

export function stopMusic() {
  playing = false
  if (timeoutId) window.clearTimeout(timeoutId)
  timeoutId = null
}

export function isMuted(): boolean {
  return localStorage.getItem(MUTE_KEY) === '1'
}

export function setMusicMuted(muted: boolean) {
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  if (muted) stopMusic()
}
