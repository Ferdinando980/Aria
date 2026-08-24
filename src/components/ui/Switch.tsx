import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '../../lib/utils'

export function Switch({ checked, onCheckedChange, className }: { checked: boolean; onCheckedChange: (v: boolean) => void; className?: string }) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn(
        'relative h-6 w-10 shrink-0 rounded-full bg-[var(--color-border)] transition-colors data-[state=checked]:bg-[var(--color-primary)]',
        className,
      )}
    >
      <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  )
}
