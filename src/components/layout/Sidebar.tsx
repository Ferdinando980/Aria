import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { navItems } from './navItems'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/useAppStore'
import { XP_PER_LEVEL } from '../../lib/types'
import { Progress } from '../ui/Progress'
import { Flame, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { GameWidget } from '../game/GameWidget'

const COLLAPSE_KEY = 'aria.sidebarCollapsed'

export function Sidebar() {
  const profile = useAppStore((s) => s.profile)
  const xpInLevel = profile.xp % XP_PER_LEVEL
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')

  function toggle() {
    setCollapsed((c) => {
      const next = !c
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      return next
    })
  }

  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-[width] duration-150 lg:flex',
        collapsed ? 'w-[68px] items-center' : 'w-64 p-5',
      )}
    >
      <div className={cn('mb-8 flex items-center gap-2.5', collapsed ? 'flex-col' : 'px-1')}>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--color-primary)] font-bold text-white">A</div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">Aria</p>
            <p className="truncate text-xs text-[var(--color-ink-muted)] leading-tight">il tuo assistente di studio</p>
          </div>
        )}
      </div>

      <nav className={cn('flex flex-col gap-1', collapsed && 'items-center')}>
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl text-sm font-medium transition-colors',
                collapsed ? 'h-11 w-11 justify-center' : 'px-3 py-2.5',
                isActive
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
              )
            }
          >
            <Icon size={18} />
            {!collapsed && label}
          </NavLink>
        ))}
      </nav>

      <div className={cn('mt-auto flex flex-col gap-3', collapsed && 'items-center')}>
        <GameWidget compact={collapsed} iconOnly={collapsed} />
        {collapsed ? (
          <div className="flex flex-col items-center gap-1.5 rounded-2xl bg-[var(--color-surface-2)] px-2 py-3" title={`Livello ${profile.level} · streak ${profile.streakCount}`}>
            <span className="text-xs font-semibold text-[var(--color-ink)]">{profile.level}</span>
            <span className="flex items-center gap-0.5 text-[10px] text-[var(--color-accent)]">
              <Flame size={11} /> {profile.streakCount}
            </span>
          </div>
        ) : (
          <div className="rounded-2xl bg-[var(--color-surface-2)] p-4">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-[var(--color-ink)]">Livello {profile.level}</span>
              <span className="flex items-center gap-1 text-[var(--color-accent)]">
                <Flame size={13} /> {profile.streakCount}
              </span>
            </div>
            <Progress value={(xpInLevel / XP_PER_LEVEL) * 100} />
            <p className="mt-2 text-[11px] text-[var(--color-ink-muted)]">
              {xpInLevel}/{XP_PER_LEVEL} XP
            </p>
          </div>
        )}

        <button
          onClick={toggle}
          className="flex items-center gap-2 rounded-xl px-2 py-2 text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
          title={collapsed ? 'Espandi menu' : 'Comprimi menu'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && 'Comprimi'}
        </button>
      </div>
    </aside>
  )
}
