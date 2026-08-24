import { CheckCircle2, Info, AlertTriangle, X } from 'lucide-react'
import { useToastStore } from '../../store/toastStore'
import { cn } from '../../lib/utils'

const icons = {
  good: <CheckCircle2 size={18} className="text-[var(--color-good)]" />,
  info: <Info size={18} className="text-[var(--color-calm)]" />,
  warn: <AlertTriangle size={18} className="text-[var(--color-warn)]" />,
}

export function Toaster() {
  const { toasts, dismiss } = useToastStore()
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3 sm:top-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'animate-pop pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 shadow-xl',
          )}
        >
          <div className="mt-0.5 shrink-0">{icons[t.tone]}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--color-ink)]">{t.title}</p>
            {t.description && <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{t.description}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="shrink-0 rounded-md p-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
