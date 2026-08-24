import { useRef, useState } from 'react'
import { Link2, StickyNote, Paperclip } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { Input, Textarea } from '../ui/Input'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/useAppStore'
import { useAddFileMaterial } from '../../lib/useAddFileMaterial'
import type { MaterialType } from '../../lib/types'
import { cn } from '../../lib/utils'

export function MaterialDialog({ open, onOpenChange, subjectId }: { open: boolean; onOpenChange: (o: boolean) => void; subjectId: string }) {
  const addMaterial = useAppStore((s) => s.addMaterial)
  const addFileMaterial = useAddFileMaterial()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [type, setType] = useState<MaterialType>('link')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)

  function reset() {
    setTitle('')
    setUrl('')
    setContent('')
    setFile(null)
    setType('link')
  }

  function handleFile(f: File) {
    setFile(f)
    if (!title.trim()) setTitle(f.name.replace(/\.[^./]+$/, ''))
  }

  async function submit() {
    if (!title.trim()) return
    setSaving(true)
    try {
      if (type === 'file' && file) {
        await addFileMaterial(subjectId, file, title.trim())
      } else if (type === 'link' && url.trim()) {
        addMaterial({ subjectId, type: 'link', title: title.trim(), url: url.trim() })
      } else if (type === 'note') {
        addMaterial({ subjectId, type: 'note', title: title.trim(), content })
      } else {
        return
      }
      reset()
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  const tabs: { key: MaterialType; label: string; icon: typeof Link2 }[] = [
    { key: 'link', label: 'Link', icon: Link2 },
    { key: 'note', label: 'Appunto', icon: StickyNote },
    { key: 'file', label: 'File', icon: Paperclip },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Aggiungi materiale">
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setType(t.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-medium ${
                type === t.key ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]'
              }`}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
        </div>

        <Input placeholder="Titolo" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />

        {type === 'link' && <Input placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />}
        {type === 'note' && <Textarea placeholder="Scrivi qui il tuo appunto..." rows={5} value={content} onChange={(e) => setContent(e.target.value)} />}
        {type === 'file' && (
          <div>
            <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <button
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                const f = e.dataTransfer.files?.[0]
                if (f) handleFile(f)
              }}
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed py-6 text-sm transition-colors',
                dragOver ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-[var(--color-ink)]' : 'border-[var(--color-border)] text-[var(--color-ink-muted)] hover:border-[var(--color-primary)]',
              )}
            >
              <Paperclip size={16} />
              {file ? file.name : 'Trascina un file qui, o clicca per scegliere'}
            </button>
          </div>
        )}

        <Button onClick={submit} size="lg" disabled={saving || !title.trim() || (type === 'link' && !url.trim()) || (type === 'file' && !file)}>
          {saving ? 'Salvo...' : 'Salva'}
        </Button>
      </div>
    </Dialog>
  )
}
