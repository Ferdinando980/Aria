import { useEffect, useState } from 'react'
import { KeyRound, Cloud, CloudOff, Download, ExternalLink, LogOut, BookOpen } from 'lucide-react'
import { Card, CardTitle, CardSubtitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Switch } from '../components/ui/Switch'
import { useAppStore } from '../store/useAppStore'
import { useToastStore } from '../store/toastStore'
import { useAuthStore } from '../store/authStore'
import { getGeminiKey, setGeminiKey } from '../lib/gemini'
import { isSupabaseConfigured } from '../lib/supabase'
import { UpdateAppCard } from '../components/settings/UpdateAppCard'
import { cn } from '../lib/utils'
import { retrievalWasteAnalysis, domainsWithoutMeasuredBenefit } from '../lib/skills'

const DOMAIN_LABEL: Record<string, string> = {
  chat: 'Chat generale',
  task_breakdown: 'Scomposizione task',
  material_chat: 'Chat materiale',
  study_plan: 'Piano di studio',
  pdf_edit: 'Modifica PDF (Word)',
  material_knowledge: 'Conoscenza materiali',
  chapters: 'Rilevamento capitoli',
  flashcards: 'Flashcard',
  summary: 'Riassunti',
  formula_example: 'Esempi numerici',
  cheat_study: 'Cheat Study',
}
const STATUS_LABEL: Record<string, string> = { DRAFT: 'in prova', VERIFIED: 'verificata', PERSONAL_NOTE: 'appunto personale', REJECTED: 'scartata' }

function formatRate(r: number | null) {
  return r === null ? '—' : `${(r * 100).toFixed(0)}%`
}

export default function Settings() {
  const profile = useAppStore((s) => s.profile)
  const push = useToastStore((s) => s.push)
  const { session, signOut, requestPasswordReset } = useAuthStore()
  const [resettingPassword, setResettingPassword] = useState(false)
  const librarianEnabled = useAppStore((s) => s.librarianEnabled)
  const setLibrarianEnabled = useAppStore((s) => s.setLibrarianEnabled)
  const skills = useAppStore((s) => s.skills)
  const archivedSkills = useAppStore((s) => s.archivedSkills)
  const archivedMaterials = useAppStore((s) => s.archivedMaterials)
  const restoreSkill = useAppStore((s) => s.restoreSkill)
  const skillEvents = useAppStore((s) => s.skillEvents)
  const researchConsent = useAppStore((s) => s.profile.researchConsent ?? false)
  const setResearchConsent = useAppStore((s) => s.setResearchConsent)
  const skillSharingConsent = useAppStore((s) => s.profile.skillSharingConsent ?? false)
  const setSkillSharingConsent = useAppStore((s) => s.setSkillSharingConsent)
  const resyncSkillsForDomainFix = useAppStore((s) => s.resyncSkillsForDomainFix)
  const [resyncing, setResyncing] = useState(false)

  const [displayName, setDisplayName] = useState(profile.displayName)
  const [geminiKey, setGeminiKeyState] = useState(getGeminiKey())

  useEffect(() => setDisplayName(profile.displayName), [profile.displayName])

  function saveName() {
    useAppStore.setState((s) => ({ profile: { ...s.profile, displayName: displayName.trim() || 'Tu' } }))
    push({ title: 'Nome aggiornato', tone: 'good' })
  }

  function saveGeminiKey() {
    setGeminiKey(geminiKey)
    push({ title: 'Chiave salvata', description: 'Resta solo su questo dispositivo.', tone: 'good' })
  }

  function exportData() {
    const raw = localStorage.getItem('aria-app-storage')
    const blob = new Blob([raw ?? '{}'], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aria-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportSkillMetrics() {
    const wasteReport = retrievalWasteAnalysis(skillEvents)
    const blob = new Blob([JSON.stringify({ skills, archivedSkills, archivedMaterials, skillEvents, wasteReport }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aria-skill-metrics-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Impostazioni</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Tutto facoltativo — l'app funziona anche senza toccare nulla qui.</p>
      </div>

      <div className="flex flex-col gap-5">
        <UpdateAppCard />

        <Card>
          <CardTitle>Il tuo nome</CardTitle>
          <CardSubtitle className="mb-3">Come vuoi che ti chiami Aria.</CardSubtitle>
          <div className="flex gap-2">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <Button onClick={saveName}>Salva</Button>
          </div>
        </Card>

        <Card>
          <div className="mb-1 flex items-center gap-2">
            <KeyRound size={16} className="text-[var(--color-ink-muted)]" />
            <CardTitle>Chiave API Gemini</CardTitle>
          </div>
          <CardSubtitle className="mb-3">
            Gratuita, senza carta di credito.{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--color-primary)]">
              Creala su Google AI Studio <ExternalLink size={12} />
            </a>
          </CardSubtitle>
          <div className="flex gap-2">
            <Input type="password" placeholder="AIza..." value={geminiKey} onChange={(e) => setGeminiKeyState(e.target.value)} />
            <Button onClick={saveGeminiKey}>Salva</Button>
          </div>
        </Card>

        <Card>
          <div className="mb-1 flex items-center gap-2">
            {isSupabaseConfigured ? <Cloud size={16} className="text-[var(--color-good)]" /> : <CloudOff size={16} className="text-[var(--color-ink-muted)]" />}
            <CardTitle>Sync tra dispositivi</CardTitle>
          </div>

          {!isSupabaseConfigured ? (
            <CardSubtitle>
              Non ancora configurato. I tuoi dati restano solo su questo dispositivo. Vedi il README del progetto per collegare un account Supabase gratuito e sincronizzare PC e telefono.
            </CardSubtitle>
          ) : (
            <>
              <CardSubtitle className="mb-3">Connessa come {session?.user.email}. I dati si sincronizzano automaticamente su ogni dispositivo dove accedi con questa email.</CardSubtitle>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={resettingPassword}
                  onClick={async () => {
                    if (!session?.user.email) return
                    setResettingPassword(true)
                    try {
                      await requestPasswordReset(session.user.email)
                      push({ title: 'Email inviata', description: 'Apri il link per scegliere una nuova password.', tone: 'good' })
                    } catch {
                      push({ title: 'Non e\' andata', description: 'Riprova tra poco.', tone: 'warn' })
                    } finally {
                      setResettingPassword(false)
                    }
                  }}
                >
                  Cambia password
                </Button>
                <Button variant="outline" size="sm" onClick={signOut}>
                  <LogOut size={14} /> Esci
                </Button>
              </div>
            </>
          )}
        </Card>

        <Card>
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-[var(--color-ink-muted)]" />
              <CardTitle>Libreria di skill (sperimentale)</CardTitle>
            </div>
            <Switch checked={librarianEnabled} onCheckedChange={setLibrarianEnabled} />
          </div>
          <CardSubtitle className="mb-3">
            Quando attiva, Aria richiama quello che ha imparato dall'uso reale prima di risponderti. Ogni skill nasce "in prova" e, dopo abbastanza feedback positivo, diventa "verificata" (tecniche generali) o "appunto personale" (legate al tuo materiale specifico — restano sempre private, vedi sotto) — oppure viene scartata.
          </CardSubtitle>
          {skills.length > 0 && (
            <ul className="mb-3 flex flex-col gap-1.5 rounded-xl bg-[var(--color-surface-2)] p-2.5">
              {skills.map((sk) => (
                <li key={sk.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-[var(--color-ink)]">{sk.title}</span>
                  <span className="flex shrink-0 items-center gap-2 text-[var(--color-ink-muted)]">
                    <span>{DOMAIN_LABEL[sk.domain] ?? sk.domain}</span>
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5',
                        sk.status === 'VERIFIED' && 'bg-[var(--color-good)]/20 text-[var(--color-good)]',
                        sk.status === 'PERSONAL_NOTE' && 'bg-[var(--color-calm)]/20 text-[var(--color-calm)]',
                        sk.status === 'REJECTED' && 'bg-[var(--color-warn)]/20 text-[var(--color-warn)]',
                      )}
                    >
                      {STATUS_LABEL[sk.status]}
                    </span>
                    <span>
                      {sk.successes}/{sk.uses}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(() => {
            // Nomi esatti del documento di ricerca originale come etichetta
            // primaria (2026-08-24, richiesta esplicita utente: "mettimi i
            // nomi esatti equivalenti") -- i dettagli grezzi (F/B, conteggi)
            // restano visibili ma secondari, non sostituiti.
            //
            // accuracy = fPositiveRate/bPositiveRate (già calcolati).
            // Delta Retrieval = lift (fRate - bRate): l'effetto REALE del
            // richiamare una skill vs rispondere senza, stesso dominio,
            // stesso modello -- esattamente quello che "Delta Retrieval"
            // misura nella ricerca originale.
            // Delta Architecture NON si applica qui: quel nome, lato
            // ricerca, confronta modelli/architetture diverse (Expert vs
            // Small+Librarian) sullo STESSO task -- Aria chiama sempre lo
            // stesso modello (GEMINI_MODEL), non esiste un secondo braccio
            // architetturale da confrontare. Non è "non ancora misurato",
            // è strutturalmente un'altra domanda per questo sistema.
            const report = retrievalWasteAnalysis(skillEvents).filter((r) => r.fCalls > 0 || r.bCalls > 0)
            if (report.length === 0) return null
            return (
              <ul className="mb-3 flex flex-col gap-1.5 rounded-xl bg-[var(--color-surface-2)] p-2.5">
                {report.map((r) => (
                  <li key={r.domain} className="flex flex-col gap-0.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[var(--color-ink)]">{DOMAIN_LABEL[r.domain] ?? r.domain}</span>
                      <span className="text-[var(--color-ink-muted)]">
                        accuracy F {formatRate(r.fPositiveRate)} · accuracy B {formatRate(r.bPositiveRate)}
                        {r.lift !== null && (
                          <span className={r.lift > 0 ? ' text-[var(--color-good)]' : r.lift < 0 ? ' text-[var(--color-warn)]' : ''}>
                            {' '}
                            · Delta Retrieval {r.lift >= 0 ? '+' : ''}
                            {(r.lift * 100).toFixed(0)}pt
                          </span>
                        )}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--color-ink-muted)]">
                      ({r.fCalls} chiamate F, {r.bCalls} chiamate B)
                    </span>
                  </li>
                ))}
              </ul>
            )
          })()}
          {(() => {
            // Densità della libreria (2026-08-24): quanto le skill esistenti
            // vengono davvero riusate, per dominio -- skill/dominio e uso
            // medio. Un numero alto di skill mai richiamate (uses=0) è
            // densità bassa nonostante la libreria sia "piena": costruita
            // ma non utile, la distinzione che il documento originale
            // chiedeva esplicitamente di non confondere ("non confondere
            // 'la skill esiste' con 'la skill è utile'").
            const byDomain = new Map<string, { count: number; totalUses: number; unused: number }>()
            for (const sk of skills) {
              if (sk.status === 'REJECTED') continue
              const entry = byDomain.get(sk.domain) ?? { count: 0, totalUses: 0, unused: 0 }
              entry.count++
              entry.totalUses += sk.uses
              if (sk.uses === 0) entry.unused++
              byDomain.set(sk.domain, entry)
            }
            const rows = Array.from(byDomain.entries())
            if (rows.length === 0) return null
            return (
              <details className="mb-3 rounded-xl bg-[var(--color-surface-2)] p-2.5 text-xs">
                <summary className="cursor-pointer select-none text-[var(--color-ink-muted)]">Densità della libreria</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {rows.map(([domain, d]) => (
                    <li key={domain} className="flex items-center justify-between gap-2">
                      <span className="text-[var(--color-ink)]">{DOMAIN_LABEL[domain] ?? domain}</span>
                      <span className="text-[var(--color-ink-muted)]">
                        {d.count} skill · {(d.totalUses / d.count).toFixed(1)} usi/skill medi
                        {d.unused > 0 && <span className="text-[var(--color-warn)]"> · {d.unused} mai usate</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )
          })()}
          <details className="mb-3 rounded-xl bg-[var(--color-surface-2)] p-2.5 text-xs">
            <summary className="cursor-pointer select-none text-[var(--color-ink-muted)]">Metriche non ancora misurate (onestamente, non finte)</summary>
            <ul className="mt-2 flex flex-col gap-1.5 text-[var(--color-ink-muted)]">
              <li>
                <span className="text-[var(--color-ink)]">tok/task, tok/successo</span> — nessuna chiamata Gemini di Aria registra ancora i token
                reali usati (`usageMetadata` della risposta esiste nell'SDK, non viene ancora letto/salvato sugli eventi skill).
              </li>
              <li>
                <span className="text-[var(--color-ink)]">build cost, breakeven</span> — il costo di DISTILLARE una skill nuova non è mai loggato
                come evento (le chiamate di distillazione non passano da logSkillCall); senza quel costo, breakeven (dopo quanti usi il richiamo
                ripaga la costruzione) non è calcolabile onestamente.
              </li>
            </ul>
          </details>
          {(() => {
            const blocked = domainsWithoutMeasuredBenefit(skillEvents)
            if (blocked.length === 0) return null
            return (
              <ul className="mb-3 flex flex-col gap-1.5 rounded-xl bg-[var(--color-warn)]/10 p-2.5">
                {blocked.map((b) => (
                  <li key={b.domain} className="text-xs">
                    <span className="font-medium text-[var(--color-warn)]">{DOMAIN_LABEL[b.domain] ?? b.domain}</span>
                    <span className="text-[var(--color-ink-muted)]"> — {b.reason}</span>
                  </li>
                ))}
              </ul>
            )
          })()}
          {archivedSkills.length > 0 && (
            // <details> on purpose (2026-08-21): "recuperabile ma non usato a
            // primo impatto" -- collapsed by default, nothing about a
            // deleted material's old knowledge should be the first thing
            // visible here, but it's one click away, not gone.
            <details className="mb-3 rounded-xl bg-[var(--color-surface-2)] p-2.5 text-xs">
              <summary className="cursor-pointer select-none text-[var(--color-ink-muted)]">
                Skill archiviate ({archivedSkills.length}) — materiali cancellati
              </summary>
              <ul className="mt-2 flex flex-col gap-1.5">
                {archivedSkills.map((sk) => (
                  <li key={sk.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[var(--color-ink)]" title={sk.content}>
                      {sk.title}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-[var(--color-ink-muted)]">{DOMAIN_LABEL[sk.domain] ?? sk.domain}</span>
                      <button
                        onClick={() => restoreSkill(sk.id)}
                        className="rounded-lg px-1.5 py-0.5 text-[var(--color-primary)] hover:bg-[var(--color-surface)]"
                      >
                        Ripristina
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {archivedMaterials.length > 0 && (
            // Read-only on purpose (2026-08-21): unlike skills, materials
            // aren't auto- or manually-restored here -- only their skills
            // are (see addSubject()'s area-of-interest recognition). This
            // is purely "recuperabile" in the sense of visible/inspectable,
            // same collapsed-by-default spirit as the skills disclosure.
            <details className="mb-3 rounded-xl bg-[var(--color-surface-2)] p-2.5 text-xs">
              <summary className="cursor-pointer select-none text-[var(--color-ink-muted)]">
                Materiali archiviati ({archivedMaterials.length}) — materie cancellate
              </summary>
              <ul className="mt-2 flex flex-col gap-1.5">
                {archivedMaterials.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[var(--color-ink)]">{m.title}</span>
                    <span className="shrink-0 text-[var(--color-ink-muted)]">area: {m.areaOfInterest}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" size="sm" onClick={exportSkillMetrics}>
              <Download size={14} /> Esporta metriche (JSON)
            </Button>
            {isSupabaseConfigured && (
              <Button
                variant="soft"
                size="sm"
                disabled={resyncing}
                onClick={async () => {
                  setResyncing(true)
                  const { succeeded, failed } = await resyncSkillsForDomainFix()
                  setResyncing(false)
                  if (failed === 0) push({ title: `${succeeded} skill risincronizzate`, tone: 'good' })
                  else push({ title: `${succeeded} ok, ${failed} ancora non sincronizzate`, description: 'Hai eseguito la migrazione Supabase del 24/08? Riprova dopo.', tone: 'warn' })
                }}
              >
                {resyncing ? 'Risincronizzo...' : 'Risincronizza skill'}
              </Button>
            )}
          </div>
        </Card>

        <Card>
          <div className="mb-1 flex items-center justify-between gap-2">
            <CardTitle>Contribuisci alla ricerca</CardTitle>
            <Switch checked={researchConsent} onCheckedChange={setResearchConsent} />
          </div>
          <CardSubtitle>
            Se attivo, i tuoi eventi di utilizzo della libreria di skill (quali skill vengono richiamate, se hanno
            aiutato — mai il contenuto delle skill, mai le tue note personali) possono essere inclusi in analisi
            aggregate insieme ad altri utenti. Acceso di default per il tuo account, revocabile in ogni momento. La
            tua vista personale qui sopra non dipende da questa scelta.
          </CardSubtitle>
        </Card>

        <Card>
          <div className="mb-1 flex items-center justify-between gap-2">
            <CardTitle>Condividi skill con altri utenti</CardTitle>
            <Switch checked={skillSharingConsent} onCheckedChange={setSkillSharingConsent} />
          </div>
          <CardSubtitle>
            Diverso dal consenso sopra: qui si tratta del CONTENUTO delle tue skill (non solo eventi d'uso) reso
            visibile e utilizzabile da altri account. Spento di default. Anche se acceso, solo le skill di tipo
            "procedura" (es. come spezzare un task, come titolare un capitolo) possono mai diventare candidate — le
            skill legate al tuo materiale specifico (chat sui materiali, appunti, piano di studio) restano sempre e
            solo tue, a prescindere da questo interruttore. Nessuna condivisione è ancora attiva: questo interruttore
            esiste già, pronto, ma la pipeline che lo userebbe non è ancora costruita.
          </CardSubtitle>
        </Card>

        <Card>
          <CardTitle>Backup locale</CardTitle>
          <CardSubtitle className="mb-3">Scarica una copia di tutti i tuoi dati in un file.</CardSubtitle>
          <Button variant="soft" size="sm" onClick={exportData}>
            <Download size={14} /> Esporta dati
          </Button>
        </Card>
      </div>
    </div>
  )
}
