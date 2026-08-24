import { useMemo, useState } from 'react'
import { Brain, ThumbsUp, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardTitle } from '../ui/Card'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/useAppStore'

interface DueQuestion {
  id: string
  question: string
  label: string
}

const todayIso = () => new Date().toISOString().slice(0, 10)

/** Surfaces one due retrieval-practice question at a time (spaced, via [[recordRetrievalReview]]) — the single
 * evidence-based habit with the best cost/benefit for long-term memory: actively recalling beats re-reading. */
export function RecallCard() {
  const studyPlans = useAppStore((s) => s.studyPlans)
  const reviews = useAppStore((s) => s.retrievalReviews)
  const subjects = useAppStore((s) => s.subjects)
  const materials = useAppStore((s) => s.materials)
  const recordReview = useAppStore((s) => s.recordRetrievalReview)
  const [revealed, setRevealed] = useState(false)
  const [skipIds, setSkipIds] = useState<Set<string>>(new Set())

  const due = useMemo(() => {
    const today = todayIso()
    const items: DueQuestion[] = []
    for (const [planKey, chapters] of Object.entries(studyPlans)) {
      if (!Array.isArray(chapters)) continue
      let label = ''
      if (planKey.startsWith('material:')) {
        const material = materials.find((m) => m.id === planKey.slice('material:'.length))
        label = material?.title ?? 'un file'
      } else {
        label = subjects.find((s) => s.id === planKey)?.name ?? 'una materia'
      }
      for (const chapter of chapters) {
        for (const q of chapter.quiz ?? []) {
          const state = reviews[q.id]
          if (!state || state.dueDate <= today) items.push({ id: q.id, question: q.question, label })
        }
      }
    }
    return items
  }, [studyPlans, reviews, subjects, materials])

  const current = due.find((d) => !skipIds.has(d.id))

  if (!current) return null

  function grade(g: 'facile' | 'ripeti') {
    recordReview(current!.id, g)
    setSkipIds((s) => new Set(s).add(current!.id))
    setRevealed(false)
  }

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Brain size={16} className="text-[var(--color-primary)]" />
        <CardTitle>Ripasso lampo</CardTitle>
      </div>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">30 secondi, a mente — da: {current.label}</p>

      <p className="mt-3 rounded-xl bg-[var(--color-surface-2)] p-3.5 text-sm font-medium leading-relaxed">{current.question}</p>

      {!revealed ? (
        <Button size="sm" variant="soft" className="mt-3" onClick={() => setRevealed(true)}>
          Ho provato a rispondere
        </Button>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="w-full text-xs text-[var(--color-ink-muted)]">Com'è andata? (rivedi il materiale se vuoi controllare)</p>
          <Button size="sm" variant="soft" onClick={() => grade('ripeti')}>
            <RotateCcw size={13} /> Da rivedere
          </Button>
          <Button size="sm" onClick={() => grade('facile')}>
            <ThumbsUp size={13} /> Facile
          </Button>
        </div>
      )}

      <Link to="/materiali" className="mt-3 block text-xs text-[var(--color-ink-muted)] underline decoration-dotted hover:text-[var(--color-ink)]">
        Vai ai materiali
      </Link>
    </Card>
  )
}
