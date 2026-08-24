import { useState } from 'react'
import { ChevronDown, ChevronRight, Sparkles, Trash2 } from 'lucide-react'
import type { Task } from '../../lib/types'
import { useAppStore } from '../../store/useAppStore'
import { useCompleteTask } from '../../lib/useCompleteTask'
import { cn } from '../../lib/utils'
import { Link } from 'react-router-dom'

const priorityColor: Record<Task['priority'], string> = {
  bassa: 'var(--color-calm)',
  media: 'var(--color-accent)',
  alta: 'var(--color-warn)',
}

export function TaskItem({ task }: { task: Task }) {
  const [expanded, setExpanded] = useState(false)
  const toggleSubtask = useAppStore((s) => s.toggleSubtask)
  const removeTask = useAppStore((s) => s.removeTask)
  const complete = useCompleteTask()

  const hasSubtasks = task.subtasks.length > 0
  const doneSubtasks = task.subtasks.filter((s) => s.done).length

  return (
    <div className={cn('group rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 transition-opacity', task.done && 'opacity-50')}>
      <div className="flex items-start gap-3">
        <button
          onClick={() => !task.done && complete(task.id)}
          aria-label={task.done ? 'Completato' : 'Segna come completato'}
          className={cn(
            'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors',
            task.done ? 'border-[var(--color-good)] bg-[var(--color-good)]' : 'border-[var(--color-border)] hover:border-[var(--color-primary)]',
          )}
        >
          {task.done && <span className="text-[11px] text-[var(--color-bg)]">✓</span>}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn('truncate text-sm font-medium text-[var(--color-ink)]', task.done && 'line-through')}>{task.title}</p>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: priorityColor[task.priority] }} />
          </div>
          {task.description && <p className="mt-0.5 truncate text-xs text-[var(--color-ink-muted)]">{task.description}</p>}

          <div className="mt-1.5 flex items-center gap-3">
            {hasSubtasks && (
              <button onClick={() => setExpanded((e) => !e)} className="flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {doneSubtasks}/{task.subtasks.length} passi
              </button>
            )}
            {!hasSubtasks && !task.done && (
              <Link to="/aria" state={{ prefill: `Aiutami a spezzare in piccoli passi questo compito: "${task.title}"` }} className="flex items-center gap-1 text-xs text-[var(--color-primary)] opacity-0 transition-opacity group-hover:opacity-100">
                <Sparkles size={13} /> Spezza con Aria
              </Link>
            )}
          </div>

          {expanded && hasSubtasks && (
            <ul className="mt-2 flex flex-col gap-1.5 border-l border-[var(--color-border)] pl-3">
              {task.subtasks.map((st) => (
                <li key={st.id} className="flex items-center gap-2">
                  <button
                    onClick={() => toggleSubtask(task.id, st.id)}
                    className={cn(
                      'grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors',
                      st.done ? 'border-[var(--color-good)] bg-[var(--color-good)]' : 'border-[var(--color-border)]',
                    )}
                  >
                    {st.done && <span className="text-[9px] text-[var(--color-bg)]">✓</span>}
                  </button>
                  <span className={cn('text-xs text-[var(--color-ink-muted)]', st.done && 'line-through')}>{st.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button onClick={() => removeTask(task.id)} className="shrink-0 rounded-lg p-1.5 text-[var(--color-ink-muted)] opacity-0 transition-opacity hover:text-[var(--color-warn)] group-hover:opacity-100">
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  )
}
