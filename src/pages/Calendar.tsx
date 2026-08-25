import { useMemo, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import itLocale from '@fullcalendar/core/locales/it'
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

  // Walked back (2026-08-25, real user pushback the SAME day on the redesign
  // right above this comment in git history: "non mi piace l'ui del
  // calendario... mi sembra tutto piu' disordinato... i quadrati andavano
  // bene di forma"). The card-grid/ticket-style version was a bigger swing
  // than asked for -- more competing colors and shapes read as MORE
  // cluttered, not better. Back to one accent color per chip (the subject's
  // own color, or warn for an exam) painted as a plain filled pill like the
  // very first version, still built from `extendedProps` in one place
  // (renderEventContent) so there's a single source of truth either way.
  const fcEvents = useMemo(() => {
    const fromEvents = events.map((e) => {
      const isExam = e.type === 'esame'
      const accentColor = isExam ? WARN_HEX : (e.color ?? PRIMARY_HEX)
      return {
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        borderColor: 'transparent',
        extendedProps: { isTask: false, isExam, accentColor, textColor: contrastTextColor(accentColor) },
      }
    })
    const fromTasks = tasks
      .filter((t) => t.dueDate)
      .map((t) => {
        const subjectColor = subjects.find((s) => s.id === t.subjectId)?.color ?? CALM_HEX
        return {
          id: TASK_ID_PREFIX + t.id,
          title: t.title + (t.estimateMinutes ? ` · ${t.estimateMinutes} min` : ''),
          start: t.dueDate,
          allDay: true,
          borderColor: 'transparent',
          durationEditable: false,
          extendedProps: { isTask: true, done: t.done, accentColor: subjectColor, textColor: contrastTextColor(subjectColor) },
        }
      })
    return [...fromEvents, ...fromTasks]
  }, [events, tasks, subjects])

  function renderEventContent(arg: EventContentArg) {
    const { isTask, isExam, accentColor, textColor, done } = arg.event.extendedProps as {
      isTask: boolean
      isExam: boolean
      accentColor: string
      textColor: string
      done?: boolean
    }
    return (
      <div className={`fc-chip${done ? ' fc-chip-done' : ''}`} style={{ background: accentColor, color: textColor }}>
        {isTask ? (
          <span
            className={`grid h-3 w-3 shrink-0 place-items-center rounded-full border ${done ? 'border-white/70 bg-white/70' : 'border-current'}`}
          >
            {done && <Check size={8} className="text-[var(--color-bg)]" />}
          </span>
        ) : isExam ? (
          <span className="fc-chip-icon">⚠</span>
        ) : null}
        <span className="fc-chip-title">{arg.event.title}</span>
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

      <Card className="p-2 sm:p-4">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,listWeek',
          }}
          locales={[itLocale]}
          locale="it"
          buttonText={{ today: 'oggi', month: 'mese', week: 'settimana', list: 'lista' }}
          height="auto"
          selectable
          editable
          selectMirror
          // Real user ask, twice the same day (2026-08-25): first "farei i
          // quadrati piu' grandi, così da permettere la visione di tutte le
          // task" (dayMaxEvents=3 hid most real days behind "+N more"), then
          // after a fixed-cap-of-8 attempt still felt cluttered: "i quadrati
          // andavano bene di forma, magari potevi fare che si espandevano
          // andandoci sopra" -- expand on hover instead of permanently
          // resizing the grid. `false` here means every task really is
          // rendered in the DOM for every day (no FC-side cap, no "+more"
          // link at all); calendar.css clips each day back down to its
          // normal size by default (overflow:hidden) and pops the hovered
          // day out full-height, scrollable, above its neighbors -- see
          // that file's comment on `.fc-daygrid-day:hover`. This is exactly
          // the earlier-rejected "whole row grows for one busy day" problem
          // turned into a feature: now only the ONE hovered cell grows,
          // every other day in that row stays its normal size.
          dayMaxEvents={false}
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
