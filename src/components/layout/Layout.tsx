import { Outlet, useLocation } from 'react-router-dom'
import { Flame } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { QuickAdd } from './QuickAdd'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/utils'

// max-w-5xl keeps text-heavy pages (Oggi, Calendario, Progressi...) readable
// on a wide monitor. Materiali's subject view is the one screen that's
// genuinely a multi-column workspace (file list + viewer + AI panel side by
// side) -- capped at 1024px it was squeezing the PDF viewer into a strip
// with ~400px of dead space beside it on a wide screen. Let that one route
// use the full width instead of raising the cap for every page.
const WIDE_ROUTES = ['/materiali']

export function Layout() {
  const profile = useAppStore((s) => s.profile)
  const location = useLocation()
  const isWide = WIDE_ROUTES.some((p) => location.pathname.startsWith(p))

  return (
    <div className="flex min-h-dvh bg-[var(--color-bg)]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-primary)] text-sm font-bold text-white">A</div>
            <span className="font-semibold">Aria</span>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--color-accent)]">
            <Flame size={14} /> {profile.streakCount}
          </div>
        </header>

        <main className="flex-1 px-4 pb-24 pt-4 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
          <div className={cn('mx-auto w-full', isWide ? 'max-w-[1600px]' : 'max-w-5xl')}>
            <Outlet />
          </div>
        </main>
      </div>

      <QuickAdd />
      <BottomNav />
    </div>
  )
}
