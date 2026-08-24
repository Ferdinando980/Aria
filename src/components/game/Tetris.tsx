import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCw, ArrowLeft, ArrowRight, ArrowDown, ChevronsDown, Repeat, Volume2, VolumeX } from 'lucide-react'
import { Button } from '../ui/Button'
import { useGameStore } from '../../store/gameStore'
import { useFocusStore } from '../../store/focusStore'
import { supabase, isSupabaseConfigured } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { useAppStore } from '../../store/useAppStore'
import { uid, cn } from '../../lib/utils'
import { startMusic, stopMusic, isMuted, setMusicMuted } from '../../lib/tetrisMusic'

const COLS = 10
const ROWS = 20
const PREVIEW_COUNT = 3
const COLORS: Record<string, string> = {
  I: '#74B9FF',
  O: '#FDCB6E',
  T: '#A29BFE',
  S: '#55EFC4',
  Z: '#FF7675',
  J: '#6C5CE7',
  L: '#FAB1A0',
}
const SHAPES: Record<string, number[][]> = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
}
const PIECE_KEYS = Object.keys(SHAPES)

type Cell = string | null
type Piece = { key: string; cells: number[][]; x: number; y: number }

function emptyBoard(): Cell[][] {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null))
}

function shuffledBag(): string[] {
  const bag = [...PIECE_KEYS]
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  return bag
}

function spawnPiece(key: string): Piece {
  return { key, cells: SHAPES[key].map((c) => [...c]), x: 3, y: -1 }
}

function rotateCells(cells: number[][]): number[][] {
  // rotate 90° clockwise inside a 4x4 box
  return cells.map(([x, y]) => [3 - y, x])
}

function collides(board: Cell[][], cells: number[][], x: number, y: number) {
  for (const [cx, cy] of cells) {
    const px = x + cx
    const py = y + cy
    if (px < 0 || px >= COLS || py >= ROWS) return true
    if (py >= 0 && board[py][px]) return true
  }
  return false
}

const LINE_SCORES = [0, 100, 300, 500, 800]

function MiniPiece({ pieceKey }: { pieceKey: string | null }) {
  if (!pieceKey) return <div className="h-9 w-14" />
  const cells = SHAPES[pieceKey]
  const xs = cells.map((c) => c[0])
  const ys = cells.map((c) => c[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return (
    <div className="relative h-9 w-14">
      {cells.map(([x, y], i) => (
        <div
          key={i}
          className="absolute rounded-sm"
          style={{ left: (x - minX) * 13, top: (y - minY) * 13, width: 11, height: 11, background: COLORS[pieceKey] }}
        />
      ))}
    </div>
  )
}

export function Tetris({ onScoreSubmitted }: { onScoreSubmitted?: () => void }) {
  const [board, setBoard] = useState<Cell[][]>(emptyBoard)
  const [piece, setPiece] = useState<Piece>(() => spawnPiece('T'))
  const [queue, setQueue] = useState<string[]>([])
  const [hold, setHold] = useState<string | null>(null)
  const [holdUsed, setHoldUsed] = useState(false)
  const [score, setScore] = useState(0)
  const [lines, setLines] = useState(0)
  const [status, setStatus] = useState<'ready' | 'playing' | 'over' | 'timeup'>('ready')
  const [muted, setMuted] = useState(isMuted())
  const [banner, setBanner] = useState<string | null>(null)
  const bannerTimeout = useRef<number | null>(null)
  const prevLevel = useRef(1)
  const boardRef = useRef(board)
  boardRef.current = board
  const pieceRef = useRef(piece)
  pieceRef.current = piece
  const queueRef = useRef(queue)
  queueRef.current = queue
  const holdRef = useRef(hold)
  holdRef.current = hold
  const holdUsedRef = useRef(holdUsed)
  holdUsedRef.current = holdUsed
  const scoreSubmitted = useRef(false)

  const focusRunning = useFocusStore((s) => s.running)
  const secondsRemaining = useGameStore((s) => s.secondsRemaining())
  const addSecondsPlayed = useGameStore((s) => s.addSecondsPlayed)
  const registerScore = useGameStore((s) => s.registerScore)
  const bestScore = useGameStore((s) => s.bestScore)
  const session = useAuthStore((s) => s.session)
  const displayName = useAppStore((s) => s.profile.displayName)

  const locked = focusRunning || secondsRemaining <= 0

  const level = Math.floor(lines / 10) + 1
  const dropMs = Math.max(120, 800 - (level - 1) * 70)

  const showBanner = useCallback((text: string) => {
    setBanner(text)
    if (bannerTimeout.current) window.clearTimeout(bannerTimeout.current)
    bannerTimeout.current = window.setTimeout(() => setBanner(null), 900)
  }, [])

  const submitScore = useCallback(
    async (finalScore: number) => {
      if (scoreSubmitted.current) return
      scoreSubmitted.current = true
      registerScore(finalScore)
      if (!isSupabaseConfigured || !supabase || !session?.user.id || finalScore === 0) return
      try {
        await supabase.from('game_scores').insert({
          id: uid(),
          user_id: session.user.id,
          display_name: displayName?.trim() || 'Giocatore',
          score: finalScore,
        })
        onScoreSubmitted?.()
      } catch {
        // leaderboard is a bonus, never worth surfacing an error for
      }
    },
    [registerScore, session, displayName, onScoreSubmitted],
  )

  function takeFromQueue(): string {
    let q = queueRef.current
    if (q.length <= PREVIEW_COUNT) q = [...q, ...shuffledBag()]
    const [key, ...rest] = q
    queueRef.current = rest
    setQueue(rest)
    return key
  }

  function reset() {
    const initialQueue = [...shuffledBag(), ...shuffledBag()]
    const firstKey = initialQueue.shift()!
    setBoard(emptyBoard())
    setPiece(spawnPiece(firstKey))
    queueRef.current = initialQueue
    setQueue(initialQueue)
    setHold(null)
    setHoldUsed(false)
    setScore(0)
    setLines(0)
    scoreSubmitted.current = false
    setStatus('playing')
  }

  const lockPiece = useCallback(() => {
    const b = boardRef.current.map((row) => [...row])
    const p = pieceRef.current
    let toppedOut = false
    for (const [cx, cy] of p.cells) {
      const px = p.x + cx
      const py = p.y + cy
      if (py < 0) {
        toppedOut = true
        continue
      }
      b[py][px] = COLORS[p.key]
    }
    if (toppedOut) {
      setBoard(b)
      setStatus('over')
      submitScore(score)
      return
    }
    let cleared = 0
    const kept = b.filter((row) => {
      const full = row.every((c) => c)
      if (full) cleared++
      return !full
    })
    while (kept.length < ROWS) kept.unshift(Array<Cell>(COLS).fill(null))

    const gained = cleared > 0 ? LINE_SCORES[cleared] * level : 0
    if (cleared > 0) {
      setScore((s) => s + gained)
      setLines((l) => l + cleared)
      showBanner(['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS!'][cleared])
    }
    setBoard(kept)
    setHoldUsed(false)

    const nextKey = takeFromQueue()
    const spawned = spawnPiece(nextKey)
    if (collides(kept, spawned.cells, spawned.x, spawned.y)) {
      setPiece(spawned)
      setStatus('over')
      submitScore(score + gained)
      return
    }
    setPiece(spawned)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, level, submitScore])

  const move = useCallback(
    (dx: number, dy: number) => {
      if (status !== 'playing') return false
      const p = pieceRef.current
      const nx = p.x + dx
      const ny = p.y + dy
      if (collides(boardRef.current, p.cells, nx, ny)) return false
      setPiece({ ...p, x: nx, y: ny })
      return true
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [status],
  )

  const rotate = useCallback(() => {
    if (status !== 'playing') return
    const p = pieceRef.current
    if (p.key === 'O') return
    const rotated = rotateCells(p.cells)
    for (const nx of [0, -1, 1, -2, 2]) {
      if (!collides(boardRef.current, rotated, p.x + nx, p.y)) {
        setPiece({ ...p, cells: rotated, x: p.x + nx })
        return
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const hardDrop = useCallback(() => {
    if (status !== 'playing') return
    let dy = 0
    while (!collides(boardRef.current, pieceRef.current.cells, pieceRef.current.x, pieceRef.current.y + dy + 1)) dy++
    setPiece((p) => ({ ...p, y: p.y + dy }))
    requestAnimationFrame(() => lockPiece())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, lockPiece])

  const holdPiece = useCallback(() => {
    if (status !== 'playing' || holdUsedRef.current) return
    const current = pieceRef.current
    const swapKey = holdRef.current
    setHold(current.key)
    setHoldUsed(true)
    if (swapKey) {
      const swapped = spawnPiece(swapKey)
      if (!collides(boardRef.current, swapped.cells, swapped.x, swapped.y)) setPiece(swapped)
    } else {
      const nextKey = takeFromQueue()
      const spawned = spawnPiece(nextKey)
      if (!collides(boardRef.current, spawned.cells, spawned.x, spawned.y)) setPiece(spawned)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // gravity
  useEffect(() => {
    if (status !== 'playing' || locked) return
    const id = window.setInterval(() => {
      const p = pieceRef.current
      if (!collides(boardRef.current, p.cells, p.x, p.y + 1)) {
        setPiece({ ...p, y: p.y + 1 })
      } else {
        lockPiece()
      }
    }, dropMs)
    return () => window.clearInterval(id)
  }, [status, dropMs, locked, lockPiece])

  // level-up banner
  useEffect(() => {
    if (status === 'playing' && level > prevLevel.current) showBanner(`LIVELLO ${level}!`)
    prevLevel.current = level
  }, [level, status, showBanner])

  // background music: only while actually playing a round, and only if not muted
  useEffect(() => {
    if (status === 'playing' && !muted) startMusic()
    else stopMusic()
    return () => stopMusic()
  }, [status, muted])

  // daily time budget, ticks only while actually playing
  useEffect(() => {
    if (status !== 'playing' || locked) return
    const id = window.setInterval(() => addSecondsPlayed(1), 1000)
    return () => window.clearInterval(id)
  }, [status, locked, addSecondsPlayed])

  // force-stop if the daily budget runs out or a focus session starts elsewhere
  useEffect(() => {
    if (status === 'playing' && locked) {
      setStatus(secondsRemaining <= 0 ? 'timeup' : 'over')
      submitScore(score)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, status])

  // keyboard controls
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (status !== 'playing') return
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'c', 'C', 'Shift'].includes(e.key)) e.preventDefault()
      if (e.key === 'ArrowLeft') move(-1, 0)
      else if (e.key === 'ArrowRight') move(1, 0)
      else if (e.key === 'ArrowDown') move(0, 1)
      else if (e.key === 'ArrowUp' || e.key === 'x' || e.key === 'X') rotate()
      else if (e.key === ' ') hardDrop()
      else if (e.key === 'c' || e.key === 'C' || e.key === 'Shift') holdPiece()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, move, rotate, hardDrop, holdPiece])

  function toggleMute() {
    const next = !muted
    setMuted(next)
    setMusicMuted(next)
  }

  let ghostDy = 0
  while (!collides(board, piece.cells, piece.x, piece.y + ghostDy + 1)) ghostDy++

  const display = board.map((row) => [...row])
  const ghostSet = new Set<string>()
  if (ghostDy > 0) {
    for (const [cx, cy] of piece.cells) {
      const px = piece.x + cx
      const py = piece.y + cy + ghostDy
      if (py >= 0 && py < ROWS && px >= 0 && px < COLS) ghostSet.add(`${px}-${py}`)
    }
  }
  for (const [cx, cy] of piece.cells) {
    const px = piece.x + cx
    const py = piece.y + cy
    if (py >= 0 && py < ROWS && px >= 0 && px < COLS) display[py][px] = COLORS[piece.key]
  }

  if (status === 'ready' || status === 'over' || status === 'timeup') {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        {status === 'over' && (
          <>
            <p className="text-3xl font-semibold">{score}</p>
            <p className="text-sm text-[var(--color-ink-muted)]">{score >= bestScore && score > 0 ? 'Nuovo record! 🎉' : 'punteggio finale'}</p>
          </>
        )}
        {status === 'timeup' && (
          <p className="text-sm text-[var(--color-ink-muted)]">
            Tempo di gioco finito per oggi (punteggio: {score}). Domani si ricomincia — nel frattempo, che ne dici di un compito?
          </p>
        )}
        {status === 'ready' && (
          <p className="text-sm text-[var(--color-ink-muted)]">
            Frecce per muovere, freccia su per ruotare, spazio per far cadere, C per tenere da parte. Record:{' '}
            <strong className="text-[var(--color-ink)]">{bestScore}</strong>
          </p>
        )}
        {locked ? (
          <p className="text-xs text-[var(--color-ink-muted)]">
            {focusRunning ? 'Sbloccato quando il focus timer non è in corso.' : 'Minuti di gioco finiti per oggi.'}
          </p>
        ) : (
          <Button size="lg" onClick={reset}>
            {status === 'ready' ? 'Gioca' : 'Rigioca'}
          </Button>
        )}
        <button
          onClick={toggleMute}
          className="flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          {muted ? 'Musica disattivata' : 'Musica attiva'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full max-w-[260px] items-center justify-between text-sm">
        <span className="font-medium">Punti: {score}</span>
        <span className="text-[var(--color-ink-muted)]">Liv. {level}</span>
        <span className="tabular-nums text-[var(--color-ink-muted)]">{Math.ceil(secondsRemaining / 60)}m</span>
        <button onClick={toggleMute} className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" aria-label={muted ? 'Attiva musica' : 'Disattiva musica'}>
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>

      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-ink-muted)]">Tieni</span>
          <div className="grid h-11 w-16 place-items-center rounded-lg bg-[var(--color-surface-2)]">
            <MiniPiece pieceKey={hold} />
          </div>
        </div>

        <div
          className="relative grid overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] bg-[length:26px_26px]"
          style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, width: 260, height: 520 }}
        >
          {display.flatMap((row, y) =>
            row.map((cell, x) => {
              const isGhost = !cell && ghostSet.has(`${x}-${y}`)
              return (
                <div
                  key={`${x}-${y}`}
                  className={cn('m-[1px] rounded-[3px]', isGhost && 'border-2 border-dashed opacity-40')}
                  style={
                    cell
                      ? {
                          background: cell,
                          boxShadow: 'inset 2px 2px 0 rgba(255,255,255,0.35), inset -2px -2px 0 rgba(0,0,0,0.25)',
                        }
                      : isGhost
                        ? { borderColor: COLORS[piece.key] }
                        : undefined
                  }
                />
              )
            }),
          )}
          {banner && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="animate-pop rounded-lg bg-[var(--color-bg)]/80 px-3 py-1 text-lg font-bold tracking-wide text-[var(--color-accent)] shadow-lg">
                {banner}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-ink-muted)]">Prossimi</span>
          <div className="flex flex-col gap-1.5">
            {queue.slice(0, PREVIEW_COUNT).map((key, i) => (
              <div key={i} className="grid h-11 w-16 place-items-center rounded-lg bg-[var(--color-surface-2)]">
                <MiniPiece pieceKey={key} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid w-full max-w-[260px] grid-cols-5 gap-2">
        <Button variant="soft" size="icon" onClick={() => move(-1, 0)}>
          <ArrowLeft size={18} />
        </Button>
        <Button variant="soft" size="icon" onClick={rotate}>
          <RotateCw size={18} />
        </Button>
        <Button variant="soft" size="icon" onClick={() => move(1, 0)}>
          <ArrowRight size={18} />
        </Button>
        <Button variant="soft" size="icon" onClick={hardDrop}>
          <ChevronsDown size={18} />
        </Button>
        <Button variant="soft" size="icon" onClick={holdPiece} disabled={holdUsed}>
          <Repeat size={18} />
        </Button>
      </div>
      <button
        onClick={() => move(0, 1)}
        className="flex w-full max-w-[260px] items-center justify-center gap-1.5 rounded-xl bg-[var(--color-surface-2)] py-2 text-xs text-[var(--color-ink-muted)]"
      >
        <ArrowDown size={14} /> giù
      </button>
    </div>
  )
}
