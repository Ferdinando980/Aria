import { useEffect, useRef, useState } from 'react'
import { Loader2, AlertTriangle, RefreshCw, Edit3, X } from 'lucide-react'
import { SidePanel } from '../ui/SidePanel'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/useAppStore'
import { useToastStore } from '../../store/toastStore'
import { useReplaceMaterialFile } from '../../lib/useReplaceMaterialFile'
import { isLocalConvertAvailable, startWordEdit, pollWordEdit } from '../../lib/localConvert'
import type { Material } from '../../lib/types'

type ServiceStatus = 'checking' | 'up' | 'down'
type FlowState = 'idle' | 'starting' | 'editing' | 'converting'

const POLL_INTERVAL_MS = 2000

/**
 * "Modifica in Word" (2026-08-20, fully automated 2026-08-21 per explicit
 * request: "voglio che mi faccia tutte queste operazioni in automatico, e
 * che io debba solo modificare il file word") -- the genuinely-rewritable
 * alternative to PdfEditor.tsx's cover-and-draw correction, since no free
 * client-side library does in-place PDF text rewriting (verified, not
 * assumed). One click sends the PDF to the local sidecar
 * (pdf-convert-service/server.js), which converts it to .docx, opens it in
 * the user's default editor automatically, and watches it -- the moment a
 * real save is detected (content actually changed, not just touched by the
 * editor opening it) it reconverts to PDF on its own. This just polls until
 * that's ready, then saves it as the material's real file. The only manual
 * step left is editing and saving the Word document, as requested.
 *
 * Logged through the same skill_events CALL/OUTCOME pipeline as every other
 * Aria domain (explicit user request) even though no Gemini call is
 * involved -- see the 'pdf_edit' comment on SkillDomain in types.ts.
 */
export function WordEditFlow({
  material,
  fileUrl,
  open,
  onOpenChange,
  onSaved,
}: {
  material: Material
  fileUrl: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (newFileUrl: string) => void
}) {
  const push = useToastStore((s) => s.push)
  const logSkillCall = useAppStore((s) => s.logSkillCall)
  const recordSkillOutcome = useAppStore((s) => s.recordSkillOutcome)
  const replaceMaterialFile = useReplaceMaterialFile()

  const [status, setStatus] = useState<ServiceStatus>('checking')
  const [flow, setFlow] = useState<FlowState>('idle')
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (!open) {
      stopPolling()
      setFlow('idle')
      return
    }
    cancelledRef.current = false
    setStatus('checking')
    isLocalConvertAvailable().then((up) => {
      setStatus(up ? 'up' : 'down')
      if (up) beginEdit()
    })
    return () => stopPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function stopPolling() {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    pollTimerRef.current = null
  }

  async function checkAgain() {
    setStatus('checking')
    const up = await isLocalConvertAvailable()
    setStatus(up ? 'up' : 'down')
    if (up) beginEdit()
  }

  async function beginEdit() {
    if (!fileUrl) return
    const callEvent = logSkillCall('pdf_edit', 'B', [], 'local-libreoffice')
    setFlow('starting')
    try {
      const pdfBlob = await fetch(fileUrl).then((r) => r.blob())
      const jobId = await startWordEdit(pdfBlob)
      if (cancelledRef.current) return
      setFlow('editing')
      poll(jobId, callEvent)
    } catch (err) {
      console.error('[WordEditFlow] start-edit failed', err)
      push({ title: 'Non sono riuscita ad aprire il documento', description: 'Controlla che il servizio locale sia avviato.', tone: 'warn' })
      recordSkillOutcome(callEvent, 'negative')
      setFlow('idle')
    }
  }

  function poll(jobId: string, callEvent: ReturnType<typeof logSkillCall>) {
    pollTimerRef.current = setTimeout(async () => {
      if (cancelledRef.current) return
      try {
        const result = await pollWordEdit(jobId)
        if (cancelledRef.current) return
        if (!result.done) {
          setFlow(result.status === 'converting' ? 'converting' : 'editing')
          poll(jobId, callEvent)
          return
        }
        if (!result.ok) {
          push({ title: 'Conversione non riuscita', description: result.error, tone: 'warn' })
          recordSkillOutcome(callEvent, 'negative')
          setFlow('idle')
          return
        }
        const ok = await replaceMaterialFile(material.id, material.fileName ?? 'documento.pdf', result.pdfBlob)
        if (!ok) {
          push({ title: 'Salvataggio non riuscito', tone: 'warn' })
          recordSkillOutcome(callEvent, 'negative')
          setFlow('idle')
          return
        }
        onSaved(URL.createObjectURL(result.pdfBlob))
        recordSkillOutcome(callEvent, 'positive')
        push({ title: 'File aggiornato con le modifiche', tone: 'good' })
        onOpenChange(false)
      } catch (err) {
        console.error('[WordEditFlow] poll failed', err)
        push({ title: 'Ho perso il contatto con il servizio locale', description: 'Riprova.', tone: 'warn' })
        recordSkillOutcome(callEvent, 'negative')
        setFlow('idle')
      }
    }, POLL_INTERVAL_MS)
  }

  function cancel() {
    cancelledRef.current = true
    stopPolling()
    onOpenChange(false)
  }

  return (
    <SidePanel open={open} onOpenChange={onOpenChange} title="Modifica in Word" subtitle={material.title}>
      <div className="flex flex-col gap-4">
        <p className="text-xs leading-relaxed text-[var(--color-ink-muted)]">
          Vera riscrittura del testo, non una correzione incollata sopra: il documento si apre in Word/LibreOffice, tu correggi e salvi (Ctrl+S) — il
          resto succede da solo.
        </p>

        {status === 'checking' && (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] p-3 text-xs text-[var(--color-ink-muted)]">
            <Loader2 size={14} className="animate-spin" /> Controllo il servizio locale...
          </div>
        )}

        {status === 'down' && (
          <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-warn)]">
              <AlertTriangle size={13} /> Servizio locale non raggiungibile
            </p>
            <p className="text-xs text-[var(--color-ink-muted)]">
              Sul tuo PC, apri <span className="font-mono">Avvia servizio conversione PDF.bat</span> (cartella{' '}
              <span className="font-mono">pdf-convert-service</span>) e lascialo aperto, poi riprova.
            </p>
            <Button size="sm" variant="soft" onClick={checkAgain}>
              <RefreshCw size={13} /> Riprova
            </Button>
          </div>
        )}

        {status === 'up' && flow === 'starting' && (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] p-3 text-xs text-[var(--color-ink-muted)]">
            <Loader2 size={14} className="animate-spin" /> Preparo il documento e lo apro in Word...
          </div>
        )}

        {status === 'up' && flow === 'editing' && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--color-border)] px-4 py-8 text-center">
            <Edit3 size={22} className="text-[var(--color-primary)]" />
            <p className="text-sm font-medium text-[var(--color-ink)]">Il documento è aperto — correggilo e salva</p>
            <p className="text-xs text-[var(--color-ink-muted)]">Appena salvi (Ctrl+S), Aria se ne accorge da sola e aggiorna il PDF qui.</p>
            <Loader2 size={16} className="animate-spin text-[var(--color-ink-muted)]" />
            <Button size="sm" variant="ghost" onClick={cancel}>
              <X size={13} /> Annulla
            </Button>
          </div>
        )}

        {status === 'up' && flow === 'converting' && (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] p-3 text-xs text-[var(--color-ink-muted)]">
            <Loader2 size={14} className="animate-spin" /> Salvataggio rilevato — riconverto in PDF...
          </div>
        )}
      </div>
    </SidePanel>
  )
}
