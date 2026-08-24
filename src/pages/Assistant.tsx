import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Send, Sparkles, KeyRound, Paperclip, X, UploadCloud } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Textarea } from '../components/ui/Input'
import { useAppStore } from '../store/useAppStore'
import { askAria, hasGeminiKey, GEMINI_MODEL, type ChatAttachment } from '../lib/gemini'
import { AttachmentViewer } from '../components/assistant/AttachmentViewer'
import { MessageFeedback } from '../components/shared/MessageFeedback'
import { Link } from 'react-router-dom'
import { cn } from '../lib/utils'
import type { ChatMessage } from '../lib/types'
import { routeSkills, skillsAsPromptContext, tagsFromText, maybeDistillFromExchanges } from '../lib/skills'
import { enforceSkillBudget } from '../lib/contextBudget'
import { useToastStore } from '../store/toastStore'

const BREAKDOWN_PREFIX = 'Aiutami a spezzare in piccoli passi questo compito:'

const SUGGESTIONS = [
  'Aiutami a iniziare, non so da dove partire',
  'Sono in ansia per un esame, aiutami a organizzarmi',
  'Spezza in piccoli passi: scrivere la tesina di storia',
]

const ATTACHMENT_STORE_LIMIT = 4 * 1024 * 1024 // don't bloat localStorage past this
// Gemini's inlineData request body has a real hard cap (~20MB total, base64
// included, base64 itself already ~1.33x the raw file). Reject client-side
// with a clear reason instead of silently sending a request that will 400 --
// the previous behavior surfaced every such failure as "check your API key",
// which sent debugging in the wrong direction (this was the reported bug).
const ATTACHMENT_SEND_LIMIT = 15 * 1024 * 1024

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function Assistant() {
  const chat = useAppStore((s) => s.chat)
  const addChatMessage = useAppStore((s) => s.addChatMessage)
  const skills = useAppStore((s) => s.skills)
  const skillEvents = useAppStore((s) => s.skillEvents)
  const librarianEnabled = useAppStore((s) => s.librarianEnabled)
  const logSkillCall = useAppStore((s) => s.logSkillCall)
  const addSkill = useAppStore((s) => s.addSkill)
  const push = useToastStore((s) => s.push)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [keyMissing, setKeyMissing] = useState(!hasGeminiKey())
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [viewingAttachment, setViewingAttachment] = useState<ChatMessage | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const location = useLocation()

  useEffect(() => {
    const prefill = (location.state as { prefill?: string } | null)?.prefill
    if (prefill) setInput(prefill)
  }, [location.state])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [chat, loading])

  async function send(text?: string) {
    const value = (text ?? input).trim()
    if (!value && !pendingFile) return
    setKeyMissing(!hasGeminiKey())
    if (!hasGeminiKey()) return

    const file = pendingFile
    setPendingFile(null)

    let attachment: ChatAttachment | undefined
    let dataUrl: string | undefined
    if (file) {
      const full = await readAsDataUrl(file)
      attachment = { data: full.split(',')[1] ?? '', mimeType: file.type || 'application/octet-stream' }
      if (file.size <= ATTACHMENT_STORE_LIMIT) dataUrl = full
    }
    addChatMessage({
      role: 'user',
      text: value || `(file allegato: ${file?.name})`,
      attachmentName: file?.name,
      attachmentMimeType: file?.type,
      attachmentDataUrl: dataUrl,
    })
    setInput('')
    setLoading(true)
    try {
      const domain = value.startsWith(BREAKDOWN_PREFIX) ? 'task_breakdown' : 'chat'
      const history = [...useAppStore.getState().chat, { role: 'user' as const, text: value || `Guarda il file allegato (${file?.name}) e aiutami con questo.`, id: '', createdAt: '' }]
      let skillContext = ''
      let callEvent
      if (librarianEnabled) {
        const retrieved = routeSkills(skills, domain, tagsFromText(value), 2, 1, skillEvents)
        const baseText = history.map((m) => m.text).join('\n')
        const budgeted = enforceSkillBudget(baseText, retrieved, GEMINI_MODEL)
        if (budgeted.baseOverBudget || budgeted.droppedSkillIds.length > 0) {
          console.warn('[contextBudget] skill context ridotto per budget', { domain, ...budgeted })
        }
        skillContext = skillsAsPromptContext(budgeted.skills)
        callEvent = logSkillCall(domain, budgeted.skills.length > 0 ? 'F' : 'B', budgeted.skills.map((s) => s.id), GEMINI_MODEL)
      } else {
        callEvent = logSkillCall(domain, 'B', [], GEMINI_MODEL)
      }
      const reply = await askAria(history.map((m) => ({ role: m.role, text: m.text })), attachment, skillContext)
      addChatMessage({ role: 'model', text: reply, skillEventRef: callEvent.id, skillDomain: domain })
    } catch (err) {
      console.error('[Assistant] askAria failed', err)
      const message = err instanceof Error ? err.message : String(err)
      const looksLikeKeyIssue = /api.?key|permission|401|403/i.test(message)
      // Distinguishes "Gemini is genuinely overloaded right now" from a
      // generic failure (2026-08-24, real live occurrence the same day as
      // the 3.6->3.7 bump: withRetry already retries 503/429/500/504 up to
      // 4 times, so if one of those still reaches here, retrying AGAIN
      // immediately is unlikely to help -- worth telling the user that
      // explicitly instead of a message that reads like something's broken.
      const looksOverloaded = /50[034]|429|overloaded|high demand/i.test(message)
      addChatMessage({
        role: 'model',
        text: looksLikeKeyIssue
          ? 'Non riesco a rispondere — controlla la tua chiave Gemini nelle Impostazioni.'
          : file
            ? 'Non sono riuscita a leggere quel file. Prova con un altro formato (PDF, immagine o testo) o senza allegato.'
            : looksOverloaded
              ? 'Gemini è sovraccarico in questo momento (non è la tua chiave) — ho già riprovato qualche volta in automatico. Aspetta un minuto e riprova.'
              : 'Non riesco a rispondere in questo momento, riprova tra poco.',
      })
    } finally {
      setLoading(false)
    }
  }

  function tryDistill(domain: ChatMessage['skillDomain']) {
    if (!domain) return
    maybeDistillFromExchanges(
      domain,
      useAppStore.getState().chat.map((m) => ({ role: m.role, text: m.text, skillEventRef: m.skillEventRef })),
      useAppStore.getState().skillEvents,
    )
      .then((candidate) => candidate && addSkill(candidate))
      .catch(() => {}) // best-effort, never surfaced to the user
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    if (file.size > ATTACHMENT_SEND_LIMIT) {
      push({ title: 'File troppo grande', description: `Massimo ${Math.floor(ATTACHMENT_SEND_LIMIT / (1024 * 1024))}MB per allegato.`, tone: 'warn' })
      return
    }
    setPendingFile(file)
  }

  return (
    <div
      className="relative flex h-[calc(100dvh-8.5rem)] flex-col lg:h-[calc(100dvh-6rem)]"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        handleFiles(e.dataTransfer.files)
      }}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-[var(--color-bg)]/90 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[var(--color-primary)] px-10 py-8 text-center">
            <UploadCloud size={28} className="text-[var(--color-primary)]" />
            <p className="text-sm font-medium">Rilascia per allegare</p>
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-primary)] text-white">
          <Sparkles size={16} />
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Aria</h1>
          <p className="text-xs text-[var(--color-ink-muted)] leading-tight">qui per aiutarti a partire, non per giudicare</p>
        </div>
      </div>

      {keyMissing ? (
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <KeyRound size={22} className="text-[var(--color-ink-muted)]" />
          <p className="text-sm text-[var(--color-ink-muted)]">
            Per chattare con Aria serve una chiave API gratuita di Google Gemini.
          </p>
          <Link to="/impostazioni">
            <Button size="sm">Vai alle Impostazioni</Button>
          </Link>
        </Card>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pr-1">
            {chat.length === 0 && (
              <div className="flex flex-col gap-2 pt-4">
                <p className="text-sm text-[var(--color-ink-muted)]">Prova con qualcosa tipo, o allega direttamente un file/foto:</p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 text-left text-sm hover:border-[var(--color-primary)]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {chat.map((m) => (
              <div key={m.id} className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
                <div
                  className={cn(
                    'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm animate-pop',
                    m.role === 'user' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface)] border border-[var(--color-border)]',
                  )}
                >
                  {m.attachmentName && (
                    <button
                      onClick={() => setViewingAttachment(m)}
                      className={cn(
                        'mb-1.5 flex items-center gap-1.5 rounded-lg text-xs underline decoration-dotted opacity-90 hover:opacity-100',
                        m.role === 'user' ? 'text-white' : 'text-[var(--color-ink-muted)]',
                      )}
                    >
                      <Paperclip size={11} /> {m.attachmentName}
                    </button>
                  )}
                  {m.text}
                </div>
                {m.role === 'model' && (
                  <MessageFeedback callEvent={skillEvents.find((e) => e.id === m.skillEventRef)} onGiven={() => tryDistill(m.skillDomain)} />
                )}
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm text-[var(--color-ink-muted)] animate-pulse-soft">
                  Aria sta scrivendo...
                </div>
              </div>
            )}
          </div>

          {pendingFile && (
            <div className="mt-2 flex items-center gap-2 self-start rounded-xl bg-[var(--color-surface-2)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)]">
              <Paperclip size={12} />
              <span className="max-w-[220px] truncate">{pendingFile.name}</span>
              <button onClick={() => setPendingFile(null)} className="text-[var(--color-ink-muted)] hover:text-[var(--color-warn)]">
                <X size={12} />
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
            className="mt-3 flex items-end gap-2"
          >
            <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
            <Button type="button" variant="soft" size="icon" onClick={() => fileInputRef.current?.click()} title="Allega file">
              <Paperclip size={16} />
            </Button>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder="Scrivi ad Aria..."
              rows={1}
              className="max-h-32 min-h-11 py-2.5"
            />
            <Button type="submit" size="icon" disabled={(!input.trim() && !pendingFile) || loading}>
              <Send size={17} />
            </Button>
          </form>
        </>
      )}

      {viewingAttachment && (
        <AttachmentViewer
          name={viewingAttachment.attachmentName!}
          mimeType={viewingAttachment.attachmentMimeType}
          dataUrl={viewingAttachment.attachmentDataUrl}
          onClose={() => setViewingAttachment(null)}
        />
      )}
    </div>
  )
}
