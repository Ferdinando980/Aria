import { useEffect, useState } from 'react'
import { GraduationCap } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { Input, Textarea } from '../ui/Input'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/useAppStore'
import { contrastTextColor } from '../../lib/utils'
import type { CalendarEvent } from '../../lib/types'

function toLocalInput(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toLocalDate(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function EventDialog({
  open,
  onOpenChange,
  initialStart,
  initialAllDay,
  editingEvent,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initialStart?: Date
  initialAllDay?: boolean
  editingEvent?: CalendarEvent | null
}) {
  const subjects = useAppStore((s) => s.subjects)
  const addEvent = useAppStore((s) => s.addEvent)
  const updateEvent = useAppStore((s) => s.updateEvent)
  const removeEvent = useAppStore((s) => s.removeEvent)

  const [title, setTitle] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [subjectId, setSubjectId] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [isExam, setIsExam] = useState(false)
  // "Tutto il giorno" (2026-08-21, real bug fix -- see Calendar.tsx's
  // onSelect comment): this concept didn't exist at all before -- every
  // event, even one created by clicking a bare day cell in month view, was
  // forced into a fake midnight-to-1am timed slot, which FullCalendar then
  // shows as a stray "0:00" time prefix on every single event. Defaults
  // from FullCalendar's own arg.allDay signal (a day-cell click vs a
  // specific time-slot click), editable either way.
  const [isAllDay, setIsAllDay] = useState(false)

  useEffect(() => {
    if (editingEvent) {
      setTitle(editingEvent.title)
      setIsAllDay(Boolean(editingEvent.allDay))
      setStart(editingEvent.allDay ? toLocalDate(editingEvent.start) : toLocalInput(editingEvent.start))
      setEnd(editingEvent.allDay ? toLocalDate(editingEvent.end) : toLocalInput(editingEvent.end))
      setSubjectId(editingEvent.subjectId ?? '')
      setNotes(editingEvent.notes ?? '')
      setIsExam(editingEvent.type === 'esame')
    } else if (initialStart) {
      setTitle('')
      setIsAllDay(Boolean(initialAllDay))
      setStart(initialAllDay ? toLocalDate(initialStart.toISOString()) : toLocalInput(initialStart.toISOString()))
      if (initialAllDay) {
        setEnd('')
      } else {
        const endDate = new Date(initialStart.getTime() + 60 * 60000)
        setEnd(toLocalInput(endDate.toISOString()))
      }
      setSubjectId('')
      setNotes('')
      setIsExam(false)
    }
  }, [editingEvent, initialStart, initialAllDay, open])

  function submit() {
    if (!title.trim() || !start) return
    const subject = subjects.find((s) => s.id === subjectId)
    const payload = {
      title: title.trim(),
      start: isAllDay ? new Date(`${start}T00:00`).toISOString() : new Date(start).toISOString(),
      end: end ? (isAllDay ? new Date(`${end}T00:00`).toISOString() : new Date(end).toISOString()) : undefined,
      allDay: isAllDay,
      subjectId: subjectId || undefined,
      color: subject?.color,
      notes: notes || undefined,
      type: isExam ? ('esame' as const) : ('evento' as const),
    }
    if (editingEvent) updateEvent(editingEvent.id, payload)
    else addEvent(payload)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={editingEvent ? 'Modifica evento' : 'Nuovo evento'}>
      <div className="flex flex-col gap-3">
        <Input placeholder="Titolo" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <button
          onClick={() => {
            const nextAllDay = !isAllDay
            setIsAllDay(nextAllDay)
            // Reformat what's already typed instead of clearing it -- switching
            // the toggle shouldn't discard a date the person already picked.
            setStart((v) => (v ? (nextAllDay ? v.slice(0, 10) : `${v.slice(0, 10)}T09:00`) : v))
            setEnd((v) => (v ? (nextAllDay ? v.slice(0, 10) : `${v.slice(0, 10)}T10:00`) : v))
          }}
          className={`flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-xs font-medium ${isAllDay ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]'}`}
        >
          Tutto il giorno
        </button>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
            Inizio
            <input
              type={isAllDay ? 'date' : 'datetime-local'}
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="h-11 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
            Fine
            <input
              type={isAllDay ? 'date' : 'datetime-local'}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="h-11 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSubjectId('')}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${subjectId === '' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]'}`}
          >
            Nessuna materia
          </button>
          {subjects.map((s) => (
            <button
              key={s.id}
              onClick={() => setSubjectId(s.id)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
              style={{
                background: subjectId === s.id ? s.color : 'var(--color-surface-2)',
                // Real bug fix (2026-08-21): hardcoded white was unreadable
                // on lighter Subject colors -- see lib/utils.ts's
                // contrastTextColor().
                color: subjectId === s.id ? contrastTextColor(s.color) : 'var(--color-ink-muted)',
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: subjectId === s.id ? contrastTextColor(s.color) : s.color }} />
              {s.name}
            </button>
          ))}
        </div>

        <button
          onClick={() => setIsExam((v) => !v)}
          className={`flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-xs font-medium ${isExam ? 'bg-[var(--color-warn)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]'}`}
          title="Segna come data d'esame — il piano di studio della materia ne terrà conto"
        >
          <GraduationCap size={14} /> È una data d'esame
        </button>

        <Textarea placeholder="Note (facoltativo)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />

        <div className="mt-1 flex gap-2">
          {editingEvent && (
            <Button
              variant="danger"
              onClick={() => {
                removeEvent(editingEvent.id)
                onOpenChange(false)
              }}
            >
              Elimina
            </Button>
          )}
          <Button className="flex-1" onClick={submit} disabled={!title.trim() || !start}>
            Salva
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
