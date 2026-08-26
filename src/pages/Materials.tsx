import { useState } from 'react'
import {
  Plus,
  Link2,
  StickyNote,
  Paperclip,
  Trash2,
  ArrowLeft,
  UploadCloud,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles as SparklesIcon,
  Highlighter,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  BookOpen,
} from 'lucide-react'
import { Card, CardTitle, CardSubtitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { SubjectDialog } from '../components/materials/SubjectDialog'
import { MaterialDialog } from '../components/materials/MaterialDialog'
import { MaterialAskPanel } from '../components/materials/MaterialAskPanel'
import { MaterialPlanPanel } from '../components/materials/MaterialPlanPanel'
import { StudyPlanPanel } from '../components/materials/StudyPlanPanel'
import { MaterialViewer } from '../components/materials/MaterialViewer'
import { useAppStore } from '../store/useAppStore'
import { useToastStore } from '../store/toastStore'
import { useAddFileMaterial } from '../lib/useAddFileMaterial'
import { cn, contrastTextColor } from '../lib/utils'

const typeIcon = { link: Link2, note: StickyNote, file: Paperclip } as const

export default function Materials() {
  const subjects = useAppStore((s) => s.subjects)
  const materials = useAppStore((s) => s.materials)
  const highlights = useAppStore((s) => s.highlights)
  const chapters = useAppStore((s) => s.chapters)
  const removeSubject = useAppStore((s) => s.removeSubject)
  const removeMaterial = useAppStore((s) => s.removeMaterial)
  const addFileMaterial = useAddFileMaterial()
  const push = useToastStore((s) => s.push)

  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(null)
  const [activeMaterialId, setActiveMaterialId] = useState<string | null>(null)
  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false)
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [planOpen, setPlanOpen] = useState(false)
  const [filePlanOpen, setFilePlanOpen] = useState(false)
  const [listCollapsed, setListCollapsed] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [highlightsOpen, setHighlightsOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [jumpTarget, setJumpTarget] = useState<{ page: number; nonce: number; highlightId?: string } | undefined>()

  const activeSubject = subjects.find((s) => s.id === activeSubjectId)
  // Exam papers uploaded through Cheat Study are excluded here (2026-08-26,
  // real user correction: "le tracce di esame NON devono essere messe in
  // materiale, non c'entrano un cazzo") -- they live only in Cheat Study's
  // own list, never in the general study-material library.
  const activeMaterials = materials.filter((m) => m.subjectId === activeSubjectId && !m.isExamPaper)
  const activeMaterial = activeMaterials.find((m) => m.id === activeMaterialId) ?? activeMaterials[0] ?? null

  async function handleDrop(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return // a text-selection drag inside the PDF viewer, not a file drop
    e.preventDefault()
    setDragOver(false)
    if (!activeSubjectId) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    for (const file of files) {
      const created = await addFileMaterial(activeSubjectId, file)
      if (created) setActiveMaterialId(created.id)
    }
    push({ title: files.length > 1 ? `${files.length} file aggiunti` : 'File aggiunto', tone: 'good' })
  }

  if (activeSubject) {
    return (
      <div className="relative flex h-[calc(100dvh-7.5rem)] flex-col lg:h-[calc(100dvh-5rem)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setActiveSubjectId(null)
                setActiveMaterialId(null)
              }}
              className="flex items-center gap-1.5 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              <ArrowLeft size={16} />
            </button>
            <span className="grid h-9 w-9 place-items-center rounded-xl text-sm font-semibold" style={{ background: activeSubject.color, color: contrastTextColor(activeSubject.color) }}>
              {activeSubject.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <h1 className="text-lg font-semibold leading-tight">{activeSubject.name}</h1>
              <CardSubtitle className="leading-tight">{activeMaterials.length} materiali</CardSubtitle>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" size="sm" onClick={() => setPlanOpen(true)}>
              <SparklesIcon size={14} /> Piano (tutta la materia)
            </Button>
            <Button size="sm" onClick={() => setMaterialDialogOpen(true)}>
              <Plus size={14} /> Aggiungi
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 gap-3">
          {!listCollapsed && (
            <div
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('Files')) return
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className="relative flex w-[220px] shrink-0 flex-col gap-2 overflow-y-auto"
            >
              {dragOver && (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-[var(--color-bg)]/95 p-2 text-center backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[var(--color-primary)] px-4 py-6">
                    <UploadCloud size={24} className="text-[var(--color-primary)]" />
                    <p className="text-xs font-medium">Rilascia qui</p>
                  </div>
                </div>
              )}
              <button
                onClick={() => setListCollapsed(true)}
                className="mb-1 inline-flex items-center gap-1.5 self-start text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              >
                <PanelLeftClose size={14} /> Comprimi
              </button>
              {activeMaterials.map((m) => {
                const Icon = typeIcon[m.type]
                const selected = activeMaterial?.id === m.id
                return (
                  <button
                    key={m.id}
                    onClick={() => setActiveMaterialId(m.id)}
                    className={cn(
                      'group flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs',
                      selected ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)]' : 'border-[var(--color-border)] hover:border-[var(--color-ink-muted)]',
                    )}
                  >
                    <Icon size={13} className="shrink-0 text-[var(--color-ink-muted)]" />
                    <span className="min-w-0 flex-1 truncate">{m.title}</span>
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeMaterial(m.id)
                        if (selected) setActiveMaterialId(null)
                      }}
                      className="shrink-0 rounded p-0.5 text-[var(--color-ink-muted)] opacity-0 hover:text-[var(--color-warn)] group-hover:opacity-100"
                    >
                      <Trash2 size={12} />
                    </span>
                  </button>
                )
              })}
              {activeMaterials.length === 0 && (
                <p className="rounded-xl bg-[var(--color-surface-2)] p-3 text-center text-xs text-[var(--color-ink-muted)]">
                  Vuoto. Trascina un file qui, o aggiungi un link/appunto.
                </p>
              )}

              {activeMaterial && chapters.some((c) => c.materialId === activeMaterial.id) && (
                <div className="mt-2 border-t border-[var(--color-border)] pt-2">
                  <button
                    onClick={() => setOutlineOpen((o) => !o)}
                    className="mb-1.5 flex w-full items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                  >
                    {outlineOpen ? <ChevronDown size={13} /> : <ChevronRightIcon size={13} />}
                    <BookOpen size={13} /> Indice
                  </button>
                  {outlineOpen && (
                    <div className="flex flex-col gap-0.5">
                      {chapters
                        .filter((c) => c.materialId === activeMaterial.id)
                        .sort((a, b) => a.order - b.order)
                        .map((c) => (
                          <div key={c.id}>
                            <button
                              onClick={() => setJumpTarget({ page: c.startPage, nonce: Date.now() })}
                              className="w-full truncate rounded-lg px-2 py-1 text-left text-[11px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                              title={c.title}
                            >
                              {c.title}
                            </button>
                            {c.subsections.map((s) => (
                              <button
                                key={s.id}
                                onClick={() => setJumpTarget({ page: s.startPage, nonce: Date.now() })}
                                className="w-full truncate rounded-lg py-1 pl-5 pr-2 text-left text-[11px] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                                title={s.title}
                              >
                                {s.title}
                              </button>
                            ))}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {activeMaterial && (
                <div className="mt-2 border-t border-[var(--color-border)] pt-2">
                  <button
                    onClick={() => setHighlightsOpen((o) => !o)}
                    className="mb-1.5 flex w-full items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                  >
                    {highlightsOpen ? <ChevronDown size={13} /> : <ChevronRightIcon size={13} />}
                    <Highlighter size={13} /> Evidenziazioni
                  </button>
                  {highlightsOpen && (
                    <div className="flex flex-col gap-1">
                      {highlights
                        .filter((h) => h.materialId === activeMaterial.id)
                        .sort((a, b) => a.page - b.page)
                        .map((h) => (
                          <button
                            key={h.id}
                            onClick={() => setJumpTarget({ page: h.page, nonce: Date.now(), highlightId: h.id })}
                            className="rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-left text-[11px] hover:border-[var(--color-ink-muted)]"
                          >
                            <span className="text-[var(--color-ink-muted)]">p.{h.page} · </span>
                            <span className="truncate text-[var(--color-ink)]">{h.text}</span>
                            {h.note && <p className="mt-0.5 truncate text-[var(--color-ink-muted)]">📝 {h.note}</p>}
                          </button>
                        ))}
                      {highlights.filter((h) => h.materialId === activeMaterial.id).length === 0 && (
                        <p className="px-1 text-[11px] text-[var(--color-ink-muted)]">
                          Seleziona del testo nel PDF per evidenziarlo e aggiungere un appunto.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="min-w-0 flex-1">
            {listCollapsed && (
              <button
                onClick={() => setListCollapsed(false)}
                className="mb-2 inline-flex items-center gap-1.5 self-start text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              >
                <PanelLeftOpen size={14} /> Materiali
              </button>
            )}
            {activeMaterial ? (
              <MaterialViewer
                material={activeMaterial}
                onAskAria={() => setAskOpen(true)}
                onOpenPlan={() => setFilePlanOpen(true)}
                jumpTarget={jumpTarget}
                onPageChange={setCurrentPage}
              />
            ) : (
              <div className="flex h-full min-h-[300px] items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-ink-muted)]">
                Trascina un file qui, o aggiungi un link/appunto per iniziare.
              </div>
            )}
          </div>

          {filePlanOpen && activeMaterial && <MaterialPlanPanel material={activeMaterial} onClose={() => setFilePlanOpen(false)} />}
          {askOpen && activeMaterial && <MaterialAskPanel material={activeMaterial} onClose={() => setAskOpen(false)} currentPage={currentPage} />}
        </div>

        <MaterialDialog
          open={materialDialogOpen}
          onOpenChange={setMaterialDialogOpen}
          subjectId={activeSubject.id}
        />
        <StudyPlanPanel subject={activeSubject} materials={activeMaterials} open={planOpen} onClose={() => setPlanOpen(false)} />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Materiali</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Organizza le fonti per materia.</p>
        </div>
        <Button size="sm" onClick={() => setSubjectDialogOpen(true)}>
          <Plus size={16} /> Materia
        </Button>
      </div>

      <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4', subjects.length === 0 && 'grid-cols-1 sm:grid-cols-1 lg:grid-cols-1')}>
        {subjects.map((s) => {
          const count = materials.filter((m) => m.subjectId === s.id && !m.isExamPaper).length
          return (
            <Card key={s.id} className="group relative cursor-pointer p-4 transition-transform hover:-translate-y-0.5" onClick={() => setActiveSubjectId(s.id)}>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeSubject(s.id)
                }}
                className="absolute right-2 top-2 rounded-lg p-1 text-[var(--color-ink-muted)] opacity-0 hover:text-[var(--color-warn)] group-hover:opacity-100"
              >
                <Trash2 size={13} />
              </button>
              <span className="mb-3 grid h-10 w-10 place-items-center rounded-xl text-base font-semibold" style={{ background: s.color, color: contrastTextColor(s.color) }}>
                {s.name.slice(0, 1).toUpperCase()}
              </span>
              <CardTitle className="truncate">{s.name}</CardTitle>
              <Badge className="mt-2">{count} materiali</Badge>
            </Card>
          )
        })}

        <button
          onClick={() => setSubjectDialogOpen(true)}
          className="flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-[var(--radius-2xl)] border-2 border-dashed border-[var(--color-border)] text-sm text-[var(--color-ink-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-ink)]"
        >
          <Plus size={20} />
          Nuova materia
        </button>
      </div>

      <SubjectDialog open={subjectDialogOpen} onOpenChange={setSubjectDialogOpen} />
    </div>
  )
}
