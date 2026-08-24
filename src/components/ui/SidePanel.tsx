import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

export function SidePanel({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  subtitle?: ReactNode
  children: ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl',
            'data-[state=open]:animate-pop',
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="truncate text-base font-semibold text-[var(--color-ink)]">{title}</DialogPrimitive.Title>
              {subtitle && <DialogPrimitive.Description className="mt-0.5 truncate text-xs text-[var(--color-ink-muted)]">{subtitle}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="shrink-0 rounded-lg p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]">
              <X size={18} />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
