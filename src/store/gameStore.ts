import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const DAILY_LIMIT_SECONDS = 10 * 60

function today() {
  return new Date().toISOString().slice(0, 10)
}

interface GameState {
  playDate: string
  secondsPlayedToday: number
  bestScore: number
  addSecondsPlayed: (n: number) => void
  registerScore: (score: number) => void
  secondsRemaining: () => number
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      playDate: today(),
      secondsPlayedToday: 0,
      bestScore: 0,
      addSecondsPlayed: (n) => {
        const state = get()
        const isNewDay = state.playDate !== today()
        set({
          playDate: today(),
          secondsPlayedToday: (isNewDay ? 0 : state.secondsPlayedToday) + n,
        })
      },
      registerScore: (score) => {
        if (score > get().bestScore) set({ bestScore: score })
      },
      secondsRemaining: () => {
        const state = get()
        const played = state.playDate === today() ? state.secondsPlayedToday : 0
        return Math.max(0, DAILY_LIMIT_SECONDS - played)
      },
    }),
    { name: 'aria-game-storage' },
  ),
)
