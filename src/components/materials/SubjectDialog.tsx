import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/useAppStore'
import { useToastStore } from '../../store/toastStore'

const COLORS = ['#6C5CE7', '#FDE06D', '#55EFC4', '#74B9FF', '#FF7675', '#A29BFE', '#00CEC9', '#FAB1A0'] // first two kept in sync with index.css's --color-primary/--color-accent
const ICONS = ['book', 'flask', 'calculator', 'globe', 'code', 'palette', 'music', 'dumbbell']

export function SubjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const addSubject = useAppStore((s) => s.addSubject)
  const push = useToastStore((s) => s.push)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [icon, setIcon] = useState(ICONS[0])

  function submit() {
    if (!name.trim()) return
    const { recognizedSkillCount } = addSubject(name.trim(), color, icon)
    if (recognizedSkillCount > 0) {
      // Area-of-interest recognition (2026-08-21): this Subject's name
      // matched something archived by a past Subject deletion -- the
      // recognized skills are back in the library as DRAFT, re-earning
      // trust from here through the normal reviewSkills() gate. Worth a
      // toast: it's a meaningful, easy-to-miss event, not routine.
      push({
        title: recognizedSkillCount === 1 ? 'Ritrovata 1 skill da un\'area simile' : `Ritrovate ${recognizedSkillCount} skill da un'area simile`,
        description: 'Torna a farsi verificare dall\'uso reale prima di essere di nuovo affidabile.',
        tone: 'good',
      })
    }
    setName('')
    setColor(COLORS[0])
    setIcon(ICONS[0])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Nuova materia" description="Un contenitore per lezioni, appunti e link.">
      <div className="flex flex-col gap-4">
        <Input placeholder="Es. Analisi 1, Storia dell'arte..." value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div>
          <p className="mb-2 text-xs text-[var(--color-ink-muted)]">Colore</p>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="h-8 w-8 rounded-full transition-transform"
                style={{ background: c, outline: color === c ? `2px solid ${c}` : 'none', outlineOffset: 2, transform: color === c ? 'scale(1.1)' : undefined }}
              />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs text-[var(--color-ink-muted)]">Icona</p>
          <div className="flex flex-wrap gap-2">
            {ICONS.map((i) => (
              <button
                key={i}
                onClick={() => setIcon(i)}
                className={`rounded-lg px-2.5 py-1.5 text-xs capitalize ${icon === i ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]'}`}
              >
                {i}
              </button>
            ))}
          </div>
        </div>
        <Button onClick={submit} disabled={!name.trim()} size="lg">
          Crea materia
        </Button>
      </div>
    </Dialog>
  )
}
