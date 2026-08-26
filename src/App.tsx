import { useEffect, Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { AuthGate } from './components/layout/AuthGate'
import { Toaster } from './components/ui/Toaster'
import Today from './pages/Today'
import Settings from './pages/Settings'
import { useAuthStore } from './store/authStore'

import type { CalendarEvent, Material, MaterialChapter } from './lib/types'

const CalendarPage = lazy(() => import('./pages/Calendar'))
const Materials = lazy(() => import('./pages/Materials'))
const Assistant = lazy(() => import('./pages/Assistant'))
const Flashcards = lazy(() => import('./pages/Flashcards'))
const Summaries = lazy(() => import('./pages/Summaries'))
const CheatStudy = lazy(() => import('./pages/CheatStudy'))
const SkillTraining = lazy(() => import('./pages/SkillTraining'))
const ProgressPage = lazy(() => import('./pages/Progress'))
const Game = lazy(() => import('./pages/Game'))
import { useAppStore } from './store/useAppStore'
import { syncPullAll, syncPushAll, canSync } from './lib/sync'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { checkForAppUpdate } from './lib/pwaUpdate'

// Self-heal for a SPECIFIC pre-2026-08-21 data artifact (found live
// 2026-08-24, user report: "vedo uno 0" on a real calendar event). The fix
// that day added a real allDay concept and made day-cell clicks set it
// correctly going forward -- but never touched events already saved BEFORE
// that fix existed with the old broken shape: allDay:false at exactly local
// midnight (FullCalendar's raw day-cell timestamp, used as a TIMED start),
// which renders as a stray "0:00" (truncated to "0" at month-view size) AND,
// because month view renders timed vs all-day events with different
// templates, silently drops the colored background the contrast fix was
// for -- so both symptoms the user saw trace back to this one wrong field.
// Narrow, specific signature (exact local midnight + exactly 1hr duration,
// the old code's actual default) so a real legitimately-scheduled midnight
// event is never touched. Pure function, called from two places below (see
// their comments for why one call site alone isn't enough).
function fixLegacyAllDayEvents(events: CalendarEvent[], updateEvent: (id: string, patch: Partial<CalendarEvent>) => void) {
  for (const e of events) {
    if (e.allDay) continue
    const start = new Date(e.start)
    const isLocalMidnight = start.getHours() === 0 && start.getMinutes() === 0 && start.getSeconds() === 0
    const isOneHourDefault = e.end ? new Date(e.end).getTime() - start.getTime() === 3600000 : false
    if (isLocalMidnight && isOneHourDefault) updateEvent(e.id, { allDay: true })
  }
}

// Self-heal for exam papers uploaded BEFORE Material.isExamPaper existed
// (2026-08-26, found live checking the user's real data right after
// shipping the flag: two "WhatsApp Image..." tracce, uploaded via Cheat
// Study's image path the day before, still showing up in Materiali because
// they genuinely predate the flag -- not a bug in the new filtering, just
// data the flag can't retroactively know about on its own). Signature:
// `MaterialChapter.transcribedText` is set ONLY by CheatStudy.tsx's
// `generateExercisesFromImage` path (verified: no other call site in the
// codebase writes it) -- a real study material's chapters never have it,
// since "Rileva capitoli" on a PDF stores page ranges, not transcribed
// text. Doesn't cover a legacy PDF traccia (no equivalent reliable
// signature exists there -- a real study PDF and an old PDF traccia
// produce identical MaterialChapter shapes) -- those need a manual
// delete-and-reupload through the fixed flow.
function backfillLegacyExamPapers(materials: Material[], chapters: MaterialChapter[], updateMaterial: (id: string, patch: Partial<Material>) => void) {
  const transcribedMaterialIds = new Set(chapters.filter((c) => c.transcribedText !== undefined).map((c) => c.materialId))
  for (const m of materials) {
    if (!m.isExamPaper && transcribedMaterialIds.has(m.id)) updateMaterial(m.id, { isExamPaper: true })
  }
}

function SyncBootstrap() {
  const init = useAuthStore((s) => s.init)
  const session = useAuthStore((s) => s.session)
  const setCurrentUserId = useAppStore((s) => s.setCurrentUserId)
  const hydrateFromRemote = useAppStore((s) => s.hydrateFromRemote)
  const markLocalDataPushed = useAppStore((s) => s.markLocalDataPushed)
  const ensureSkillsInitialized = useAppStore((s) => s.ensureSkillsInitialized)
  const resyncSkillsForDomainFix = useAppStore((s) => s.resyncSkillsForDomainFix)
  const updateEvent = useAppStore((s) => s.updateEvent)

  useEffect(() => {
    // Force a real update check on every app open, not just when someone
    // happens to click "Controlla aggiornamenti" in Impostazioni
    // (2026-08-26, real user report: a hard refresh alone didn't pick up a
    // fresh deploy, only manually clearing site data did -- registerType
    // 'autoUpdate' still needs SOMETHING to actually ask the browser
    // "has the SW script changed?"; left to itself, Workbox's own lazy
    // background check can go a long time without firing on a PWA session
    // that's kept open for days without a real navigation). Re-checked on
    // every tab focus/visibility return too, not just at mount, for exactly
    // that "left open for days" case -- catches a deploy that happened
    // while the app was in the background instead of waiting for the next
    // full reload.
    checkForAppUpdate()
    function onVisible() {
      if (document.visibilityState === 'visible') checkForAppUpdate()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    if (isSupabaseConfigured) init()
    ensureSkillsInitialized()

    // Self-heal on every load (2026-08-20, explicit user request: "devono
    // essere sempre abilitate... se qualcuno le ha off ora abilitatele").
    // librarianEnabled is local-only/persisted (never synced), so a value
    // saved before today's "on by default" change -- or any other stale
    // localStorage snapshot -- would otherwise stay false forever across
    // reloads. researchConsent is synced, and hydrateFromRemote's `?? true`
    // fallback stops a null remote column from re-downgrading it going
    // forward, but doesn't retroactively fix a profile row that already has
    // `false` stored from before that fix -- this client-side correction
    // covers both cases the same way, unconditionally, on every app start.
    const state = useAppStore.getState()
    if (!state.librarianEnabled) state.setLibrarianEnabled(true)
    if (state.profile.researchConsent !== true) state.setResearchConsent(true)

    // Covers local-only/logged-out use (no second effect ever runs to
    // re-check after this). For a logged-in account this ALSO runs here,
    // immediately -- but see the second call site below for why it can't be
    // the only one.
    fixLegacyAllDayEvents(state.events, updateEvent)
    backfillLegacyExamPapers(state.materials, state.chapters, state.updateMaterial)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [init, ensureSkillsInitialized, updateEvent])

  useEffect(() => {
    const userId = session?.user.id
    setCurrentUserId(userId)
    if (!userId) return
    // Explicit user request (2026-08-26): "non c'è un refresh obbligatorio
    // che invece penso ci dovrebbe essere ALMENO ogni login" -- a fresh
    // login can happen well after the app first loaded (someone sitting on
    // the auth screen while a deploy goes out), so this is a second real
    // check, not a duplicate of the mount-time one above.
    checkForAppUpdate()

    async function syncUp() {
      const state = useAppStore.getState()
      // First login on this device: nothing created before now is on the
      // server yet, so push it up once before pulling — otherwise a task
      // added while offline/logged-out would look like it "disappeared".
      if (state.pushedLocalDataFor !== userId) {
        // Real bug found live (2026-08-25, moving the app to a new Netlify
        // origin): a browser origin change resets pushedLocalDataFor same as
        // a genuinely new device, but the account is NOT new -- it already
        // has a real profile row on Supabase. The array-based tables below
        // are safe either way (an empty local array pushes zero rows), but
        // `profile` is a singleton always pushed unconditionally -- doing so
        // with the untouched local default (XP 0, level 1, streak 0) BEFORE
        // the real remote row is even pulled overwrote real progress with
        // zeros. Fix: check whether a remote profile already exists first;
        // only push the local one when it doesn't (genuinely first-ever
        // login), otherwise pass null and let the pull below hydrate the
        // real thing untouched.
        let profileToPush: typeof state.profile | null = state.profile
        if (canSync(userId) && supabase) {
          const { data: existingProfile } = await supabase.from('profiles').select('user_id').eq('user_id', userId).maybeSingle()
          if (existingProfile) profileToPush = null
        }
        const { ok, failedTables } = await syncPushAll(userId!, {
          subjects: state.subjects,
          // archivedMaterials included here too -- same 'materials' table,
          // area_of_interest distinguishes them on the way back in.
          materials: [...state.materials, ...state.archivedMaterials],
          tasks: state.tasks,
          events: state.events,
          profile: profileToPush,
          // archivedSkills included here too -- same 'skills' table, ARCHIVED
          // status distinguishes them on the way back in (hydrateFromRemote).
          skills: [...state.skills, ...state.archivedSkills],
          skillEvents: state.skillEvents,
          highlights: state.highlights,
          chapters: state.chapters,
          flashcards: state.flashcards,
          summaries: state.summaries,
          cheatStudySolutions: state.cheatStudySolutions,
          cheatStudyExercises: state.cheatStudyExercises,
          cheatStudyPrereqs: state.cheatStudyPrereqs,
          cheatStudyExtractedShapes: state.cheatStudyExtractedShapes,
          textEdits: state.textEdits,
        })
        // Only mark done on a FULLY successful push (2026-08-24, prompted by
        // the skills.domain/status CHECK constraint bug -- see CLAUDE.md).
        // Marking this unconditionally is exactly how that bug went
        // unnoticed for 3 days: a first-login push that partially failed
        // (one bad row can fail a whole multi-row upsert atomically) was
        // still recorded as "pushed", so it never automatically retried on
        // a later load. Leaving it unmarked means the next load's syncUp()
        // retries the whole push -- safe, upsert is idempotent by id.
        if (ok) markLocalDataPushed(userId!)
        else console.warn('[sync] first-login push incomplete, will retry next load', failedTables)
      }
      const data = await syncPullAll(userId!)
      if (data) hydrateFromRemote(data)

      // Re-run AFTER the pull settles, not just in the first effect above:
      // hydrateFromRemote's per-id merge (byEvt Map, remote row wins on
      // conflict) can overwrite the first effect's local fix with a still-
      // unfixed remote row if the pull resolves after that fix's own
      // syncUpsert -- both are independent fire-and-forget async chains with
      // no ordering guarantee between them. Running it again here, on the
      // FINAL settled state, is what actually makes the fix stick for a
      // logged-in account (confirmed live: the first-effect-only version
      // kept reverting on reload, exactly this race).
      fixLegacyAllDayEvents(useAppStore.getState().events, useAppStore.getState().updateEvent)
      backfillLegacyExamPapers(useAppStore.getState().materials, useAppStore.getState().chapters, useAppStore.getState().updateMaterial)

      // One-shot self-heal (2026-08-24) for accounts whose first-login push
      // happened BEFORE this fix existed -- their pushedLocalDataFor is
      // already set from back then (even though it may have partially
      // failed under the stale CHECK constraint), so the branch above never
      // runs again for them. Retries every load until it succeeds once
      // (false before the 2026-08-24 Supabase migration is run, since the
      // same constraint would reject it again -- see CLAUDE.md).
      if (!useAppStore.getState().skillsResyncedForDomainFix) {
        const { succeeded, failed } = await resyncSkillsForDomainFix()
        if (failed > 0) console.warn(`[sync] skill resync: ${succeeded} ok, ${failed} still failing -- will retry next load`)
      }
    }
    syncUp()
  }, [session, setCurrentUserId, hydrateFromRemote, markLocalDataPushed, resyncSkillsForDomainFix])

  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <SyncBootstrap />
      {/* Real bug found live (2026-08-25): Toaster used to live only inside
          Layout, which mounts only AFTER AuthGate lets someone through to
          the app routes -- so every toast pushed from AuthGate's own screens
          (wrong password, "password impostata" after a successful recovery,
          a failed update) had nowhere to render and silently vanished. A
          real successful password reset looked exactly like "click Salva,
          nothing happens" because of this, not because it failed. Rendered
          here instead, above AuthGate, so it's mounted regardless of auth
          state. */}
      <Toaster />
      <AuthGate>
        <Suspense fallback={null}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Today />} />
              <Route path="/calendario" element={<CalendarPage />} />
              <Route path="/materiali" element={<Materials />} />
              <Route path="/aria" element={<Assistant />} />
              <Route path="/flashcard" element={<Flashcards />} />
              <Route path="/riassunti" element={<Summaries />} />
              <Route path="/cheat-study" element={<CheatStudy />} />
              <Route path="/allenamento" element={<SkillTraining />} />
              <Route path="/progressi" element={<ProgressPage />} />
              <Route path="/impostazioni" element={<Settings />} />
            </Route>
            <Route path="/gioco" element={<Game />} />
          </Routes>
        </Suspense>
      </AuthGate>
    </BrowserRouter>
  )
}
