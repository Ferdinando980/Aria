import { useEffect, useMemo, useState } from 'react'
import { Sparkles, RotateCcw, Trash2, Plus, ChevronRight, Loader2, ArrowDownCircle } from 'lucide-react'
import { SidePanel } from '../ui/SidePanel'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useAppStore } from '../../store/useAppStore'
import { useToastStore } from '../../store/toastStore'
import { generateChapters, hasGeminiKey, GEMINI_MODEL } from '../../lib/gemini'
import { extractPdfTextByPage, CHAPTER_DETECTION_OPTS } from '../../lib/materialContent'
import { getMaterialFileBlob } from '../../lib/storage'
import { uid } from '../../lib/utils'
import type { Material, ChapterSection, SkillEvent } from '../../lib/types'
import { routeSkills, skillsAsPromptContext, tagsFromText, maybeDistillFromExchanges } from '../../lib/skills'
import { enforceSkillBudget } from '../../lib/contextBudget'
import { MessageFeedback } from '../shared/MessageFeedback'

interface ChapterDraft {
  id: string
  title: string
  startPage: number
  endPage: number
  subsections: ChapterSection[]
}

export function ChaptersPanel({
  material,
  fileUrl,
  open,
  onOpenChange,
  onJumpToPage,
}: {
  material: Material
  fileUrl: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onJumpToPage: (page: number) => void
}) {
  // Select the stable raw array from the store and derive the filtered/sorted
  // view locally -- selecting `s.chapters.filter(...).sort(...)` directly
  // returns a NEW array every call, which breaks useSyncExternalStore's
  // snapshot caching and causes an infinite render loop (the same pitfall
  // CLAUDE.md's zustand-selector warning covers for `s.x[id] ?? []`).
  const allChapters = useAppStore((s) => s.chapters)
  const chapters = useMemo(
    () => allChapters.filter((c) => c.materialId === material.id).sort((a, b) => a.order - b.order),
    [allChapters, material.id],
  )
  const setMaterialChapters = useAppStore((s) => s.setMaterialChapters)
  const skills = useAppStore((s) => s.skills)
  const librarianEnabled = useAppStore((s) => s.librarianEnabled)
  const logSkillCall = useAppStore((s) => s.logSkillCall)
  const addSkill = useAppStore((s) => s.addSkill)
  const push = useToastStore((s) => s.push)
  const [draft, setDraft] = useState<ChapterDraft[]>([])
  const [dirty, setDirty] = useState(false)
  const [detecting, setDetecting] = useState(false)
  // Skill-library CALL for the most recent detect()/continueDetect() -- feeds
  // the feedback control below (2026-08-21, "ogni volta che c'è l'AI" --
  // same CALL/OUTCOME loop as every other domain, so this surface produces
  // comparable F/B metrics too, not just a one-off Gemini call with nothing
  // measured). Cleared on a new detection so feedback always targets the
  // LAST generation, never a stale one from before a regenerate.
  const [lastCallEvent, setLastCallEvent] = useState<SkillEvent | undefined>(undefined)
  // Set when a detection pass hit materialContent's page/char ceiling with
  // document left over (a genuinely huge document -- rare, but must never
  // be silently dropped, per explicit user request 2026-08-21: "puoi anche
  // farmelo a step premendo continua"). Holds where the NEXT pass should
  // resume and the total page count, for "Continua rilevamento" below.
  const [remaining, setRemaining] = useState<{ fromPage: number; totalPages: number } | null>(null)

  useEffect(() => {
    setDraft(chapters.map((c) => ({ id: c.id, title: c.title, startPage: c.startPage, endPage: c.endPage, subsections: c.subsections })))
    setDirty(false)
    // This panel isn't remounted per material (no `key` at its call sites),
    // so a stale CALL event from a PREVIOUS material must not stay attached
    // to whatever chapters render for the new one -- same class of bug fixed
    // in Flashcards.tsx's resetPicker().
    setLastCallEvent(undefined)
  }, [chapters])

  function toStoredChapters(suggested: Awaited<ReturnType<typeof generateChapters>>) {
    return suggested.map((c) => ({ ...c, subsections: (c.subsections ?? []).map((s) => ({ ...s, id: uid() })) }))
  }

  /** Routes + budgets 'chapters' skill context, logs the CALL event, and
   * returns the prompt-ready skillContext string -- same shape as the
   * material_chat/material_knowledge wiring in MaterialAskPanel.tsx. */
  function prepareChaptersCall(): { skillContext: string; callEvent: SkillEvent } {
    if (!librarianEnabled) {
      const callEvent = logSkillCall('chapters', 'B', [], GEMINI_MODEL)
      return { skillContext: '', callEvent }
    }
    const retrieved = routeSkills(skills, 'chapters', tagsFromText(material.title), 2, 1, useAppStore.getState().skillEvents)
    const budgeted = enforceSkillBudget(material.title, retrieved, GEMINI_MODEL)
    if (budgeted.baseOverBudget || budgeted.droppedSkillIds.length > 0) {
      console.warn('[contextBudget] skill context ridotto per budget', { domain: 'chapters', ...budgeted })
    }
    const callEvent = logSkillCall('chapters', budgeted.skills.length > 0 ? 'F' : 'B', budgeted.skills.map((s) => s.id), GEMINI_MODEL)
    return { skillContext: skillsAsPromptContext(budgeted.skills), callEvent }
  }

  function tryDistillChapters(callEvent: SkillEvent, chapterTitles: string[]) {
    const messages = [
      { role: 'user' as const, text: `Materiale: ${material.title}` },
      { role: 'model' as const, text: `Diviso in ${chapterTitles.length} capitoli: ${chapterTitles.join(', ')}`, skillEventRef: callEvent.id },
    ]
    maybeDistillFromExchanges('chapters', messages, useAppStore.getState().skillEvents)
      .then((candidate) => candidate && addSkill(candidate))
      .catch(() => {})
  }

  async function detect(regenerate: boolean) {
    if (!hasGeminiKey()) {
      push({ title: 'Serve una chiave Gemini', description: 'Aggiungila in Impostazioni.', tone: 'warn' })
      return
    }
    if (!fileUrl && !material.filePath) return
    setDetecting(true)
    setRemaining(null)
    try {
      // fileUrl (when present) is already local -- MaterialViewer resolves
      // it to a blob: URL, itself backed by the shared cache (2026-08-24).
      // Falling back to getMaterialFileBlob directly (not
      // getMaterialFileUrl+fetch) so this path is cache-aware too instead
      // of re-downloading from Storage on its own.
      const buf = fileUrl ? await (await fetch(fileUrl)).arrayBuffer() : await (await getMaterialFileBlob(material.filePath!, material.fileUpdatedAt))?.arrayBuffer()
      if (!buf) throw new Error('no_file')
      const { pages, truncated, totalPages } = await extractPdfTextByPage(buf, CHAPTER_DETECTION_OPTS)
      const { skillContext, callEvent } = prepareChaptersCall()
      const suggested = await generateChapters(material.title, pages, undefined, skillContext)
      if (suggested.length === 0) {
        push({ title: 'Non sono riuscita a dividere il documento', tone: 'warn' })
        return
      }
      setMaterialChapters(material.id, toStoredChapters(suggested))
      setLastCallEvent(callEvent)
      if (truncated) {
        const lastCovered = pages[pages.length - 1]?.page ?? 0
        setRemaining({ fromPage: lastCovered + 1, totalPages })
        push({ title: regenerate ? 'Capitoli rigenerati' : 'Capitoli rilevati', description: `Documento molto lungo: coperte le pagine 1-${lastCovered} di ${totalPages}, il resto con "Continua".`, tone: 'good' })
      } else {
        push({ title: regenerate ? 'Capitoli rigenerati' : 'Capitoli rilevati', tone: 'good' })
      }
    } catch (err) {
      console.error('[ChaptersPanel] detect failed', err)
      push({ title: 'Rilevamento capitoli non riuscito', description: 'Riprova tra poco.', tone: 'warn' })
    } finally {
      setDetecting(false)
    }
  }

  async function continueDetect() {
    if (!remaining || !hasGeminiKey()) return
    if (!fileUrl && !material.filePath) return
    setDetecting(true)
    try {
      // fileUrl (when present) is already local -- MaterialViewer resolves
      // it to a blob: URL, itself backed by the shared cache (2026-08-24).
      // Falling back to getMaterialFileBlob directly (not
      // getMaterialFileUrl+fetch) so this path is cache-aware too instead
      // of re-downloading from Storage on its own.
      const buf = fileUrl ? await (await fetch(fileUrl)).arrayBuffer() : await (await getMaterialFileBlob(material.filePath!, material.fileUpdatedAt))?.arrayBuffer()
      if (!buf) throw new Error('no_file')
      const { pages, truncated, totalPages } = await extractPdfTextByPage(buf, { ...CHAPTER_DETECTION_OPTS, fromPage: remaining.fromPage })
      if (pages.length === 0) {
        setRemaining(null)
        return
      }
      const lastExisting = chapters[chapters.length - 1]
      const { skillContext, callEvent } = prepareChaptersCall()
      const suggested = await generateChapters(
        material.title,
        pages,
        lastExisting ? { lastChapterTitle: lastExisting.title, lastEndPage: lastExisting.endPage } : undefined,
        skillContext,
      )
      if (suggested.length === 0) {
        push({ title: 'Non ho trovato altri capitoli da qui in poi', tone: 'warn' })
        setRemaining(null)
        return
      }
      // Append, don't replace: setMaterialChapters takes the FULL desired
      // list (it upserts existing ids by position) -- the already-saved
      // chapters from earlier passes have to be included or they'd be lost.
      const existingAsInput = chapters.map((c) => ({ title: c.title, startPage: c.startPage, endPage: c.endPage, subsections: c.subsections }))
      setMaterialChapters(material.id, [...existingAsInput, ...toStoredChapters(suggested)])
      setLastCallEvent(callEvent)
      const lastCovered = pages[pages.length - 1]?.page ?? 0
      if (truncated) {
        setRemaining({ fromPage: lastCovered + 1, totalPages })
        push({ title: 'Altri capitoli aggiunti', description: `Coperte anche le pagine ${remaining.fromPage}-${lastCovered}, resta ancora del materiale.`, tone: 'good' })
      } else {
        setRemaining(null)
        push({ title: 'Documento completato', description: `Coperte anche le pagine ${remaining.fromPage}-${lastCovered} — tutto il materiale è diviso in capitoli ora.`, tone: 'good' })
      }
    } catch (err) {
      console.error('[ChaptersPanel] continueDetect failed', err)
      push({ title: 'Continuazione non riuscita', description: 'Riprova tra poco.', tone: 'warn' })
    } finally {
      setDetecting(false)
    }
  }

  function updateDraft(id: string, patch: Partial<ChapterDraft>) {
    setDraft((d) => d.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    setDirty(true)
  }

  function removeDraft(id: string) {
    setDraft((d) => d.filter((c) => c.id !== id))
    setDirty(true)
  }

  function addDraft() {
    const last = draft[draft.length - 1]
    setDraft((d) => [...d, { id: uid(), title: 'Nuovo capitolo', startPage: last ? last.endPage + 1 : 1, endPage: last ? last.endPage + 1 : 1, subsections: [] }])
    setDirty(true)
  }

  function addSubsection(chapterId: string) {
    setDraft((d) =>
      d.map((c) =>
        c.id === chapterId
          ? { ...c, subsections: [...c.subsections, { id: uid(), title: 'Sotto-sezione', startPage: c.startPage, endPage: c.startPage }] }
          : c,
      ),
    )
    setDirty(true)
  }

  function updateSubsection(chapterId: string, subId: string, patch: Partial<ChapterSection>) {
    setDraft((d) =>
      d.map((c) => (c.id === chapterId ? { ...c, subsections: c.subsections.map((s) => (s.id === subId ? { ...s, ...patch } : s)) } : c)),
    )
    setDirty(true)
  }

  function removeSubsection(chapterId: string, subId: string) {
    setDraft((d) => (d.map((c) => (c.id === chapterId ? { ...c, subsections: c.subsections.filter((s) => s.id !== subId) } : c))))
    setDirty(true)
  }

  function save() {
    setMaterialChapters(
      material.id,
      draft.map((c) => ({ title: c.title, startPage: c.startPage, endPage: c.endPage, subsections: c.subsections })),
    )
    setDirty(false)
    push({ title: 'Capitoli salvati', tone: 'good' })
  }

  return (
    <SidePanel open={open} onOpenChange={onOpenChange} title="Capitoli" subtitle={material.title}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-[var(--color-ink-muted)]">
          Divisione in capitoli per pagina, rilevata una volta e sempre la stessa quando riapri questo materiale. Se qualcosa è diviso male, cambia le
          pagine qui sotto.
        </p>

        {draft.length === 0 && !detecting && (
          <Button onClick={() => detect(false)}>
            <Sparkles size={14} /> Rileva capitoli
          </Button>
        )}
        {detecting && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
            <Loader2 size={14} className="animate-spin" /> Analizzo il documento...
          </div>
        )}

        {draft.length > 0 && (
          <div className="flex flex-col gap-2">
            {draft.map((c) => (
              <div key={c.id} className="rounded-xl border border-[var(--color-border)] p-3">
                <div className="flex items-start gap-2">
                  <button onClick={() => onJumpToPage(c.startPage)} className="mt-2 shrink-0 text-[var(--color-ink-muted)] hover:text-[var(--color-primary)]" title="Vai a questo capitolo">
                    <ChevronRight size={14} />
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Input value={c.title} onChange={(e) => updateDraft(c.id, { title: e.target.value })} className="h-8 text-sm" />
                    <div className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                      da pag.
                      <input
                        type="number"
                        min={1}
                        value={c.startPage}
                        onChange={(e) => updateDraft(c.id, { startPage: Number(e.target.value) || 1 })}
                        className="h-7 w-14 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 text-center text-[var(--color-ink)]"
                      />
                      a pag.
                      <input
                        type="number"
                        min={1}
                        value={c.endPage}
                        onChange={(e) => updateDraft(c.id, { endPage: Number(e.target.value) || 1 })}
                        className="h-7 w-14 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 text-center text-[var(--color-ink)]"
                      />
                    </div>
                  </div>
                  <button onClick={() => removeDraft(c.id)} className="mt-1 shrink-0 text-[var(--color-ink-muted)] hover:text-[var(--color-warn)]">
                    <Trash2 size={13} />
                  </button>
                </div>

                {c.subsections.length > 0 && (
                  <div className="ml-6 mt-2 flex flex-col gap-1.5 border-l border-[var(--color-border)] pl-3">
                    {c.subsections.map((s) => (
                      <div key={s.id} className="flex items-center gap-1.5">
                        <Input value={s.title} onChange={(e) => updateSubsection(c.id, s.id, { title: e.target.value })} className="h-7 flex-1 text-xs" />
                        <input
                          type="number"
                          min={1}
                          value={s.startPage}
                          onChange={(e) => updateSubsection(c.id, s.id, { startPage: Number(e.target.value) || 1 })}
                          className="h-7 w-12 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 text-center text-[var(--color-ink)]"
                        />
                        <input
                          type="number"
                          min={1}
                          value={s.endPage}
                          onChange={(e) => updateSubsection(c.id, s.id, { endPage: Number(e.target.value) || 1 })}
                          className="h-7 w-12 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 text-center text-[var(--color-ink)]"
                        />
                        <button onClick={() => removeSubsection(c.id, s.id)} className="text-[var(--color-ink-muted)] hover:text-[var(--color-warn)]">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={() => addSubsection(c.id)} className="ml-6 mt-2 flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                  <Plus size={12} /> Sotto-sezione
                </button>
              </div>
            ))}

            <button onClick={addDraft} className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--color-border)] py-2 text-xs text-[var(--color-ink-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-ink)]">
              <Plus size={13} /> Aggiungi capitolo
            </button>

            {lastCallEvent && (
              // key forces a fresh MessageFeedback instance per generation --
              // otherwise its internal "given" state would persist across a
              // regenerate and hide the feedback control for the new result.
              <MessageFeedback key={lastCallEvent.id} callEvent={lastCallEvent} onGiven={() => tryDistillChapters(lastCallEvent, draft.map((c) => c.title))} />
            )}

            {remaining && (
              <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 p-3">
                <p className="text-xs text-[var(--color-ink-muted)]">
                  Documento lungo: coperte le pagine fino a {remaining.fromPage - 1} di {remaining.totalPages}. Il resto non è ancora diviso in capitoli.
                </p>
                <Button size="sm" onClick={continueDetect} disabled={detecting}>
                  {detecting ? <Loader2 size={13} className="animate-spin" /> : <ArrowDownCircle size={13} />}
                  Continua rilevamento
                </Button>
              </div>
            )}

            <div className="mt-1 flex gap-2">
              <Button variant="soft" size="sm" onClick={() => detect(true)} disabled={detecting}>
                <RotateCcw size={13} /> Rigenera
              </Button>
              {dirty && (
                <Button size="sm" className="flex-1" onClick={save}>
                  Salva modifiche
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </SidePanel>
  )
}
