import { create } from 'zustand'

// Shared so the game (which now lives in its own browser tab) knows when a
// focus session is running in the main app tab. zustand state alone doesn't
// cross tabs, so this mirrors into localStorage and listens for the
// "storage" event, which fires in every OTHER tab whenever it changes here.
const KEY = 'aria.focusRunning'

function readRunning() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

interface FocusRunState {
  running: boolean
  setRunning: (running: boolean) => void
}

export const useFocusStore = create<FocusRunState>((set) => ({
  running: readRunning(),
  setRunning: (running) => {
    try {
      localStorage.setItem(KEY, running ? '1' : '0')
    } catch {
      // ignore — worst case the lock just doesn't sync across tabs
    }
    set({ running })
  },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) useFocusStore.setState({ running: e.newValue === '1' })
  })
}
