import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-2xl font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none select-none',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--color-primary)] text-white shadow-lg shadow-[color-mix(in_srgb,var(--color-primary)_35%,transparent)] hover:brightness-110',
        soft: 'bg-[var(--color-surface-2)] text-[var(--color-ink)] hover:bg-[var(--color-border)]',
        ghost: 'bg-transparent text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
        accent: 'bg-[var(--color-accent)] text-[#3a2a00] hover:brightness-105',
        outline: 'border border-[var(--color-border)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]',
        danger: 'bg-transparent text-[var(--color-warn)] hover:bg-[color-mix(in_srgb,var(--color-warn)_15%,transparent)]',
      },
      size: {
        sm: 'text-sm h-9 px-3',
        md: 'text-sm h-11 px-4',
        lg: 'text-base h-14 px-6',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
)
Button.displayName = 'Button'
