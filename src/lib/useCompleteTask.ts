import { useAppStore } from '../store/useAppStore'
import { useToastStore } from '../store/toastStore'
import { celebrate } from './celebrate'

const DONE_MESSAGES = [
  'Fatto! Un passo in più.',
  'Ottimo, questo è andato.',
  'Bel colpo. Continua così.',
  'Segnato. Procedi con calma.',
  'Sì! Ne è valsa la pena.',
]

export function useCompleteTask() {
  const completeTask = useAppStore((s) => s.completeTask)
  const push = useToastStore((s) => s.push)

  return (id: string) => {
    const result = completeTask(id)
    if (result.xpGained === 0) return

    celebrate(result.leveledUp ? 'big' : 'small')

    const msg = DONE_MESSAGES[Math.floor(Math.random() * DONE_MESSAGES.length)]
    if (result.leveledUp) {
      push({ title: `Livello superato! 🎉`, description: `+${result.xpGained} XP — stai costruendo qualcosa di solido.`, tone: 'good' })
    } else if (result.usedFreeze) {
      push({ title: msg, description: 'Avevi saltato un giorno: ho usato un salvastreak, nessun problema.', tone: 'info' })
    } else if (result.streakChanged) {
      push({ title: msg, description: `Streak: ${result.newStreak} giorni. +${result.xpGained} XP`, tone: 'good' })
    } else {
      push({ title: msg, description: `+${result.xpGained} XP`, tone: 'good' })
    }
  }
}
