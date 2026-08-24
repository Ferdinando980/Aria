import { useState } from 'react'
import { Trophy, Sparkles } from 'lucide-react'
import { Tetris } from '../components/game/Tetris'
import { Leaderboard } from '../components/game/Leaderboard'

export default function Game() {
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="min-h-dvh bg-[var(--color-bg)] px-4 py-8">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 sm:flex-row sm:items-start sm:justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[var(--color-primary)]" />
            <h1 className="text-lg font-semibold">Pausa gioco</h1>
          </div>
          <Tetris onScoreSubmitted={() => setRefreshKey((k) => k + 1)} />
        </div>

        <div className="w-full max-w-[260px]">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)]">
            <Trophy size={12} /> Classifica
          </div>
          <Leaderboard refreshKey={refreshKey} />
        </div>
      </div>
    </div>
  )
}
