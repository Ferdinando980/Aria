import { useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { cn } from '../../lib/utils'

interface Row {
  user_id: string
  display_name: string
  score: number
}

export function Leaderboard({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const session = useAuthStore((s) => s.session)

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return
    let cancelled = false
    supabase
      .from('game_scores')
      .select('user_id, display_name, score')
      .order('score', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (cancelled || !data) return
        // best score per player, top 8
        const best = new Map<string, Row>()
        for (const row of data as Row[]) {
          const existing = best.get(row.user_id)
          if (!existing || row.score > existing.score) best.set(row.user_id, row)
        }
        setRows(Array.from(best.values()).sort((a, b) => b.score - a.score).slice(0, 8))
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  if (!isSupabaseConfigured) {
    return <p className="py-6 text-center text-xs text-[var(--color-ink-muted)]">Accedi per vedere la classifica tra tutti i giocatori.</p>
  }

  if (!rows) return <p className="py-6 text-center text-xs text-[var(--color-ink-muted)]">Carico la classifica...</p>

  if (rows.length === 0) {
    return <p className="py-6 text-center text-xs text-[var(--color-ink-muted)]">Nessun punteggio ancora — sii la prima a giocare!</p>
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <li
          key={r.user_id}
          className={cn(
            'flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm',
            r.user_id === session?.user.id ? 'bg-[color-mix(in_srgb,var(--color-primary)_18%,transparent)]' : 'bg-[var(--color-surface-2)]',
          )}
        >
          <span className={cn('w-5 shrink-0 text-center text-xs font-semibold', i === 0 && 'text-[var(--color-accent)]')}>
            {i === 0 ? <Trophy size={14} className="mx-auto" /> : i + 1}
          </span>
          <span className="min-w-0 flex-1 truncate">{r.display_name || 'Giocatore'}</span>
          <span className="shrink-0 font-semibold tabular-nums">{r.score}</span>
        </li>
      ))}
    </ul>
  )
}
