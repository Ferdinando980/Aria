import { useMemo, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import type { DateSelectArg, EventClickArg, EventContentArg } from '@fullcalendar/core'
import { Check } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { EventDialog } from '../components/calendar/EventDialog'
import { useAppStore } from '../store/useAppStore'
import { useCompleteTask } from '../lib/useCompleteTask'
import type { CalendarEvent } from '../lib/types'
import { contrastTextColor } from '../lib/utils'
import './calendar.css'

// Real user request (2026-08-24): "voglio che escano le task vere che poi
// vedrò nella sezione oggi" -- a prior attempt aggregated the day's study-plan
// steps into one generic "Piano di studio — N passi" calendar entry per day;
// explicitly rejected ("non si capisce nulla così"). Every Task with a
// dueDate (not just ones a study plan created) now renders as ITS OWN
// calendar entry, same title/minutes a user would see in "Oggi" -- one
// consistent list of what to do, viewable either by day (Oggi) or by month
// (here), never two different summaries of the same thing.
const TASK_ID_PREFIX = 'task:'

export default function CalendarPage() {
  const events = useAppStore((s) => s.events)
  const tasks = useAppStore((s) => s.tasks)
  const subjects = useAppStore((s) => s.subjects)
  const updateEvent = useAppStore((s) => s.updateEvent)
  const updateTask = useAppStore((s) => s.updateTask)
  const completeTask = useCompleteTask()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [initialStart, setInitialStart] = useState<Date | undefined>()
  const [initialAllDay, setInitialAllDay] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)

  // contrastTextColor() only resolves real hex -- these are the fixed dark-
  // theme hex values behind the two CSS custom properties used as fallback
  // backgrounds below (see the app's single dark palette, no light theme
  // yet). Kept only for the text-color computation; the actual
  // backgroundColor still uses the CSS var so it keeps tracking the theme.
  const WARN_HEX = '#ffb26b'
  const PRIMARY_HEX = '#6c5ce7'
  const CALM_HEX = '#74b9ff'

  const fcEvents = useMemo(() => {
    const fromEvents = events.map((e) => {
      const isExam = e.type === 'esame'
      const backgroundColor = isExam ? 'var(--color-warn)' : (e.color ?? 'var(--color-primary)')
      // Real bug fix (2026-08-21, user report: "i tag non funzionano
      // benissimo, di colore") -- text color used to just inherit the
      // theme's light default, unreadable on lighter Subject colors
      // (amber, mint, light blue...) at this event-chip size. Compute per
      // event instead of assuming white always works.
      const textColorSource = isExam ? WARN_HEX : (e.color ?? PRIMARY_HEX)
      return {
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        backgroundColor,
        textColor: contrastTextColor(textColorSource),
        borderColor: 'transparent',
        extendedProps: { isTask: false },
      }
    })
    const fromTasks = tasks
      .filter((t) => t.dueDate)
      .map((t) => {
        const subjectColor = subjects.find((s) => s.id === t.subjectId)?.color
        const backgroundColor = subjectColor ?? 'var(--color-calm)'
        return {
          id: TASK_ID_PREFIX + t.id,
          title: t.title + (t.estimateMinutes ? ` · ${t.estimateMinutes} min` : ''),
          start: t.dueDate,
          allDay: true,
          backgroundColor,
          textColor: contrastTextColor(subjectColor ?? CALM_HEX),
          borderColor: 'transparent',
          classNames: t.done ? ['fc-task-done'] : [],
          durationEditable: false,
          extendedProps: { isTask: true, done: t.done },
        }
      })
    return [...fromEvents, ...fromTasks]
  }, [events, tasks, subjects])

  function renderEventContent(arg: EventContentArg) {
    if (!arg.event.extendedProps.isTask) return undefined
    return (
      <div className="flex items-center gap-1 overflow-hidden px-0.5">
        <span
          className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${arg.event.extendedProps.done ? 'border-white/70 bg-white/70' : 'border-current'}`}
        >
          {arg.event.extendedProps.done && <Check size={9} className="text-[var(--color-bg)]" />}
        </span>
        <span className="truncate">{arg.event.title}</span>
      </div>
    )
  }

  function onSelect(arg: DateSelectArg) {
    setEditingEvent(null)
    setInitialStart(arg.start)
    // Real bug fix (2026-08-21, user report: "non mi piace la giornata
    // messa"): clicking a plain day cell in month view always defaulted to
    // a midnight-start TIMED event (no "tutto il giorno" concept existed at
    // all) -- FullCalendar then shows a stray time indicator ("0", i.e.
    // 00:00) before every event's title, on every single event created this
    // way. arg.allDay is FullCalendar's own signal for whether the
    // selection was a whole day cell (dayGridMonth) vs a specific time slot
    // (timeGridWeek) -- use it to default the new "tutto il giorno" toggle
    // in EventDialog instead of silently forcing a fake midnight time.
    setInitialAllDay(arg.allDay)
    setDialogOpen(true)
  }

  function onEventClick(arg: EventClickArg) {
    // Real user request (2026-08-24): tasks shown here are the same ones
    // in "Oggi" -- clicking one here completes it right away (one-way, same
    // as everywhere else a Task gets checked off in this app) instead of
    // opening the (event-only) edit dialog, which doesn't apply to a task.
    if (arg.event.extendedProps.isTask) {
      const id = arg.event.id.slice(TASK_ID_PREFIX.length)
      if (!arg.event.extendedProps.done) completeTask(id)
      return
    }
    const found = events.find((e) => e.id === arg.event.id)
    if (found) {
      setEditingEvent(found)
      setDialogOpen(true)
    }
  }

  function onEventDrop(arg: any) {
    const id = arg.event.id as string
    if (arg.event.extendedProps.isTask) {
      // Local date parts, not toISOString().slice(0, 10) -- Task.dueDate is
      // a bare "date-only" string with no timezone conversion expected;
      // going through toISOString() on a local-midnight allDay Date can
      // shift the date by a day in negative-UTC-offset timezones (same
      // class of bug already fixed for CalendarEvent's allDay handling
      // elsewhere in this app, see CLAUDE.md's calendar "0" bug note).
      const d: Date | null = arg.event.start
      if (d) {
        const pad = (n: number) => String(n).padStart(2, '0')
        updateTask(id.slice(TASK_ID_PREFIX.length), { dueDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` })
      }
      return
    }
    updateEvent(id, {
      start: arg.event.start?.toISOString(),
      end: arg.event.end?.toISOString() ?? undefined,
    })
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Calendario</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Tocca un giorno per aggiungere, trascina per spostare. I task con una data (anche quelli del piano di studio) sono qui — clicca per spuntarli.
        </p>
      </div>

      <Card className="overflow-hidden p-2 sm:p-4">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,listWeek',
          }}
          locale="it"
          buttonText={{ today: 'oggi', month: 'mese', week: 'settimana', list: 'lista' }}
          height="auto"
          selectable
          editable
          selectMirror
          // Real user request (2026-08-25): "farei i quadrati piu' grandi,
          // così da permettere la visione di tutte le task" -- dayMaxEvents=3
          // meant almost every real day (a study plan alone can put 6+ tasks
          // on one day) collapsed behind a "+N more" popover. Tried `false`
          // (no cap) first -- rejected after a live check: FullCalendar's
          // daygrid stretches a whole week's row to match its tallest day,
          // so one exam-eve day with 15 tasks made an entire row enormous,
          // the opposite of "quadrati piu' grandi" for every other day in
          // it. A generous fixed cap covers real days directly (the real
          // data checked live topped out at 6 on a normal day) while still
          // bounding the pathological case behind "+more", same safety
          // valve as before just far less eager to use it.
          dayMaxEvents={8}
          events={fcEvents}
          eventContent={renderEventContent}
          select={onSelect}
          eventClick={onEventClick}
          eventDrop={onEventDrop}
          eventResize={onEventDrop}
        />
      </Card>

      <EventDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o)
          if (!o) setEditingEvent(null)
        }}
        initialStart={initialStart}
        initialAllDay={initialAllDay}
        editingEvent={editingEvent}
      />
    </div>
  )
}
