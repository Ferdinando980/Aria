import { useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { Card, CardTitle, CardSubtitle } from '../ui/Card'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/useAppStore'
import { useToastStore } from '../../store/toastStore'
import { celebrate } from '../../lib/celebrate'
import { useFocusStore } from '../../store/focusStore'

const PRESETS = [10, 25, 45]

const ENCOURAGEMENTS = [
  'Non deve essere perfetto, deve solo iniziare.',
  'Sto qui con te. Un minuto alla volta.',
  'Anche solo restare seduto qui conta.',
  'Va bene se la mente vaga: rimettila piano sul compito.',
]

export function FocusTimer() {
  const [minutes, setMinutes] = useState(25)
  const [secondsLeft, setSecondsLeft] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  const [message] = useState(ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)])
  const intervalRef = useRef<number | null>(null)
  const registerFocusSessionCompleted = useAppStore((s) => s.registerFocusSessionCompleted)
  const push = useToastStore((s) => s.push)
  const setFocusRunning = useFocusStore((s) => s.setRunning)

  useEffect(() => {
    setFocusRunning(running)
  }, [running, setFocusRunning])

  useEffect(() => () => setFocusRunning(false), [setFocusRunning])

  useEffect(() => {
    if (running) {
      intervalRef.current = window.setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            window.clearInterval(intervalRef.current!)
            setRunning(false)
            const result = registerFocusSessionCompleted()
            celebrate(result.leveledUp ? 'big' : 'small')
            push({ title: 'Sessione completata! 🎯', description: `+${result.xpGained} XP per esserti seduto e averci provato.`, tone: 'good' })
            return minutes * 60
          }
          return s - 1
        })
      }, 1000)
    }
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  function selectPreset(m: number) {
    setMinutes(m)
    setSecondsLeft(m * 60)
    setRunning(false)
  }

  const mm = Math.floor(secondsLeft / 60).toString().padStart(2, '0')
  const ss = (secondsLeft % 60).toString().padStart(2, '0')
  const progress = 1 - secondsLeft / (minutes * 60)

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <CardTitle>Focus Timer</CardTitle>
          <CardSubtitle>{message}</CardSubtitle>
        </div>
      </div>

      <div className="my-6 flex items-center justify-center">
        <div
          className="relative grid h-40 w-40 place-items-center rounded-full"
          style={{
            background: `conic-gradient(var(--color-primary) ${progress * 360}deg, var(--color-surface-2) 0deg)`,
          }}
        >
          <div className="grid h-32 w-32 place-items-center rounded-full bg-[var(--color-surface)]">
            <span className="text-3xl font-semibold tabular-nums">{mm}:{ss}</span>
          </div>
        </div>
      </div>

      <div className="mb-4 flex justify-center gap-2">
        {PRESETS.map((m) => (
          <button
            key={m}
            onClick={() => selectPreset(m)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              minutes === m ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]'
            }`}
          >
            {m} min
          </button>
        ))}
      </div>

      <div className="flex justify-center gap-3">
        <Button variant="soft" size="icon" onClick={() => selectPreset(minutes)}>
          <RotateCcw size={18} />
        </Button>
        <Button size="lg" className="w-36" onClick={() => setRunning((r) => !r)}>
          {running ? <Pause size={18} /> : <Play size={18} />}
          {running ? 'Pausa' : 'Inizia'}
        </Button>
      </div>
    </Card>
  )
}
