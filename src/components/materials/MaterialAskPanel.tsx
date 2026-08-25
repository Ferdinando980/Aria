import { useEffect, useRef, useState } from 'react'
import { Send, Sparkles, KeyRound, X } from 'lucide-react'
import { Textarea } from '../ui/Input'
import { Button } from '../ui/Button'
import { Link } from 'react-router-dom'
import { askAboutMaterial, hasGeminiKey, updateMaterialMemory, GEMINI_MODEL } from '../../lib/gemini'
import { getMaterialText } from '../../lib/materialContent'
import { verifyUncertaintyDisclosure } from '../../lib/uncertaintyDisclosureCheck'
import { verifyEvidenceGrounding } from '../../lib/evidenceGroundingCheck'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/utils'
import type { Material, SkillEvent } from '../../lib/types'
import { routeSkills, routeMaterialKnowledge, skillsAsPromptContext, tagsFromText, maybeDistillFromExchanges, maybeDistillMaterialKnowledge } from '../../lib/skills'
import { enforceSkillBudget } from '../../lib/contextBudget'
import { MessageFeedback } from '../shared/MessageFeedback'

interface Msg {
  role: 'user' | 'model'
  text: string
  callEvent?: SkillEvent[]
}

export function MaterialAskPanel({
  material,
  onClose,
  currentPage,
}: {
  material: Material | null
  onClose: () => void
  /** Page currently in view in the PDF viewer, if any (2026-08-24) -- used to
   * scope material_knowledge retrieval/distillation to the chapter/section
   * being read, instead of always the whole material. Undefined (link/note
   * materials, or the page hasn't been reported yet) falls back to the
   * original 2026-08-21 material-wide behavior -- never a hard requirement. */
  currentPage?: number
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [context, setContext] = useState('')
  const [readingFile, setReadingFile] = useState(false)
  // fs_uncertainty_disclosure_check pilot (2026-08-25): known independently of
  // the model, at the moment getMaterialText() resolves -- see uncertaintyDisclosureCheck.ts.
  const [contentAvailable, setContentAvailable] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const skills = useAppStore((s) => s.skills)
  const librarianEnabled = useAppStore((s) => s.librarianEnabled)
  const logSkillCall = useAppStore((s) => s.logSkillCall)
  const upsertSkillContent = useAppStore((s) => s.upsertSkillContent)
  const addSkill = useAppStore((s) => s.addSkill)
  const chapters = useAppStore((s) => s.chapters)
  const materialMemory = skills.find((s) => s.id === `migrated_material_${material?.id}`)?.content ?? material?.aiNotes ?? ''

  // Which chapter/section `currentPage` falls inside, if any (2026-08-24) --
  // pure page-range lookup over the material's own already-detected chapters,
  // no new detection logic. undefined/undefined for a link/note material (no
  // chapters exist) or a page outside every known range (falls back to
  // material-wide retrieval, same as before this feature existed).
  const currentLocation = (() => {
    if (!material || currentPage === undefined) return {}
    const chapter = chapters.find((c) => c.materialId === material.id && currentPage >= c.startPage && currentPage <= c.endPage)
    if (!chapter) return {}
    const section = chapter.subsections.find((s) => currentPage >= s.startPage && currentPage <= s.endPage)
    return { chapterId: chapter.id, sectionId: section?.id, chapterTitle: chapter.title, sectionTitle: section?.title }
  })()

  useEffect(() => {
    setMessages([])
    setInput('')
    setContext('')
    if (!material) return
    let cancelled = false
    setReadingFile(true)
    getMaterialText(material).then(({ text, truncated }) => {
      if (cancelled) return
      const header = `Titolo: ${material.title}\nTipo: ${material.type}`
      const memory = materialMemory ? `\n\nMemoria da conversazioni precedenti su questo file:\n${materialMemory}` : ''
      const body = text
        ? `\n\nContenuto:\n${text}${truncated ? '\n(...troncato, il file è più lungo)' : ''}`
        : material.type === 'link'
          ? `\nLink: ${material.url} (non riesco ad aprire link esterni, chiedi all'utente di incollarti il testo se serve)`
          : `\nNon riesco a leggere il contenuto di questo file (formato non supportato ancora): ${material.fileName ?? ''}`
      setContext(header + memory + body)
      setContentAvailable(Boolean(text))
      setReadingFile(false)
    })
    return () => {
      cancelled = true
    }
  }, [material?.id])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  async function send() {
    if (!material || !input.trim() || readingFile) return
    const value = input.trim()
    const next = [...messages, { role: 'user' as const, text: value }]
    setMessages(next)
    setInput('')
    setLoading(true)
    try {
      let skillContext = ''
      const callEvents: SkillEvent[] = []
      // Two domains behind one reply, deliberately two CALL events (see
      // MessageFeedback.tsx's module comment): material_chat = generic
      // material-chat behavior (the pre-existing skill), material_knowledge
      // = facts specific to THIS material, retrieved by exact materialId
      // match (routeMaterialKnowledge), not routeSkills()'s fuzzy tag
      // overlap -- see skills.ts's routeMaterialKnowledge() comment for why
      // that distinction matters here specifically.
      if (librarianEnabled) {
        const retrievedChat = routeSkills(skills, 'material_chat', [`material:${material.id}`, ...tagsFromText(value)], 2, 1, useAppStore.getState().skillEvents)
        const retrievedKnowledge = routeMaterialKnowledge(skills, material.id, currentLocation)
        const baseText = context + '\n' + next.map((m) => m.text).join('\n')
        const budgeted = enforceSkillBudget(baseText, [...retrievedChat, ...retrievedKnowledge], GEMINI_MODEL)
        if (budgeted.baseOverBudget || budgeted.droppedSkillIds.length > 0) {
          console.warn('[contextBudget] skill context ridotto per budget', { domain: 'material_chat+material_knowledge', ...budgeted })
        }
        const keptChat = budgeted.skills.filter((s) => s.domain === 'material_chat')
        const keptKnowledge = budgeted.skills.filter((s) => s.domain === 'material_knowledge')
        skillContext = skillsAsPromptContext([...keptChat, ...keptKnowledge])
        callEvents.push(logSkillCall('material_chat', keptChat.length > 0 ? 'F' : 'B', keptChat.map((s) => s.id), GEMINI_MODEL))
        callEvents.push(logSkillCall('material_knowledge', keptKnowledge.length > 0 ? 'F' : 'B', keptKnowledge.map((s) => s.id), GEMINI_MODEL))
      } else {
        callEvents.push(logSkillCall('material_chat', 'B', [], GEMINI_MODEL))
        callEvents.push(logSkillCall('material_knowledge', 'B', [], GEMINI_MODEL))
      }

      const reply = await askAboutMaterial(context, next, skillContext)
      console.log('[fs_uncertainty_disclosure_check]', verifyUncertaintyDisclosure(reply, contentAvailable))
      if (contentAvailable) console.log('[fs_cite_before_claim]', verifyEvidenceGrounding(reply, context))
      setMessages((m) => [...m, { role: 'model', text: reply, callEvent: callEvents }])
      // Fire-and-forget: distill anything new from this exchange into the material's persistent memory
      // (now a Skill in the library, not the old standalone aiNotes field — see types.ts), so the next
      // chat session (even much later) starts already knowing it — never blocks the UI.
      const conversationText = `${value}\n${reply}`
      updateMaterialMemory(materialMemory, conversationText)
        .then((updated) =>
          upsertSkillContent(`migrated_material_${material.id}`, updated, {
            version: 1,
            title: `Memoria: ${material.title}`,
            domain: 'material_chat',
            capabilityTags: [`material:${material.id}`],
            materialId: material.id,
            status: 'PERSONAL_NOTE', // content-class domain, see domainClass() in skills.ts
            confidence: 1,
            uses: 0,
            successes: 0,
            generationMethod: 'distilled',
          }),
        )
        .catch(() => {})
    } catch (err) {
      console.error('[MaterialAskPanel] send failed', err)
      // Same fix as Assistant.tsx's identical catch block (2026-08-24) --
      // this one always blamed the API key regardless of real cause, which
      // is exactly the misleading pattern that sent debugging in the wrong
      // direction there. withRetry already retries real 429/5xx up to 4
      // times before this is ever reached.
      const message = err instanceof Error ? err.message : String(err)
      const looksLikeKeyIssue = /api.?key|permission|401|403/i.test(message)
      const looksOverloaded = /50[034]|429|overloaded|high demand/i.test(message)
      setMessages((m) => [
        ...m,
        {
          role: 'model',
          text: looksLikeKeyIssue
            ? 'Non riesco a rispondere — controlla la tua chiave Gemini nelle Impostazioni.'
            : looksOverloaded
              ? 'Gemini è sovraccarico in questo momento (non è la tua chiave) — ho già riprovato qualche volta in automatico. Aspetta un minuto e riprova.'
              : 'Non riesco a rispondere ora, riprova tra poco.',
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  function tryDistill() {
    if (!material) return
    maybeDistillFromExchanges(
      'material_chat',
      messages.map((m) => ({ role: m.role, text: m.text, skillEventRef: m.callEvent?.find((e) => e.domain === 'material_chat')?.id })),
      useAppStore.getState().skillEvents,
    )
      .then((candidate) => candidate && addSkill(candidate))
      .catch(() => {})
    maybeDistillMaterialKnowledge(
      material.id,
      material.title,
      messages.map((m) => ({ role: m.role, text: m.text, skillEventRef: m.callEvent?.find((e) => e.domain === 'material_knowledge')?.id })),
      useAppStore.getState().skillEvents,
      // Approximation, not exact: stamps the reader's CURRENT page at distill
      // time (usually right after giving feedback, still on the same page),
      // not the page each individual exchange happened on -- tracking that
      // precisely would mean storing a location per message, out of scope
      // for this pass. Good enough given feedback is normally immediate.
      currentLocation,
    )
      .then((candidate) => candidate && addSkill(candidate))
      .catch(() => {})
  }

  if (!material) return null

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{material.title}</p>
          <p className="mt-0.5 truncate text-xs text-[var(--color-ink-muted)]">
            {currentLocation.chapterId
              ? `Su: ${currentLocation.sectionTitle ?? currentLocation.chapterTitle}`
              : 'Chiedi ad Aria su questo materiale'}
          </p>
        </div>
        <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]">
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-hidden p-4">
      {!hasGeminiKey() ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <KeyRound size={20} className="text-[var(--color-ink-muted)]" />
          <p className="text-sm text-[var(--color-ink-muted)]">Serve una chiave Gemini gratuita per chattare.</p>
          <Link to="/impostazioni">
            <Button size="sm">Vai alle Impostazioni</Button>
          </Link>
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto">
            {readingFile && (
              <p className="rounded-xl bg-[var(--color-surface-2)] p-3.5 text-sm text-[var(--color-ink-muted)] animate-pulse-soft">Leggo il materiale...</p>
            )}
            {!readingFile && messages.length === 0 && (
              <p className="rounded-xl bg-[var(--color-surface-2)] p-3.5 text-sm text-[var(--color-ink-muted)]">
                Puoi chiedermi di riassumere, farti domande di ripasso, o spiegarti un punto di questo materiale.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
                <div
                  className={cn(
                    'max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm',
                    m.role === 'user' ? 'bg-[var(--color-primary)] text-white' : 'border border-[var(--color-border)]',
                  )}
                >
                  {m.text}
                </div>
                {m.role === 'model' && <MessageFeedback callEvent={m.callEvent} onGiven={tryDistill} />}
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-[var(--color-border)] px-3.5 py-2 text-sm text-[var(--color-ink-muted)] animate-pulse-soft">
                  <Sparkles size={12} className="mr-1 inline" /> penso...
                </div>
              </div>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
            className="mt-3 flex items-end gap-2"
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder="Fai una domanda..."
              rows={1}
              className="max-h-28 min-h-11 py-2.5"
            />
            <Button type="submit" size="icon" disabled={!input.trim() || loading || readingFile}>
              <Send size={16} />
            </Button>
          </form>
        </div>
      )}
      </div>
    </div>
  )
}
