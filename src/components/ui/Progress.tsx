import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from '../../lib/utils'

export function Progress({ value, className, indicatorClassName }: { value: number; className?: string; indicatorClassName?: string }) {
  return (
    <ProgressPrimitive.Root
      className={cn('relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]', className)}
      value={value}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full rounded-full bg-[var(--color-primary)] transition-transform duration-500 ease-out', indicatorClassName)}
        style={{ transform: `translateX(-${100 - Math.min(100, Math.max(0, value))}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}
