import { useMemo, useState } from 'react'
import { Layers, Sparkles, ThumbsUp, RotateCcw, Loader2, ArrowLeft, RefreshCw, Plus, Trash2, BookOpen, Pencil, PauseCircle, PlayCircle, Check, X, Settings } from 'lucide-react'
import { Card, CardTitle, CardSubtitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { SidePanel } from '../components/ui/SidePanel'
import { useAppStore } from '../store/useAppStore'
import { useToastStore } from '../store/toastStore'
import { generateFlashcards, hasGeminiKey, GEMINI_MODEL } from '../lib/gemini'
import { isViewableInline, getChapterScopedText } from '../lib/materialContent'
import { cn, contrastTextColor } from '../lib/utils'
import type { SkillEvent } from '../lib/types'
import { routeSkills, routeMaterialKnowledge, skillsAsPromptContext, tagsFromText, maybeDistillFromExchanges } from '../lib/skills'
import { enforceSkillBudget } from '../lib/contextBudget'
import { MessageFeedback } from '../components/shared/MessageFeedback'

const todayIso = () => new Date().toISOString().slice(0, 10)

export default function Flashcards() {
  const subjects = useAppStore((s) => s.subjects)
  const materials = useAppStore((s) => s.materials)
  const chapters = useAppStore((s) => s.chapters)
  const flashcards = useAppStore((s) => s.flashcards)
  const addFlashcards = useAppStore((s) => s.addFlashcards)
  const removeFlashcardsFor = useAppStore((s) => s.removeFlashcardsFor)
  const reviews = useAppStore((s) => s.retrievalReviews)
  const recordReview = useAppStore((s) => s.recordRetrievalReview)
  const skills = useAppStore((s) => s.skills)
  const librarianEnabled = useAppStore((s) => s.librarianEnabled)
  const logSkillCall = useAppStore((s) => s.logSkillCall)
  const addSkill = useAppStore((s) => s.addSkill)
  const push = useToastStore((s) => s.push)

  // Two-screen flow (2026-08-24, real user report: "la UI della sezione
  // flashcard mi da molto fastidio... non mi piace come si gestisce il
  // tutto" -- root cause found reading the old layout: EVERY concern --
  // subject/material/chapter/section pickers, the deck list, generation,
  // card management, AND the actual review card -- was stacked in one
  // narrow column, with the one thing this page is FOR (reviewing a card)
  // buried below four or five layers of picker UI). 'browse' = pick a deck
  // (a real tile grid now, not thin text rows) or start a new one.
  // 'study' = the deck chosen, nothing but the review card in view --
  // generation/editing/deletion moved into a gear-triggered side panel
  // instead of sitting permanently above the thing you came here to do.
  const [view, setView] = useState<'browse' | 'study'>('browse')
  const [showNewDeckPicker, setShowNewDeckPicker] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  const [subjectId, setSubjectId] = useState('')
  const [materialId, setMaterialId] = useState('')
  const [chapterId, setChapterId] = useState('')
  const [sectionId, setSectionId] = useState('') // '' = whole chapter, not "whole material"
  const [generating, setGenerating] = useState<'replace' | 'more' | null>(null)
  // Skill-library CALL for the most recent generation, same "ogni volta che
  // c'è l'AI" loop as chapters/material_chat.
  // Array, not a single event (2026-08-24): a generation now logs TWO CALLs
  // when material_knowledge context was pulled in (the flashcards technique
  // domain + material_knowledge itself, same dual-CALL pattern as
  // MaterialAskPanel.tsx's material_chat+material_knowledge) -- one feedback
  // control still covers both, see MessageFeedback's array support.
  const [lastFlashcardsCall, setLastFlashcardsCall] = useState<SkillEvent[] | undefined>(undefined)
  // Default true (2026-08-24, real user report: "il numero di flashcard
  // finisce e mi chiede se ho cose in scadenza oggi? non ha senso") -- this
  // page is a deck review, not the SM-2 spaced-repetition surface (that's
  // "Ripasso lampo" on Oggi, a DIFFERENT algorithm/purpose). Gating the main
  // deck behind "due today" by default meant a normal study session could
  // silently run out of cards it had already reviewed recently, with no
  // obvious reason why. Now: shows the WHOLE scoped deck by default; due-date
  // filtering is the opt-in narrowing, not the default gate.
  const [reviewOffSchedule, setReviewOffSchedule] = useState(true)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)

  const subjectMaterials = materials.filter((m) => m.subjectId === subjectId && isViewableInline(m))
  const material = materials.find((m) => m.id === materialId)
  const materialChapters = chapters.filter((c) => c.materialId === materialId).sort((a, b) => a.order - b.order)
  const chapter = materialChapters.find((c) => c.id === chapterId)
  const section = chapter?.subsections.find((s) => s.id === sectionId)

  // Scope system (2026-08-24, explicit user request): "se non scelgo nulla e
  // clicco solo sulla materia, tutte le flashcard della materia... sennò
  // quelle della sezione stessa e basta se l'hai aperta". Chapter/section
  // stay an EXACT match when a chapter is actually selected (unchanged --
  // a chapter-level deck and its own sub-section decks are still separate,
  // that distinction wasn't the complaint), but with no chapter selected the
  // deck widens to the whole material, then the whole subject, instead of
  // matching nothing (chapterId === '' never equals a real chapter id, so
  // the deck was silently empty before this fix any time nothing narrower
  // than subject/material was picked).
  const scopedCards = useMemo(() => {
    if (chapterId) return flashcards.filter((f) => f.materialId === materialId && f.chapterId === chapterId && f.sectionId === (sectionId || undefined))
    if (materialId) return flashcards.filter((f) => f.materialId === materialId)
    if (subjectId) {
      const materialIds = new Set(subjectMaterials.map((m) => m.id))
      return flashcards.filter((f) => materialIds.has(f.materialId))
    }
    return []
  }, [flashcards, subjectId, materialId, chapterId, sectionId, subjectMaterials])

  // Real "mazzi" (decks) list (2026-08-24, user report: "i deck non sono
  // gestibili, avevo detto che dovevi crearmi piu' deck"). Not a new stored
  // entity -- a deck IS the (materialId, chapterId, sectionId) scope a
  // flashcard already carries, same principle as the scope system above.
  // What was actually missing wasn't the concept, it was VISIBILITY: every
  // deck that already exists only showed up if you happened to click through
  // the exact same material/chapter/section drill-down that created it.
  // This lists every real deck in the current subject up front, so you can
  // jump straight to one (or delete it) without reconstructing the path.
  const decksInSubject = useMemo(() => {
    const bySubjectMaterialIds = new Set(subjectMaterials.map((m) => m.id))
    const byScope = new Map<string, { materialId: string; chapterId: string; sectionId?: string; count: number }>()
    for (const f of flashcards) {
      if (!bySubjectMaterialIds.has(f.materialId)) continue
      const key = `${f.materialId}::${f.chapterId}::${f.sectionId ?? ''}`
      const entry = byScope.get(key)
      if (entry) entry.count++
      else byScope.set(key, { materialId: f.materialId, chapterId: f.chapterId, sectionId: f.sectionId, count: 1 })
    }
    return Array.from(byScope.values()).map((d) => {
      const m = materials.find((x) => x.id === d.materialId)
      const c = chapters.find((x) => x.id === d.chapterId)
      const s = c?.subsections.find((x) => x.id === d.sectionId)
      return { ...d, materialTitle: m?.title ?? '?', chapterTitle: c?.title ?? '?', sectionTitle: s?.title }
    })
  }, [flashcards, subjectMaterials, materials, chapters])
  const today = todayIso()
  // Suspended cards (2026-08-24) stay in scopedCards for management (you can
  // still see/unsuspend them) but never in the actual review/test queue --
  // same "excluded without deleted" shape as everything else that's already
  // "archived, not gone" in this codebase.
  const reviewableCards = scopedCards.filter((c) => !c.suspended)
  const dueCards = reviewOffSchedule ? reviewableCards : reviewableCards.filter((c) => !reviews[c.id] || reviews[c.id].dueDate <= today)
  const current = dueCards[index]

  const removeFlashcard = useAppStore((s) => s.removeFlashcard)
  const updateFlashcard = useAppStore((s) => s.updateFlashcard)
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [editFront, setEditFront] = useState('')
  const [editBack, setEditBack] = useState('')

  /** Real user request (2026-08-21): "devo poterle gestire. Riaprire
   * rivedere se voglio" -- jumps straight to one specific card regardless
   * of its SM-2 due date (reviewOffSchedule makes dueCards === reviewableCards,
   * same escape hatch "Rivedile comunque" already uses). Searches
   * reviewableCards, not scopedCards (2026-08-24: with suspended cards now
   * mixed into scopedCards, an index found there could point at the wrong
   * card once dueCards excludes them) -- a suspended card has no due-card
   * index to jump to at all, silently no-ops rather than landing on the
   * wrong card. */
  function reviewCard(id: string) {
    const idx = reviewableCards.findIndex((c) => c.id === id)
    if (idx === -1) return
    setReviewOffSchedule(true)
    setIndex(idx)
    setRevealed(false)
  }

  function resetPicker(next: Partial<{ subjectId: string; materialId: string; chapterId: string; sectionId: string }>) {
    setIndex(0)
    setRevealed(false)
    setReviewOffSchedule(true)
    // A stale CALL event from a different chapter/material must never get
    // attributed to whatever summary/flashcards this scope change lands on
    // (that scope may already have its OWN older content, generated in a
    // past session with no CALL event to feedback against here at all).
    setLastFlashcardsCall(undefined)
    if ('subjectId' in next) {
      setSubjectId(next.subjectId!)
      setMaterialId('')
      setChapterId('')
      setSectionId('')
      setView('browse')
      setShowNewDeckPicker(false)
    } else if ('materialId' in next) {
      setMaterialId(next.materialId!)
      setChapterId('')
      setSectionId('')
    } else if ('chapterId' in next) {
      setChapterId(next.chapterId!)
      setSectionId('')
    } else if ('sectionId' in next) {
      setSectionId(next.sectionId!)
    }
  }

  function openDeck(deckMaterialId: string, deckChapterId: string, deckSectionId?: string) {
    setMaterialId(deckMaterialId)
    setChapterId(deckChapterId)
    setSectionId(deckSectionId ?? '')
    setIndex(0)
    setRevealed(false)
    setReviewOffSchedule(true)
    setLastFlashcardsCall(undefined)
    setManageOpen(false)
    setView('study')
  }

  /** Routes + budgets skill context for 'flashcards'/'summary' (general,
   * tag-overlap routing -- technique-level, not tied to one material, same
   * shape as material_chat/study_plan/chapters), logs the CALL event.
   * baseText is whatever's already in scope at the call site (title +
   * scopeLabel + the source text itself is the real budget-relevant size). */
  // `knowledgeScope` (2026-08-24): when generating for a real material/
  // chapter/section, also pulls in any material_knowledge facts scoped to
  // that exact chapter/section (routeMaterialKnowledge's specificityTier) --
  // e.g. a point of confusion clarified in chat now feeds flashcard/summary
  // generation for that same part, not just future chat. Logs its own CALL
  // (domain-scoped F/B stats stay meaningful) -- returns BOTH events.
  function prepareSkillCall(
    tagSourceText: string,
    baseText: string,
    knowledgeScope: { materialId: string; chapterId?: string; sectionId?: string },
  ): { skillContext: string; callEvents: SkillEvent[] } {
    if (!librarianEnabled) {
      return { skillContext: '', callEvents: [logSkillCall('flashcards', 'B', [], GEMINI_MODEL), logSkillCall('material_knowledge', 'B', [], GEMINI_MODEL)] }
    }
    const retrieved = routeSkills(skills, 'flashcards', tagsFromText(tagSourceText), 2, 1, useAppStore.getState().skillEvents)
    const retrievedKnowledge = routeMaterialKnowledge(skills, knowledgeScope.materialId, { chapterId: knowledgeScope.chapterId, sectionId: knowledgeScope.sectionId })
    const budgeted = enforceSkillBudget(baseText, [...retrieved, ...retrievedKnowledge], GEMINI_MODEL)
    if (budgeted.baseOverBudget || budgeted.droppedSkillIds.length > 0) {
      console.warn('[contextBudget] skill context ridotto per budget', { domain: 'flashcards', ...budgeted })
    }
    const kept = budgeted.skills.filter((s) => s.domain === 'flashcards')
    const keptKnowledge = budgeted.skills.filter((s) => s.domain === 'material_knowledge')
    return {
      skillContext: skillsAsPromptContext(budgeted.skills),
      callEvents: [
        logSkillCall('flashcards', kept.length > 0 ? 'F' : 'B', kept.map((s) => s.id), GEMINI_MODEL),
        logSkillCall('material_knowledge', keptKnowledge.length > 0 ? 'F' : 'B', keptKnowledge.map((s) => s.id), GEMINI_MODEL),
      ],
    }
  }

  function tryDistillSkill(callEvents: SkillEvent[], userText: string, ariaText: string) {
    // callEvents also includes a material_knowledge CALL (see
    // prepareSkillCall) -- distillation is specifically for the flashcards
    // technique domain, so pick that one out rather than the wrong id.
    const callEvent = callEvents.find((e) => e.domain === 'flashcards')
    if (!callEvent) return
    const messages = [
      { role: 'user' as const, text: userText },
      { role: 'model' as const, text: ariaText, skillEventRef: callEvent.id },
    ]
    maybeDistillFromExchanges('flashcards', messages, useAppStore.getState().skillEvents)
      .then((candidate) => candidate && addSkill(candidate))
      .catch(() => {})
  }

  async function generate(mode: 'replace' | 'more') {
    if (!material || !chapter) return
    if (!hasGeminiKey()) {
      push({ title: 'Serve una chiave Gemini', description: 'Aggiungila in Impostazioni.', tone: 'warn' })
      return
    }
    setGenerating(mode)
    try {
      const { text, scopeLabel } = await getChapterScopedText(material, chapter, section)
      if (!text.trim()) {
        push({ title: 'Non ho trovato testo da usare', description: 'Prova un altro capitolo o sezione.', tone: 'warn' })
        return
      }
      const existingFronts = mode === 'more' ? scopedCards.map((c) => c.front) : []
      const { skillContext, callEvents } = prepareSkillCall(`${material.title} ${scopeLabel}`, text, {
        materialId: material.id,
        chapterId: chapter.id,
        sectionId: section?.id,
      })
      const cards = await generateFlashcards(material.title, scopeLabel, text, existingFronts, skillContext)
      if (cards.length === 0) {
        push({ title: mode === 'more' ? 'Nessun concetto nuovo trovato' : 'Non sono riuscita a creare flashcard da qui', tone: 'warn' })
        return
      }
      if (mode === 'replace') removeFlashcardsFor(material.id, chapter.id, section?.id)
      addFlashcards(cards.map((c) => ({ materialId: material.id, chapterId: chapter.id, sectionId: section?.id, front: c.front, back: c.back })))
      setLastFlashcardsCall(callEvents)
      setIndex(0)
      setRevealed(false)
      setView('study')
      setShowNewDeckPicker(false)
      push({ title: `${cards.length} flashcard ${mode === 'more' ? 'aggiunte' : 'create'}`, tone: 'good' })
    } catch {
      push({ title: 'Generazione non riuscita', description: 'Riprova tra poco.', tone: 'warn' })
    } finally {
      setGenerating(null)
    }
  }

  function grade(g: 'facile' | 'ripeti') {
    if (!current) return
    recordReview(current.id, g)
    setRevealed(false)
    setIndex((i) => i + 1)
  }

  const deckLabel = section ? section.title : chapter ? chapter.title : material ? material.title : ''

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Flashcard</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Richiamo attivo su quello che hai già studiato — scegli da dove.</p>
      </div>

      <div className="mb-4">
        <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">Materia</p>
        <div className="flex flex-wrap gap-2">
          {subjects.map((s) => (
            <button
              key={s.id}
              onClick={() => resetPicker({ subjectId: s.id })}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ background: subjectId === s.id ? s.color : 'var(--color-surface-2)', color: subjectId === s.id ? contrastTextColor(s.color) : 'var(--color-ink-muted)' }}
            >
              {s.name}
            </button>
          ))}
          {subjects.length === 0 && <p className="text-xs text-[var(--color-ink-muted)]">Crea prima una materia in Materiali.</p>}
        </div>
      </div>

      {!subjectId && (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-[var(--color-ink-muted)]">
          <ArrowLeft size={16} />
          Scegli una materia qui sopra per iniziare.
        </div>
      )}

      {/* ================= BROWSE: deck grid + new-deck picker ================= */}
      {subjectId && view === 'browse' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {decksInSubject.map((d) => (
              <Card
                key={`${d.materialId}::${d.chapterId}::${d.sectionId ?? ''}`}
                className="group relative cursor-pointer p-4 transition-colors hover:border-[var(--color-primary)]"
                onClick={() => openDeck(d.materialId, d.chapterId, d.sectionId)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Layers size={15} className="shrink-0 text-[var(--color-primary)]" />
                    <p className="truncate text-sm font-semibold text-[var(--color-ink)]">{d.sectionTitle ?? d.chapterTitle}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFlashcardsFor(d.materialId, d.chapterId, d.sectionId)
                    }}
                    title="Elimina questo mazzo"
                    className="shrink-0 rounded-lg p-1 text-[var(--color-ink-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-warn)]"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--color-ink-muted)]">
                  {d.materialTitle}
                  {d.sectionTitle ? ` · ${d.chapterTitle}` : ''}
                </p>
                <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{d.count} card</p>
              </Card>
            ))}
            <button
              onClick={() => setShowNewDeckPicker((v) => !v)}
              className={cn(
                'flex min-h-[88px] flex-col items-center justify-center gap-1.5 rounded-[var(--radius-2xl)] border border-dashed p-4 text-xs font-medium transition-colors',
                showNewDeckPicker
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-ink-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]',
              )}
            >
              <Plus size={16} />
              Nuovo mazzo
            </button>
          </div>

          {decksInSubject.length === 0 && !showNewDeckPicker && (
            <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-[var(--color-ink-muted)]">
              Ancora nessun mazzo qui — usa "Nuovo mazzo" per crearne uno da un capitolo.
            </div>
          )}

          {showNewDeckPicker && (
            <Card className="flex flex-col gap-3">
              <div>
                <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">Materiale</p>
                <div className="flex flex-wrap gap-2">
                  {subjectMaterials.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => resetPicker({ materialId: m.id })}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-xs font-medium',
                        materialId === m.id ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
                      )}
                    >
                      {m.title}
                    </button>
                  ))}
                  {subjectMaterials.length === 0 && <p className="text-xs text-[var(--color-ink-muted)]">Nessun materiale leggibile in questa materia.</p>}
                </div>
              </div>

              {material && materialChapters.length === 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--color-border)] px-3 py-2.5 text-xs text-[var(--color-ink-muted)]">
                  <BookOpen size={14} className="shrink-0" />
                  Questo materiale non ha ancora capitoli — apri il PDF e usa "Capitoli" per dividerlo prima di creare flashcard.
                </div>
              )}

              {material && materialChapters.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">Capitolo</p>
                  <div className="flex flex-wrap gap-2">
                    {materialChapters.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => resetPicker({ chapterId: c.id })}
                        className={cn('rounded-full px-3 py-1.5 text-xs font-medium', chapterId === c.id ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]')}
                      >
                        {c.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chapter && chapter.subsections.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-muted)]">Sezione</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => resetPicker({ sectionId: '' })}
                      className={cn('rounded-full px-3 py-1.5 text-xs font-medium', sectionId === '' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]')}
                    >
                      Tutto il capitolo
                    </button>
                    {chapter.subsections.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => resetPicker({ sectionId: s.id })}
                        className={cn('rounded-full px-3 py-1.5 text-xs font-medium', sectionId === s.id ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]')}
                      >
                        {s.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chapter && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => generate('replace')} disabled={generating !== null}>
                    {generating === 'replace' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {scopedCards.length > 0 ? 'Rigenera questo mazzo' : 'Genera flashcard'}
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {/* ================= STUDY: focused review, nothing else in the way ================= */}
      {subjectId && view === 'study' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setView('browse')}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              <ArrowLeft size={14} /> Mazzi
            </button>
            <button
              onClick={() => setManageOpen(true)}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
              title="Gestisci questo mazzo"
            >
              <Settings size={14} /> Gestisci
            </button>
          </div>

          {scopedCards.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 py-8 text-center">
              <CardSubtitle>Questo mazzo non ha più card.</CardSubtitle>
              <Button size="sm" variant="soft" onClick={() => setView('browse')}>
                Torna ai mazzi
              </Button>
            </Card>
          ) : (
            <Card>
              {current ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Layers size={16} className="text-[var(--color-primary)]" />
                      <CardTitle>
                        Card {index + 1} di {dueCards.length}
                      </CardTitle>
                    </div>
                    <button
                      onClick={() => {
                        setReviewOffSchedule((v) => !v)
                        setIndex(0)
                        setRevealed(false)
                      }}
                      className="text-[11px] text-[var(--color-ink-muted)] underline underline-offset-2 hover:text-[var(--color-ink)]"
                      title="Ripasso spaziato: mostra solo le card che l'algoritmo SM-2 considera in scadenza oggi"
                    >
                      {reviewOffSchedule ? 'Solo quelle in scadenza' : 'Mostra tutto il mazzo'}
                    </button>
                  </div>
                  <CardSubtitle>{deckLabel}</CardSubtitle>
                  <p className="mt-4 rounded-xl bg-[var(--color-surface-2)] p-6 text-base font-medium leading-relaxed">{current.front}</p>
                  {!revealed ? (
                    <Button size="sm" variant="soft" className="mt-3" onClick={() => setRevealed(true)}>
                      Mostra risposta
                    </Button>
                  ) : (
                    <>
                      <p className="mt-3 rounded-xl border border-[var(--color-border)] p-4 text-sm leading-relaxed text-[var(--color-ink-muted)]">{current.back}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="soft" onClick={() => grade('ripeti')}>
                          <RotateCcw size={13} /> Da rivedere
                        </Button>
                        <Button size="sm" onClick={() => grade('facile')}>
                          <ThumbsUp size={13} /> Facile
                        </Button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <p className="text-sm text-[var(--color-ink-muted)]">{reviewOffSchedule ? 'Nessuna card in questo ambito.' : 'Niente in scadenza oggi in questo ambito — bel lavoro.'}</p>
                  {!reviewOffSchedule && scopedCards.length > 0 && (
                    <Button size="sm" variant="soft" onClick={() => setReviewOffSchedule(true)}>
                      <RefreshCw size={13} /> Mostra tutto il mazzo
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {/* ================= Manage drawer: generate/edit/suspend/delete cards ================= */}
      <SidePanel open={manageOpen} onOpenChange={setManageOpen} title="Gestisci mazzo" subtitle={deckLabel}>
        <div className="flex flex-col gap-4">
          {chapter && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="soft" onClick={() => generate('replace')} disabled={generating !== null}>
                {generating === 'replace' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Rigenera
              </Button>
              <Button size="sm" variant="outline" onClick={() => generate('more')} disabled={generating !== null}>
                {generating === 'more' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Aggiungi altre
              </Button>
            </div>
          )}
          {lastFlashcardsCall && (
            <MessageFeedback
              key={lastFlashcardsCall.map((e) => e.id).join(',')}
              callEvent={lastFlashcardsCall}
              onGiven={() => tryDistillSkill(lastFlashcardsCall, `${material?.title} — ${scopedCards.length} flashcard`, scopedCards.slice(0, 3).map((c) => c.front).join('; '))}
            />
          )}
          <div>
            <p className="mb-2 text-xs font-medium text-[var(--color-ink-muted)]">{scopedCards.length} card in questo mazzo</p>
            <ul className="flex flex-col gap-1.5">
              {scopedCards.map((c) =>
                editingCardId === c.id ? (
                  <li key={c.id} className="flex flex-col gap-1.5 rounded-lg bg-[var(--color-surface-2)] p-2">
                    <textarea
                      value={editFront}
                      onChange={(e) => setEditFront(e.target.value)}
                      rows={2}
                      placeholder="Fronte"
                      className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
                    />
                    <textarea
                      value={editBack}
                      onChange={(e) => setEditBack(e.target.value)}
                      rows={2}
                      placeholder="Retro"
                      className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
                    />
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => {
                          if (editFront.trim() && editBack.trim()) updateFlashcard(c.id, { front: editFront.trim(), back: editBack.trim() })
                          setEditingCardId(null)
                        }}
                        className="rounded-lg p-1 text-[var(--color-good)] hover:bg-[var(--color-surface)]"
                        title="Salva"
                      >
                        <Check size={13} />
                      </button>
                      <button onClick={() => setEditingCardId(null)} className="rounded-lg p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)]" title="Annulla">
                        <X size={13} />
                      </button>
                    </div>
                  </li>
                ) : (
                  <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg px-1 py-1 text-xs hover:bg-[var(--color-surface-2)]">
                    <span className={cn('min-w-0 truncate', c.suspended ? 'text-[var(--color-ink-muted)] line-through' : 'text-[var(--color-ink)]')} title={c.front}>
                      {c.front}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <button onClick={() => reviewCard(c.id)} className="rounded-lg px-1.5 py-0.5 text-[var(--color-primary)] hover:bg-[var(--color-surface)]">
                        Rivedi
                      </button>
                      <button
                        onClick={() => {
                          setEditingCardId(c.id)
                          setEditFront(c.front)
                          setEditBack(c.back)
                        }}
                        className="rounded-lg p-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                        title="Modifica"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => updateFlashcard(c.id, { suspended: !c.suspended })}
                        className="rounded-lg p-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                        title={c.suspended ? 'Riattiva (torna in revisione)' : 'Sospendi (esclude dalla revisione, non elimina)'}
                      >
                        {c.suspended ? <PlayCircle size={12} /> : <PauseCircle size={12} />}
                      </button>
                      <button onClick={() => removeFlashcard(c.id)} className="rounded-lg p-1 text-[var(--color-ink-muted)] hover:text-[var(--color-warn)]">
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>
      </SidePanel>
    </div>
  )
}
