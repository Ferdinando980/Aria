import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useAppStore } from '../../store/useAppStore'
import { useToastStore } from '../../store/toastStore'

// Persistent capture point, reachable from any screen: for ADHD, if a
// thought isn't captured within a few seconds it's often gone for good.
export function QuickAdd() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState<'oggi' | 'domani' | 'senza data'>('oggi')
  const addTask = useAppStore((s) => s.addTask)
  const push = useToastStore((s) => s.push)

  function dueDateFor(w: typeof when) {
    if (w === 'senza data') return undefined
    const d = new Date()
    if (w === 'domani') d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  }

  function submit() {
    if (!title.trim()) return
    addTask({ title: title.trim(), priority: 'media', dueDate: dueDateFor(when) })
    push({ title: 'Catturato ✓', description: `"${title.trim()}" è al sicuro nella lista.`, tone: 'good' })
    setTitle('')
    setWhen('oggi')
    setOpen(false)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Aggiungi rapido"
        className="fixed bottom-20 right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-[var(--color-primary)] text-white shadow-2xl shadow-[color-mix(in_srgb,var(--color-primary)_45%,transparent)] transition-transform active:scale-90 lg:bottom-6 lg:right-6"
      >
        <Plus size={26} />
      </button>

      <Dialog open={open} onOpenChange={setOpen} title="Cattura al volo" description="Scrivi anche solo due parole: puoi sistemarlo dopo.">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="flex flex-col gap-4"
        >
          <Input
            autoFocus
            placeholder="Es. ripassare capitolo 3..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="flex gap-2">
            {(['oggi', 'domani', 'senza data'] as const).map((w) => (
              <button
                type="button"
                key={w}
                onClick={() => setWhen(w)}
                className={`flex-1 rounded-xl border px-2 py-2 text-xs font-medium capitalize transition-colors ${
                  when === w
                    ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_18%,transparent)] text-[var(--color-ink)]'
                    : 'border-[var(--color-border)] text-[var(--color-ink-muted)]'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
          <Button type="submit" size="lg" disabled={!title.trim()}>
            Salva
          </Button>
        </form>
      </Dialog>
    </>
  )
}
