import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Subject,
  Material,
  Task,
  CalendarEvent,
  ChatMessage,
  ProfileState,
  SubTask,
  StudyPlanChapter,
  RetrievalReviewState,
  Skill,
  SkillEvent,
  SkillDomain,
  SkillOutcome,
  MaterialHighlight,
  MaterialChapter,
  ChapterSection,
  Flashcard,
  MaterialSummary,
  CheatStudySolution,
  CheatStudyExercise,
  CheatStudyPrereqSet,
  TextEdit,
} from '../lib/types'
import { XP_PER_LEVEL } from '../lib/types'
import { uid, nowIso, daysUntilNextExam, distributeAcrossDays } from '../lib/utils'
import { canSync, syncDelete, syncUpsert } from '../lib/sync'
import { deleteMaterialFile } from '../lib/storage'
import { seedSkills, reviewSkills, archiveSkillsForMaterial, recognizeArchivedSkills } from '../lib/skills'
import { logCall, logOutcome, syncSkillEvent } from '../lib/skillEvents'
import type { FormulaGateAttempt } from '../lib/formulaExamples'

const SKILL_EVENTS_CAP = 1000

export interface CompleteTaskResult {
  xpGained: number
  leveledUp: boolean
  streakChanged: boolean
  newStreak: number
  usedFreeze: boolean
}

interface AppState {
  subjects: Subject[]
  materials: Material[]
  tasks: Task[]
  events: CalendarEvent[]
  chat: ChatMessage[]
  profile: ProfileState
  studyPlans: Record<string, StudyPlanChapter[]>
  studyPlanPlaybook: string
  /** planKey -> id of the CALL SkillEvent that generated the current plan for
   * that key, so the NEXT regenerate() can log an OUTCOME against it (the
   * outcome is "how much of the plan got done before being replaced" —
   * only observable at regeneration time, same timing the pre-existing
   * playbook reflection already used). */
  studyPlanCallEvents: Record<string, string>
  /** Keyed by StudyPlanQuizItem.id. */
  retrievalReviews: Record<string, RetrievalReviewState>
  currentUserId?: string
  pushedLocalDataFor?: string
  /** One-shot self-heal flag (2026-08-24) -- see CLAUDE.md's note on the
   * skills.domain/status CHECK constraint that silently blocked sync for 5
   * domains + ARCHIVED status since 2026-08-21. Skills created/changed in
   * that window on THIS device never reached Supabase (or, worse, could
   * have failed an entire first-login batch push for every OTHER skill too
   * -- Postgres fails a whole multi-row upsert statement atomically on one
   * bad row). Only set to true once resyncSkillsForDomainFix() has
   * confirmed every skill round-tripped with no error -- left false (and
   * retried on every load) until the 2026-08-24 Supabase migration has
   * actually been run, since before that the same constraint would just
   * reject the retry again. */
  skillsResyncedForDomainFix?: boolean

  // Skill library (Librarian) — see lib/skills.ts, lib/skillEvents.ts.
  skills: Skill[]
  skillEvents: SkillEvent[]
  librarianEnabled: boolean
  skillsInitialized?: boolean
  /** Skills moved out of `skills` when their source material is deleted --
   * see lib/skills.ts's archiveSkillsForMaterial() module comment. Never
   * read by routeSkills()/routeMaterialKnowledge(), only by the Settings
   * "skill archiviate" disclosure, restoreSkill(), and addSubject()'s
   * area-of-interest recognition. */
  archivedSkills: Skill[]
  /** Materials moved here (not deleted) when their whole Subject is removed
   * -- see removeSubject(). Every entry has Material.areaOfInterest set
   * (that field IS the archived marker, see its own comment). Read-only in
   * the UI today (Settings' "materiali archiviati" listing) -- no automatic
   * restore for materials, only their skills get recognized/restored
   * automatically (see addSubject()). */
  archivedMaterials: Material[]

  // PDF highlights ("collegamenti") — see components/materials/PdfViewer.tsx.
  highlights: MaterialHighlight[]

  // PDF chapters (page-range, auto-detected + redefinable) and flashcards
  // scoped to them — see lib/gemini.ts (generateChapters/generateFlashcards).
  chapters: MaterialChapter[]
  flashcards: Flashcard[]
  summaries: MaterialSummary[]
  textEdits: TextEdit[]
  cheatStudySolutions: CheatStudySolution[]
  cheatStudyExercises: CheatStudyExercise[]
  cheatStudyPrereqs: CheatStudyPrereqSet[]

  setCurrentUserId: (id: string | undefined) => void
  markLocalDataPushed: (userId: string) => void
  /** Re-pushes every local skill (live + archived) individually, and sets
   * skillsResyncedForDomainFix only if ALL of them round-tripped with no
   * error. Safe to call repeatedly -- upsert by id is idempotent, and a
   * skill that already synced fine just gets re-written with the same
   * values. Returns how many succeeded/failed so a caller (Settings button,
   * or the automatic one-shot in App.tsx) can show a real result. */
  resyncSkillsForDomainFix: () => Promise<{ succeeded: number; failed: number }>
  hydrateFromRemote: (data: {
    subjects: any[]
    materials: any[]
    tasks: any[]
    events: any[]
    profile: any
    skills?: any[]
    skillEvents?: any[]
    highlights?: any[]
    chapters?: any[]
    flashcards?: any[]
    summaries?: any[]
    textEdits?: any[]
    cheatStudySolutions?: any[]
    cheatStudyExercises?: any[]
    cheatStudyPrereqs?: any[]
  }) => void

  /** Return also reports how many previously-archived skills this Subject's
   * name just recognized and restored (see recognizeArchivedSkills()) -- 0
   * most of the time, but the caller (SubjectDialog.tsx) needs it to decide
   * whether to surface a toast. */
  addSubject: (name: string, color: string, icon: string) => { subject: Subject; recognizedSkillCount: number }
  removeSubject: (id: string) => void

  addMaterial: (m: Omit<Material, 'id' | 'createdAt'>) => Material
  updateMaterial: (id: string, patch: Partial<Material>) => void
  removeMaterial: (id: string) => void

  // planKey is either a subjectId (whole-subject plan) or `material:${materialId}` (single-material plan) —
  // both live in the same map since they can never collide (uid()s vs a fixed "material:" prefix).
  setStudyPlan: (planKey: string, chapters: StudyPlanChapter[]) => void
  /** Clears a plan entirely (2026-08-24, real user request: "manca un
   * elimina nel piano di studi se voglio cancellarlo tutto prima di
   * rigenerarlo") -- also removes the real Tasks it auto-created (see
   * generate()'s per-item task creation in both panels) so deleting a plan
   * doesn't leave orphaned "ghost" tasks behind in Oggi/Calendario. */
  removeStudyPlan: (planKey: string) => void
  /** Explicit user action only, never automatic/background (2026-08-24,
   * confirmed design choice -- see CLAUDE.md's study-plan scheduling note
   * for why: matches this app's "mai colpevolizzare/mai sorprese" principle,
   * silently moving someone's plan around behind their back would violate
   * that even if well-intentioned). Redistributes every not-done item whose
   * dueDate has passed (oldest first, then anything still due today or
   * later) across the days remaining until the exam. Returns how many items
   * moved so a caller can show a real result, not just assume it worked. */
  reassignOverdueStudyPlanItems: (planKey: string) => number
  setStudyPlanCallEvent: (planKey: string, eventId: string) => void
  toggleStudyPlanItem: (planKey: string, chapterId: string, itemId: string) => void
  // taskSubjectId lets a material-scoped plan (planKey = "material:xyz") still file the created task under the real subject.
  addStudyPlanItemAsTask: (planKey: string, chapterId: string, itemId: string, taskSubjectId?: string) => void
  setStudyPlanPlaybook: (text: string) => void
  recordRetrievalReview: (questionId: string, grade: 'facile' | 'ripeti') => void

  addTask: (t: Omit<Task, 'id' | 'createdAt' | 'done' | 'subtasks'> & { subtasks?: SubTask[] }) => Task
  updateTask: (id: string, patch: Partial<Task>) => void
  toggleSubtask: (taskId: string, subtaskId: string) => void
  removeTask: (id: string) => void
  completeTask: (id: string) => CompleteTaskResult

  addEvent: (e: Omit<CalendarEvent, 'id' | 'createdAt'>) => CalendarEvent
  updateEvent: (id: string, patch: Partial<CalendarEvent>) => void
  removeEvent: (id: string) => void

  addChatMessage: (m: Omit<ChatMessage, 'id' | 'createdAt'>) => void
  clearChat: () => void

  applyXp: (amount: number) => CompleteTaskResult
  registerFocusSessionCompleted: () => CompleteTaskResult
  setResearchConsent: (consent: boolean) => void
  setSkillSharingConsent: (consent: boolean) => void

  // Skill library
  ensureSkillsInitialized: () => void
  setLibrarianEnabled: (on: boolean) => void
  addSkill: (skill: Skill) => void
  /** Upserts by id: patches an existing skill, or creates one from `fallback`
   * if it doesn't exist yet (e.g. a material that never had aiNotes before). */
  upsertSkillContent: (id: string, content: string, fallback: Omit<Skill, 'id' | 'content' | 'createdAt' | 'updatedAt'>) => void
  logSkillCall: (domain: SkillDomain, config: 'F' | 'B', skillIds: string[], model: string) => SkillEvent
  recordSkillOutcome: (callEvent: SkillEvent, outcome: SkillOutcome) => void
  /** Gate 1 (mathematical correctness, computed) attempts for the formula
   * example feature -- see lib/formulaExamples.ts's module comment for why
   * this is kept separate from skillEvents (a deterministic computed gate,
   * not a behavioral CALL/OUTCOME signal). Local only, not synced to
   * Supabase -- no schema change needed for a log this narrow. */
  formulaGateAttempts: FormulaGateAttempt[]
  logFormulaGateAttempt: (attempt: FormulaGateAttempt) => void
  /** Moves a skill back from archivedSkills into the live, routable `skills`
   * array -- the "recuperabile" half of the archival design. Manual only
   * (Settings UI), never automatic. */
  restoreSkill: (id: string) => void

  // PDF highlights
  addHighlight: (h: Omit<MaterialHighlight, 'id' | 'createdAt' | 'updatedAt'>) => MaterialHighlight
  updateHighlightNote: (id: string, note: string) => void
  removeHighlight: (id: string) => void

  // PDF chapters + flashcards
  /** Replaces the full chapter list for one material — used both by a fresh
   * AI detection and by saving a manual page-range edit, so there's only
   * ever one source of truth per material, never a stale AI copy plus edits
   * layered on top. */
  setMaterialChapters: (materialId: string, chapters: { title: string; startPage: number; endPage: number; subsections?: ChapterSection[]; transcribedText?: string }[]) => void
  addFlashcards: (cards: Omit<Flashcard, 'id' | 'createdAt'>[]) => void
  /** Exact-scope match on both chapterId and sectionId (undefined means "no
   * section", not "any section") -- so regenerating one section's deck
   * never wipes another section's, or the whole chapter's. */
  removeFlashcardsFor: (materialId: string, chapterId: string, sectionId?: string) => void
  /** Single-card delete -- real user request (2026-08-21): "devo poterle
   * gestire... eliminarne qualcuna se la ritengo inutile", distinct from
   * removeFlashcardsFor's whole-scope wipe. */
  removeFlashcard: (id: string) => void
  /** Edits content and/or toggles suspended (2026-08-24 roadmap: "sospendere
   * eventualmente una card... modificare eventualmente una card"). Partial
   * patch, not a full replace -- callers only pass what actually changed. */
  updateFlashcard: (id: string, patch: Partial<Pick<Flashcard, 'front' | 'back' | 'suspended'>>) => void

  // Summaries ("riassunti", own section) -- upserts by (materialId,
  // chapterId, sectionId) scope so regenerating replaces the existing one
  // instead of piling up.
  setSummary: (materialId: string, chapterId: string, sectionId: string | undefined, content: string) => void
  removeSummary: (id: string) => void
  setCheatStudySolution: (examMaterialId: string, chapterId: string, sectionId: string | undefined, content: string) => void
  removeCheatStudySolution: (id: string) => void
  setCheatStudyExercise: (examMaterialId: string, chapterId: string, sectionId: string | undefined, content: string) => void
  removeCheatStudyExercise: (id: string) => void
  setCheatStudyPrereq: (examMaterialId: string, chapterId: string, sectionId: string | undefined, content: string) => void
  removeCheatStudyPrereq: (id: string) => void
  setCheatStudyLinkedMaterials: (examMaterialId: string, linkedMaterialIds: string[]) => void

  // Text edits ("modifica testo" overlay) -- upserts by matching an existing
  // edit at (materialId, page, rect) within a tiny rounding tolerance, so
  // re-editing the same span updates it instead of stacking duplicates.
  setTextEdit: (materialId: string, page: number, rect: { x: number; y: number; width: number; height: number }, replacement: string) => void
  removeTextEdit: (id: string) => void
}

const defaultProfile: ProfileState = {
  displayName: 'Tu',
  xp: 0,
  level: 1,
  streakCount: 0,
  streakFreezes: 2,
  researchConsent: true, // default flipped 2026-08-20 on explicit user request. A second real account exists now (2026-08-24) and gave blanket verbal consent before using the app -- still holds, but see setSkillSharingConsent below for why SKILL CONTENT sharing is a separate, off-by-default decision, not covered by this flag.
  skillSharingConsent: false, // opt-in, deliberately off even for accounts that gave researchConsent -- see types.ts's ProfileState comment
}

// `annotation_data_url` is a text column (see supabase/schema.sql) reused as
// a JSON-encoded page->dataURL map, to keep the per-page whiteboard rework
// (2026-08-20) from needing a schema migration on top of the highlights one.
function parseAnnotations(raw: string | null | undefined): Record<number, string> | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

// Real bug found live (2026-08-25): hydrateFromRemote's per-id merge (seed
// from local state, add/update whatever the pull returned) never REMOVED a
// local row whose id was missing from a fresh pull -- so a device that had
// something cached before it was hard-deleted (removeMaterial/removeSubject/
// removeTask/removeEvent/removeFlashcard/etc., all real syncDelete calls)
// kept showing a ghost forever, pointing at data that no longer exists
// anywhere. Traced from a real 404: a material's Storage file was deleted
// (confirmed via Supabase's own [Lifecycle] logs) but its local row in THIS
// session survived across multiple reloads.
//
// syncPullAll's queries have no LIMIT/pagination (confirmed against the
// real ones this session) -- a pull is a complete snapshot of the user's
// rows, so an id genuinely absent from it really was deleted server-side,
// with one exception: something created THIS device, THIS session, whose
// own syncUpsert/syncDelete push hasn't resolved yet when a pull happens to
// land in between (e.g. a session-token refresh re-running syncUp() while a
// create is still in flight). RECENT_GRACE_MS is the guard against that --
// anything created more recently than this is kept regardless of whether
// the pull saw it yet, at the cost of a genuinely-just-deleted item
// surviving one extra grace window on this one device before the next pull
// catches up. Only applied to entities with a real hard-delete path
// (grep-confirmed: subjects/materials/tasks/events/flashcards/summaries/
// material_chapters/material_highlights/text_edits) -- skills and
// skillEvents are never syncDelete'd (archive-only / append-only), so their
// existing pure-merge behavior already has no ghost risk to fix.
const RECENT_GRACE_MS = 5 * 60 * 1000
function pruneDeleted<T extends { id: string; createdAt: string }>(local: T[], remoteIds: Set<string>): T[] {
  const now = Date.now()
  return local.filter((item) => remoteIds.has(item.id) || now - new Date(item.createdAt).getTime() < RECENT_GRACE_MS)
}

// planKey is either a bare subjectId (whole-subject plan) or `material:{id}`
// (single-file plan) -- see MaterialPlanPanel/StudyPlanPanel's own comments
// on this convention.
function resolveStudyPlanSubjectId(planKey: string, materials: Material[]): string | undefined {
  const materialMatch = planKey.startsWith('material:') ? materials.find((m) => m.id === planKey.slice('material:'.length)) : undefined
  return materialMatch ? materialMatch.subjectId : planKey
}

function levelForXp(xp: number) {
  return Math.floor(xp / XP_PER_LEVEL) + 1
}

function bumpStreak(profile: ProfileState): { profile: ProfileState; result: Pick<CompleteTaskResult, 'streakChanged' | 'newStreak' | 'usedFreeze'> } {
  const today = new Date().toISOString().slice(0, 10)
  if (profile.lastActiveDate === today) {
    return { profile, result: { streakChanged: false, newStreak: profile.streakCount, usedFreeze: false } }
  }
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  let streakCount = profile.streakCount
  let streakFreezes = profile.streakFreezes
  let usedFreeze = false

  if (profile.lastActiveDate === yesterday || !profile.lastActiveDate) {
    streakCount += 1
  } else {
    // gap of 2+ days — spend a freeze if available instead of shaming a hard reset
    if (streakFreezes > 0) {
      streakFreezes -= 1
      streakCount += 1
      usedFreeze = true
    } else {
      streakCount = 1
    }
  }

  return {
    profile: { ...profile, streakCount, streakFreezes, lastActiveDate: today },
    result: { streakChanged: true, newStreak: streakCount, usedFreeze },
  }
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      subjects: [],
      materials: [],
      tasks: [],
      events: [],
      chat: [],
      profile: defaultProfile,
      studyPlans: {},
      studyPlanPlaybook: '',
      studyPlanCallEvents: {},
      retrievalReviews: {},
      currentUserId: undefined,
      skills: [],
      skillEvents: [],
      formulaGateAttempts: [],
      archivedSkills: [],
      archivedMaterials: [],
      librarianEnabled: true,
      skillsInitialized: false,
      highlights: [],
      chapters: [],
      flashcards: [],
      summaries: [],
      cheatStudySolutions: [],
      cheatStudyExercises: [],
      cheatStudyPrereqs: [],
      textEdits: [],

      setCurrentUserId: (id) => set({ currentUserId: id }),
      markLocalDataPushed: (userId) => set({ pushedLocalDataFor: userId }),

      resyncSkillsForDomainFix: async () => {
        const u = get().currentUserId
        if (!canSync(u)) return { succeeded: 0, failed: 0 }
        const all = [...get().skills, ...get().archivedSkills]
        let succeeded = 0
        const results = await Promise.all(
          all.map((sk) =>
            syncUpsert('skills', u, {
              id: sk.id,
              version: sk.version,
              title: sk.title,
              domain: sk.domain,
              capability_tags: sk.capabilityTags,
              content: sk.content,
              status: sk.status,
              confidence: sk.confidence,
              uses: sk.uses,
              successes: sk.successes,
              generation_method: sk.generationMethod,
              derived_from: sk.derivedFrom,
              material_id: sk.materialId,
              area_of_interest: sk.areaOfInterest,
              // Real local timestamps (2026-08-24, prompted by an explicit
              // question about how to tell "recovered" from "regenerated" in
              // Supabase later) -- none of these upsert call sites ever sent
              // created_at/updated_at before, so a row's Supabase created_at
              // only ever meant "when did this row first reach Supabase",
              // useless for telling a recovered 3-day-old orphan apart from
              // a skill regenerated fresh today. Sending the skill's own
              // createdAt/updatedAt makes that a real, checkable distinction.
              created_at: sk.createdAt,
              updated_at: sk.updatedAt,
            }),
          ),
        )
        for (const ok of results) if (ok) succeeded++
        const failed = all.length - succeeded
        if (failed === 0) set({ skillsResyncedForDomainFix: true })
        return { succeeded, failed }
      },

      hydrateFromRemote: (data) => {
        // Real bug found live (2026-08-26, real user report: "nel calendario
        // ancora vedo il piano di studi di prima" -- AFTER the orphan-prune
        // fix below already shipped). That fix drops a stale StudyPlanChapter
        // from the LOCAL `studyPlans` map, but each of its items may already
        // have created a REAL `Task` (StudyPlanItem.taskId) that was synced
        // to Supabase before the source material/subject disappeared --
        // pruning the plan's own bookkeeping never touched that Task, so it
        // just kept sitting in the `tasks` table with a perfectly valid
        // subject_id, showing up forever in Calendar/Oggi. Collected here
        // (mutated inside the set() callback below, read after it returns)
        // so the matching real tasks can be deleted too -- both locally and
        // via syncDelete, same as removeStudyPlan already does for an
        // explicit delete.
        const droppedTaskIds = new Set<string>()
        set((state) => {
          const bySub = new Map(state.subjects.map((s) => [s.id, s]))
          for (const r of data.subjects) {
            bySub.set(r.id, {
              id: r.id,
              name: r.name,
              color: r.color,
              icon: r.icon,
              createdAt: r.created_at,
            })
          }
          // Split by area_of_interest presence, same discriminator idea as
          // skills' status==='ARCHIVED' -- see Material.areaOfInterest's
          // comment: that field IS the archived marker, a live material
          // never has it, so a synced row with it set belongs in
          // archivedMaterials, not `materials`. Reads as undefined on a
          // remote row from before that column existed -- same graceful
          // degrade as skills' material_id (see project memory's note on
          // syncUpsert's fail-open behavior).
          const byMat = new Map(state.materials.map((m) => [m.id, m]))
          const byArchivedMat = new Map(state.archivedMaterials.map((m) => [m.id, m]))
          for (const r of data.materials) {
            const material: Material = {
              id: r.id,
              subjectId: r.subject_id,
              type: r.type,
              title: r.title,
              url: r.url ?? undefined,
              content: r.content ?? undefined,
              fileName: r.file_name ?? undefined,
              fileDataUrl: r.file_data_url ?? undefined,
              filePath: r.file_path ?? undefined,
              fileUpdatedAt: r.file_updated_at ?? undefined,
              aiNotes: r.ai_notes ?? undefined,
              annotations: parseAnnotations(r.annotation_data_url),
              areaOfInterest: r.area_of_interest ?? undefined,
              createdAt: r.created_at,
              cheatStudyLinkedMaterialIds: r.cheat_study_linked_ids ?? undefined,
              isExamPaper: r.is_exam_paper ?? undefined,
            }
            if (material.areaOfInterest) {
              byArchivedMat.set(r.id, material)
              byMat.delete(r.id)
            } else {
              byMat.set(r.id, material)
              byArchivedMat.delete(r.id)
            }
          }
          const byTask = new Map(state.tasks.map((t) => [t.id, t]))
          for (const r of data.tasks) {
            byTask.set(r.id, {
              id: r.id,
              subjectId: r.subject_id ?? undefined,
              title: r.title,
              description: r.description ?? undefined,
              dueDate: r.due_date ?? undefined,
              done: r.done,
              doneAt: r.done_at ?? undefined,
              priority: r.priority,
              estimateMinutes: r.estimate_minutes ?? undefined,
              subtasks: r.subtasks ?? [],
              createdAt: r.created_at,
              pageRange: r.page_range ?? undefined,
            })
          }
          const byEvt = new Map(state.events.map((e) => [e.id, e]))
          for (const r of data.events) {
            byEvt.set(r.id, {
              id: r.id,
              createdAt: r.created_at,
              subjectId: r.subject_id ?? undefined,
              taskId: r.task_id ?? undefined,
              title: r.title,
              start: r.start,
              end: r.end ?? undefined,
              allDay: r.all_day,
              color: r.color ?? undefined,
              notes: r.notes ?? undefined,
              type: r.type ?? undefined,
            })
          }
          const profile: ProfileState = data.profile
            ? {
                displayName: data.profile.display_name,
                xp: data.profile.xp,
                level: data.profile.level,
                streakCount: data.profile.streak_count,
                lastActiveDate: data.profile.last_active_date ?? undefined,
                streakFreezes: data.profile.streak_freezes,
                // `?? true` (not `?? false`): a null/missing column on the remote
                // row must NOT silently downgrade the true-by-default local value
                // on every sync pull -- this was the actual cause of "si disabilita
                // da solo" (2026-08-20): any account whose profile row predates the
                // 2026-08-20 default-flip (or that ever synced while a client had
                // an out-of-date default) has `research_consent = null/false` in
                // Supabase, and every login/pull re-hydrated that stale false over
                // the correct local true, forever. Explicit user instruction this
                // same day: this flag must always read as on.
                researchConsent: data.profile.research_consent ?? true,
                researchConsentAt: data.profile.research_consent_at ?? undefined,
                // Opposite direction from researchConsent on purpose: this
                // one must stay OFF on a missing/stale remote column (no
                // migration run yet), never silently default to on.
                skillSharingConsent: data.profile.skill_sharing_consent ?? false,
                skillSharingConsentAt: data.profile.skill_sharing_consent_at ?? undefined,
              }
            : state.profile

          // Split by status: 'ARCHIVED' rows go to archivedSkills, never
          // `skills` -- see types.ts's SkillStatus comment on why that
          // separation matters (routeSkills()/routeMaterialKnowledge() only
          // ever read `skills`). `material_id` reads as undefined on a
          // remote row from before that column existed -- see this
          // session's note to the user about the one-time Supabase
          // migration this depends on to round-trip across devices.
          const bySkill = new Map(state.skills.map((sk) => [sk.id, sk]))
          const byArchivedSkill = new Map(state.archivedSkills.map((sk) => [sk.id, sk]))
          for (const r of data.skills ?? []) {
            const skill: Skill = {
              id: r.id,
              version: r.version,
              title: r.title,
              domain: r.domain,
              capabilityTags: r.capability_tags ?? [],
              content: r.content,
              status: r.status,
              confidence: r.confidence,
              uses: r.uses,
              successes: r.successes,
              generationMethod: r.generation_method,
              derivedFrom: r.derived_from ?? undefined,
              materialId: r.material_id ?? undefined,
              areaOfInterest: r.area_of_interest ?? undefined,
              createdAt: r.created_at,
              updatedAt: r.updated_at,
            }
            if (skill.status === 'ARCHIVED') {
              byArchivedSkill.set(r.id, skill)
              bySkill.delete(r.id)
            } else {
              bySkill.set(r.id, skill)
              byArchivedSkill.delete(r.id)
            }
          }
          const bySkillEvent = new Map(state.skillEvents.map((e) => [e.id, e]))
          for (const r of data.skillEvents ?? []) {
            bySkillEvent.set(r.id, {
              id: r.id,
              ts: r.ts,
              domain: r.domain,
              config: r.config,
              eventType: r.event_type,
              skillIds: r.skill_ids ?? [],
              ref: r.ref,
              outcome: r.outcome ?? undefined,
              model: r.model ?? undefined,
            })
          }

          const byHighlight = new Map(state.highlights.map((h) => [h.id, h]))
          for (const r of data.highlights ?? []) {
            byHighlight.set(r.id, {
              id: r.id,
              materialId: r.material_id,
              page: r.page,
              text: r.text,
              rects: r.rects ?? [],
              note: r.note ?? undefined,
              color: r.color,
              createdAt: r.created_at,
              updatedAt: r.updated_at,
            })
          }

          const byChapter = new Map(state.chapters.map((c) => [c.id, c]))
          for (const r of data.chapters ?? []) {
            byChapter.set(r.id, {
              id: r.id,
              materialId: r.material_id,
              title: r.title,
              startPage: r.start_page,
              endPage: r.end_page,
              order: r.order,
              subsections: r.subsections ?? [],
              transcribedText: r.transcribed_text ?? undefined,
              createdAt: r.created_at,
              updatedAt: r.updated_at,
            })
          }

          const byFlashcard = new Map(state.flashcards.map((f) => [f.id, f]))
          for (const r of data.flashcards ?? []) {
            byFlashcard.set(r.id, {
              id: r.id,
              materialId: r.material_id,
              chapterId: r.chapter_id,
              sectionId: r.section_id ?? undefined,
              front: r.front,
              back: r.back,
              createdAt: r.created_at,
              suspended: r.suspended ?? false,
            })
          }

          const bySummary = new Map(state.summaries.map((s) => [s.id, s]))
          for (const r of data.summaries ?? []) {
            bySummary.set(r.id, {
              id: r.id,
              materialId: r.material_id,
              chapterId: r.chapter_id,
              sectionId: r.section_id ?? undefined,
              content: r.content,
              createdAt: r.created_at,
              updatedAt: r.updated_at,
            })
          }

          const byCheatStudySolution = new Map(state.cheatStudySolutions.map((s) => [s.id, s]))
          for (const r of data.cheatStudySolutions ?? []) {
            byCheatStudySolution.set(r.id, {
              id: r.id,
              examMaterialId: r.exam_material_id,
              chapterId: r.chapter_id,
              sectionId: r.section_id ?? undefined,
              content: r.content,
              createdAt: r.created_at,
              updatedAt: r.updated_at,
            })
          }

          const byCheatStudyExercise = new Map(state.cheatStudyExercises.map((s) => [s.id, s]))
          for (const r of data.cheatStudyExercises ?? []) {
            byCheatStudyExercise.set(r.id, {
              id: r.id,
              examMaterialId: r.exam_material_id,
              chapterId: r.chapter_id,
              sectionId: r.section_id ?? undefined,
              content: r.content,
              createdAt: r.created_at,
              updatedAt: r.updated_at,
            })
          }

          const byCheatStudyPrereq = new Map(state.cheatStudyPrereqs.map((s) => [s.id, s]))
          for (const r of data.cheatStudyPrereqs ?? []) {
            byCheatStudyPrereq.set(r.id, {
              id: r.id,
              examMaterialId: r.exam_material_id,
              chapterId: r.chapter_id,
              sectionId: r.section_id ?? undefined,
              content: r.content,
              createdAt: r.created_at,
              updatedAt: r.updated_at,
            })
          }

          const byTextEdit = new Map(state.textEdits.map((t) => [t.id, t]))
          for (const r of data.textEdits ?? []) {
            byTextEdit.set(r.id, {
              id: r.id,
              materialId: r.material_id,
              page: r.page,
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              replacement: r.replacement,
              createdAt: r.created_at,
              updatedAt: r.updated_at,
            })
          }

          // pruneDeleted (2026-08-25, see its own comment above) -- only for
          // entities with a real hard-delete path. `materials`' remote id
          // set covers BOTH live and archived rows (same table, split by
          // area_of_interest) since a hard delete can remove a row currently
          // sitting in either local array.
          const materialIds = new Set(data.materials.map((r) => r.id))
          const subjectIds = new Set(data.subjects.map((r) => r.id))

          // Real bug found live (2026-08-26, real user report: "il materiale
          // è scomparso... ma il piano di studio c'è"): studyPlans/
          // studyPlanCallEvents are local-only by design (never synced, see
          // this file's own note on planKey -- content is regenerable, not
          // critical data) and were never touched by pruneDeleted above.
          // removeMaterial()'s own cascade cleans up a plan when the app's
          // OWN delete button is used, but nothing cleaned it up when a
          // material vanished through a DIFFERENT path (a direct DB delete
          // this same session, or any cross-device hard delete) -- the pull
          // above correctly drops the material from `materials`, but the
          // plan keyed off its id (planKey `material:${id}`) or its whole
          // subject (bare `subjectId` planKey) just sat there forever,
          // pointing at nothing. Same "orphan survives because nothing
          // prunes local-only data against a remote deletion" shape as the
          // ghost-row bug this file's pruneDeleted comment already
          // describes -- this is the same fix, applied to the one place
          // pruneDeleted itself doesn't reach.
          const planKeyStillValid = (planKey: string) => (planKey.startsWith('material:') ? materialIds.has(planKey.slice('material:'.length)) : subjectIds.has(planKey))
          // A WHOLE-SUBJECT plan survives the check above even when only ONE
          // of the subject's materials disappears (the subject itself is
          // still fine) -- real user report, same session: "il piano di
          // TUTTA la materia è ancora lì, dentro ha ancora capitoli del PDF
          // cancellato". The plan-level prune above can't catch this since
          // it only looks at whether the KEY is still valid, not whether
          // every ENTRY inside a still-valid plan still points somewhere
          // real. Prune those individually too, against the chapters that
          // actually survived this same pull (computed once, reused below
          // for the real `chapters` field as well).
          const survivingChapters = pruneDeleted(Array.from(byChapter.values()), new Set((data.chapters ?? []).map((r) => r.id)))
          const survivingChapterIds = new Set(survivingChapters.map((c) => c.id))
          const collectTaskIds = (chapters: StudyPlanChapter[]) => {
            for (const pc of chapters) for (const it of pc.items) if (it.taskId) droppedTaskIds.add(it.taskId)
          }
          for (const [k, planChapters] of Object.entries(state.studyPlans)) {
            if (!planKeyStillValid(k)) {
              collectTaskIds(planChapters)
              continue
            }
            collectTaskIds(planChapters.filter((pc) => pc.materialChapterId && !survivingChapterIds.has(pc.materialChapterId)))
          }
          const studyPlans = Object.fromEntries(
            Object.entries(state.studyPlans)
              .filter(([k]) => planKeyStillValid(k))
              .map(([k, planChapters]) => [k, planChapters.filter((pc) => !pc.materialChapterId || survivingChapterIds.has(pc.materialChapterId))]),
          )
          const studyPlanCallEvents = Object.fromEntries(Object.entries(state.studyPlanCallEvents).filter(([k]) => planKeyStillValid(k)))

          return {
            studyPlans,
            studyPlanCallEvents,
            subjects: pruneDeleted(Array.from(bySub.values()), new Set(data.subjects.map((r) => r.id))),
            materials: pruneDeleted(Array.from(byMat.values()), materialIds),
            archivedMaterials: pruneDeleted(Array.from(byArchivedMat.values()), materialIds),
            tasks: pruneDeleted(Array.from(byTask.values()), new Set(data.tasks.map((r) => r.id))).filter((t) => !droppedTaskIds.has(t.id)),
            events: pruneDeleted(Array.from(byEvt.values()), new Set(data.events.map((r) => r.id))),
            profile,
            skills: Array.from(bySkill.values()),
            archivedSkills: Array.from(byArchivedSkill.values()),
            skillEvents: Array.from(bySkillEvent.values()).slice(-SKILL_EVENTS_CAP),
            highlights: pruneDeleted(Array.from(byHighlight.values()), new Set((data.highlights ?? []).map((r) => r.id))),
            chapters: survivingChapters,
            flashcards: pruneDeleted(Array.from(byFlashcard.values()), new Set((data.flashcards ?? []).map((r) => r.id))),
            summaries: pruneDeleted(Array.from(bySummary.values()), new Set((data.summaries ?? []).map((r) => r.id))),
            cheatStudySolutions: pruneDeleted(Array.from(byCheatStudySolution.values()), new Set((data.cheatStudySolutions ?? []).map((r) => r.id))),
            cheatStudyExercises: pruneDeleted(Array.from(byCheatStudyExercise.values()), new Set((data.cheatStudyExercises ?? []).map((r) => r.id))),
            cheatStudyPrereqs: pruneDeleted(Array.from(byCheatStudyPrereq.values()), new Set((data.cheatStudyPrereqs ?? []).map((r) => r.id))),
            textEdits: pruneDeleted(Array.from(byTextEdit.values()), new Set((data.textEdits ?? []).map((r) => r.id))),
          }
        })
        if (droppedTaskIds.size) {
          const u = get().currentUserId
          if (canSync(u)) for (const id of droppedTaskIds) syncDelete('tasks', u, id)
        }
      },

      addSubject: (name, color, icon) => {
        const subject: Subject = { id: uid(), name, color, icon, createdAt: nowIso() }
        // Area-of-interest recognition (2026-08-21, explicit user design):
        // does this new Subject's name relate to anything archived by a
        // past Subject deletion? Recognized skills go back to `skills` as
        // DRAFT -- re-earn trust through reviewSkills() again, see
        // types.ts's Skill.areaOfInterest comment for why not their old
        // status. Archived MATERIALS are NOT auto-restored here (see
        // AppState.archivedMaterials comment) -- only their skills, the
        // portable/reusable residue, come back automatically.
        const { recognized, stillArchived } = recognizeArchivedSkills(get().archivedSkills, name)
        const now = nowIso()
        const restored = recognized.map((sk) => ({ ...sk, status: 'DRAFT' as const, updatedAt: now }))
        set((s) => ({
          subjects: [...s.subjects, subject],
          skills: [...s.skills, ...restored],
          archivedSkills: stillArchived,
        }))
        const uidUser = get().currentUserId
        if (canSync(uidUser)) {
          syncUpsert('subjects', uidUser, { id: subject.id, name: subject.name, color: subject.color, icon: subject.icon })
          for (const sk of restored) {
            syncUpsert('skills', uidUser, {
              id: sk.id,
              version: sk.version,
              title: sk.title,
              domain: sk.domain,
              capability_tags: sk.capabilityTags,
              content: sk.content,
              status: sk.status,
              confidence: sk.confidence,
              uses: sk.uses,
              successes: sk.successes,
              generation_method: sk.generationMethod,
              derived_from: sk.derivedFrom,
              material_id: sk.materialId,
              area_of_interest: sk.areaOfInterest,
              created_at: sk.createdAt, // see resyncSkillsForDomainFix's comment
              updated_at: sk.updatedAt,
            })
          }
        }
        return { subject, recognizedSkillCount: restored.length }
      },
      removeSubject: (id) => {
        const subject = get().subjects.find((x) => x.id === id)
        const materialsUnderSubject = get().materials.filter((m) => m.subjectId === id)
        // Real user instruction (2026-08-26, same session as the study-plan
        // orphan bug above): "se viene eliminata la materia tutte le cose che
        // rimangono collegate devono cancellarsi". studyPlans/
        // studyPlanCallEvents are the one local-only data type removeSubject
        // never touched -- everything else here is either hard-deleted
        // (subject) or explicitly ARCHIVED, not orphaned (materials/skills,
        // on purpose, see below). Reuses removeStudyPlan() itself (not a
        // second implementation) so the real Tasks a plan created get
        // cleaned up here too, exactly like the button-driven delete path.
        get().removeStudyPlan(id)
        for (const m of materialsUnderSubject) get().removeStudyPlan(`material:${m.id}`)
        const areaOfInterest = subject?.name
        const archivedMats = materialsUnderSubject.map((m) => ({ ...m, areaOfInterest }))

        // Archive every affected material's skills together (not one
        // removeMaterial() call per material -- that path is the OTHER,
        // deliberately different single-file-delete flow with no
        // areaOfInterest and a real file deletion, see Material.
        // areaOfInterest's comment) -- run archiveSkillsForMaterial once per
        // material, accumulating kept/archived across the whole subject.
        let remainingSkills = get().skills
        let newlyArchivedSkills: Skill[] = []
        for (const m of materialsUnderSubject) {
          const { kept, archived } = archiveSkillsForMaterial(remainingSkills, m.id, areaOfInterest)
          remainingSkills = kept
          newlyArchivedSkills = [...newlyArchivedSkills, ...archived]
        }

        set((s) => ({
          subjects: s.subjects.filter((x) => x.id !== id),
          materials: s.materials.filter((m) => m.subjectId !== id),
          archivedMaterials: [...s.archivedMaterials, ...archivedMats],
          skills: remainingSkills,
          archivedSkills: [...s.archivedSkills, ...newlyArchivedSkills],
        }))
        const u = get().currentUserId
        if (canSync(u)) {
          syncDelete('subjects', u, id)
          // Materials: never syncDelete -- archival mirrors the skills
          // pattern (move, don't delete; area_of_interest is the marker).
          for (const m of archivedMats) {
            syncUpsert('materials', u, {
              id: m.id,
              subject_id: m.subjectId,
              type: m.type,
              title: m.title,
              url: m.url,
              content: m.content,
              file_name: m.fileName,
              file_data_url: m.fileDataUrl,
              file_path: m.filePath,
              ai_notes: m.aiNotes,
              annotation_data_url: m.annotations ? JSON.stringify(m.annotations) : null,
              area_of_interest: m.areaOfInterest,
              is_exam_paper: m.isExamPaper ?? null,
            })
          }
          for (const sk of newlyArchivedSkills) {
            syncUpsert('skills', u, {
              id: sk.id,
              version: sk.version,
              title: sk.title,
              domain: sk.domain,
              capability_tags: sk.capabilityTags,
              content: sk.content,
              status: sk.status,
              confidence: sk.confidence,
              uses: sk.uses,
              successes: sk.successes,
              generation_method: sk.generationMethod,
              derived_from: sk.derivedFrom,
              material_id: sk.materialId,
              area_of_interest: sk.areaOfInterest,
              created_at: sk.createdAt, // see resyncSkillsForDomainFix's comment
              updated_at: sk.updatedAt,
            })
          }
        }
      },

      addMaterial: (m) => {
        const material: Material = { ...m, id: uid(), createdAt: nowIso() }
        set((s) => ({ materials: [...s.materials, material] }))
        const u = get().currentUserId
        if (canSync(u))
          syncUpsert('materials', u, {
            id: material.id,
            subject_id: material.subjectId,
            type: material.type,
            title: material.title,
            url: material.url,
            content: material.content,
            file_name: material.fileName,
            file_data_url: material.fileDataUrl,
            file_path: material.filePath,
            file_updated_at: material.fileUpdatedAt,
            ai_notes: material.aiNotes,
            annotation_data_url: material.annotations ? JSON.stringify(material.annotations) : null,
            area_of_interest: material.areaOfInterest,
            cheat_study_linked_ids: material.cheatStudyLinkedMaterialIds ?? null,
            is_exam_paper: material.isExamPaper ?? null,
          })
        return material
      },
      updateMaterial: (id, patch) => {
        set((s) => ({ materials: s.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) }))
        const u = get().currentUserId
        const material = get().materials.find((m) => m.id === id)
        if (canSync(u) && material)
          syncUpsert('materials', u, {
            id: material.id,
            subject_id: material.subjectId,
            type: material.type,
            title: material.title,
            url: material.url,
            content: material.content,
            file_name: material.fileName,
            file_data_url: material.fileDataUrl,
            file_path: material.filePath,
            file_updated_at: material.fileUpdatedAt,
            ai_notes: material.aiNotes,
            annotation_data_url: material.annotations ? JSON.stringify(material.annotations) : null,
            area_of_interest: material.areaOfInterest,
            cheat_study_linked_ids: material.cheatStudyLinkedMaterialIds ?? null,
            is_exam_paper: material.isExamPaper ?? null,
          })
      },
      removeMaterial: (id) => {
        const material = get().materials.find((x) => x.id === id)
        const { kept, archived } = archiveSkillsForMaterial(get().skills, id)
        // Real hard delete for everything else tied to this material
        // (2026-08-24, explicit user instruction: "le flashcard se elimino
        // il materiale devi eliminarle, same con i riassunti non è che me
        // li archivi"). Skills stay archived on purpose -- that's knowledge
        // that can be recognized and restored if a related Subject shows up
        // later (see addSubject's area-of-interest recognition), a real
        // design choice the user isn't objecting to. Flashcards/summaries/
        // chapters/highlights/textEdits have no equivalent future use once
        // their source material is gone -- they're derived FROM the file's
        // content, not portable knowledge about a topic -- so archiving them
        // would just be clutter with no path back, not a feature.
        const removedFlashcards = get().flashcards.filter((f) => f.materialId === id)
        const removedSummaries = get().summaries.filter((s) => s.materialId === id)
        // Cheat Study solutions are keyed on the EXAM material, not the study
        // material they were grounded in -- same "derived, no path back"
        // reasoning as summaries/flashcards above.
        const removedCheatStudySolutions = get().cheatStudySolutions.filter((c) => c.examMaterialId === id)
        const removedCheatStudyExercises = get().cheatStudyExercises.filter((c) => c.examMaterialId === id)
        const removedCheatStudyPrereqs = get().cheatStudyPrereqs.filter((c) => c.examMaterialId === id)
        const removedChapters = get().chapters.filter((c) => c.materialId === id)
        const removedHighlights = get().highlights.filter((h) => h.materialId === id)
        const removedTextEdits = get().textEdits.filter((t) => t.materialId === id)
        // The material-scoped study plan (planKey = `material:${id}`) is
        // local-only, never synced (see StudyPlanPanel's own note), so no
        // syncDelete needed -- just drop it from both maps the same way.
        const planKey = `material:${id}`
        set((s) => {
          const { [planKey]: _droppedPlan, ...studyPlans } = s.studyPlans
          const { [planKey]: _droppedCall, ...studyPlanCallEvents } = s.studyPlanCallEvents
          return {
            materials: s.materials.filter((x) => x.id !== id),
            skills: kept,
            archivedSkills: [...s.archivedSkills, ...archived],
            flashcards: s.flashcards.filter((f) => f.materialId !== id),
            summaries: s.summaries.filter((x) => x.materialId !== id),
            cheatStudySolutions: s.cheatStudySolutions.filter((x) => x.examMaterialId !== id),
            cheatStudyExercises: s.cheatStudyExercises.filter((x) => x.examMaterialId !== id),
            cheatStudyPrereqs: s.cheatStudyPrereqs.filter((x) => x.examMaterialId !== id),
            chapters: s.chapters.filter((c) => c.materialId !== id),
            highlights: s.highlights.filter((h) => h.materialId !== id),
            textEdits: s.textEdits.filter((t) => t.materialId !== id),
            studyPlans,
            studyPlanCallEvents,
          }
        })
        const u = get().currentUserId
        if (canSync(u)) {
          syncDelete('materials', u, id)
          for (const f of removedFlashcards) syncDelete('flashcards', u, f.id)
          for (const sm of removedSummaries) syncDelete('summaries', u, sm.id)
          for (const cs of removedCheatStudySolutions) syncDelete('cheat_study_solutions', u, cs.id)
          for (const ce of removedCheatStudyExercises) syncDelete('cheat_study_exercises', u, ce.id)
          for (const cp of removedCheatStudyPrereqs) syncDelete('cheat_study_prereqs', u, cp.id)
          for (const c of removedChapters) syncDelete('material_chapters', u, c.id)
          for (const h of removedHighlights) syncDelete('material_highlights', u, h.id)
          for (const t of removedTextEdits) syncDelete('text_edits', u, t.id)
          // Never syncDelete these -- archival mirrors archive_duplicates.py's
          // "move, don't delete" rule. Same row, status flips to ARCHIVED.
          for (const sk of archived) {
            syncUpsert('skills', u, {
              id: sk.id,
              version: sk.version,
              title: sk.title,
              domain: sk.domain,
              capability_tags: sk.capabilityTags,
              content: sk.content,
              status: sk.status,
              confidence: sk.confidence,
              uses: sk.uses,
              successes: sk.successes,
              generation_method: sk.generationMethod,
              derived_from: sk.derivedFrom,
              material_id: sk.materialId,
              area_of_interest: sk.areaOfInterest,
              created_at: sk.createdAt, // see resyncSkillsForDomainFix's comment
              updated_at: sk.updatedAt,
            })
          }
        }
        if (material?.filePath) deleteMaterialFile(material.filePath)
      },

      setStudyPlan: (planKey, chapters) => {
        set((s) => ({ studyPlans: { ...s.studyPlans, [planKey]: chapters } }))
      },
      // Real user request (2026-08-24): "voglio che mi assegni le task
      // giornaliere... escono nella sezione oggi... le vado a spuntare" --
      // deleting the whole plan now also removes the real Tasks it created
      // (see generate()'s auto-task-creation in both panels), not just the
      // in-panel checklist -- otherwise a deleted plan would leave orphaned
      // "ghost" tasks sitting in Oggi/Calendario with no plan behind them.
      removeStudyPlan: (planKey) => {
        const chapters = get().studyPlans[planKey] ?? []
        for (const it of chapters.flatMap((c) => c.items)) {
          if (it.taskId) get().removeTask(it.taskId)
        }
        set((s) => {
          const next = { ...s.studyPlans }
          delete next[planKey]
          // Found alongside the removeSubject cascade fix above (2026-08-26):
          // this never cleared studyPlanCallEvents, so a regenerated plan's
          // feedback/distillation could get attributed to a CALL event from
          // a plan that no longer exists -- same orphan shape, smaller blast
          // radius (a stale event id, not a whole visible ghost plan).
          const nextCallEvents = { ...s.studyPlanCallEvents }
          delete nextCallEvents[planKey]
          return { studyPlans: next, studyPlanCallEvents: nextCallEvents }
        })
      },
      reassignOverdueStudyPlanItems: (planKey) => {
        const state = get()
        const chapters = state.studyPlans[planKey]
        if (!chapters) return 0
        const subjectId = resolveStudyPlanSubjectId(planKey, state.materials)
        const examDaysLeft = subjectId ? daysUntilNextExam(state.events, subjectId) : undefined
        const today = nowIso().slice(0, 10)

        type Ref = { chapterIdx: number; itemIdx: number }
        const overdue: Ref[] = []
        const upcoming: Ref[] = []
        chapters.forEach((c, chapterIdx) =>
          c.items.forEach((it, itemIdx) => {
            if (it.done) return
            if (it.dueDate && it.dueDate < today) overdue.push({ chapterIdx, itemIdx })
            else upcoming.push({ chapterIdx, itemIdx })
          }),
        )
        if (overdue.length === 0) return 0

        const toRedistribute = [...overdue, ...upcoming]
        const dueDates = distributeAcrossDays(toRedistribute.length, examDaysLeft ?? 1)
        const updated = chapters.map((c) => ({ ...c, items: c.items.map((it) => ({ ...it })) }))
        toRedistribute.forEach((ref, i) => {
          const item = updated[ref.chapterIdx].items[ref.itemIdx]
          item.dueDate = dueDates[i]
          // Move the real linked task's own dueDate along with the plan
          // item (2026-08-24) -- otherwise the task stays stuck on its old
          // (now overdue) date in Oggi/Calendario even after "riassegnato".
          if (item.taskId) get().updateTask(item.taskId, { dueDate: dueDates[i] })
        })
        set({ studyPlans: { ...state.studyPlans, [planKey]: updated } })
        return overdue.length
      },
      setStudyPlanPlaybook: (text) => set({ studyPlanPlaybook: text }),
      setStudyPlanCallEvent: (planKey, eventId) => set((s) => ({ studyPlanCallEvents: { ...s.studyPlanCallEvents, [planKey]: eventId } })),
      recordRetrievalReview: (questionId, grade) => {
        const prev = get().retrievalReviews[questionId]
        // SM-2-lite: wrong/unsure resets to tomorrow, easy doubles the gap (capped so it never disappears for good).
        const intervalDays = grade === 'ripeti' ? 1 : Math.min((prev?.intervalDays ?? 1) * 2, 21)
        const due = new Date()
        due.setDate(due.getDate() + intervalDays)
        set((s) => ({
          retrievalReviews: { ...s.retrievalReviews, [questionId]: { dueDate: due.toISOString().slice(0, 10), intervalDays } },
        }))

        // 2026-08-20: "Ripasso lampo" has no Gemini call of its own -- the
        // RIPASSO questions are already generated inside generateStudyPlan
        // (the study_plan domain's existing CALL event), SM-2 here is pure
        // scheduling. But a graded recall answer ("facile"/"ripeti") is the
        // cleanest outcome signal anywhere in Aria -- not a behavioral
        // proxy, an actual correct/incorrect on a specific question -- so
        // it's worth feeding back to whichever CALL produced this question,
        // if that plan hasn't since been regenerated (studyPlanCallEvents
        // only tracks the CURRENT plan per key).
        const planEntry = Object.entries(get().studyPlans).find(([, chapters]) =>
          chapters.some((ch) => ch.quiz?.some((q) => q.id === questionId)),
        )
        if (planEntry) {
          const [planKey] = planEntry
          const callId = get().studyPlanCallEvents[planKey]
          const callEvent = get().skillEvents.find((e) => e.id === callId)
          if (callEvent) get().recordSkillOutcome(callEvent, grade === 'facile' ? 'positive' : 'negative')
        }
      },
      // A scheduled item (has taskId, see generate()'s auto-task-creation)
      // delegates to the real Task's one-way completeTask() instead of
      // flipping its own flag directly (2026-08-24) -- completeTask already
      // mirrors done:true back onto this exact item (see below), awards XP
      // once, and matches every other Task's one-way "done" UX in the app
      // (no un-checking). An item with no taskId (no exam date known yet)
      // keeps the old free-standing boolean toggle as a fallback.
      toggleStudyPlanItem: (planKey, chapterId, itemId) => {
        const chapter = get().studyPlans[planKey]?.find((ch) => ch.id === chapterId)
        const item = chapter?.items.find((it) => it.id === itemId)
        if (item?.taskId) {
          if (!item.done) get().completeTask(item.taskId)
          return
        }
        set((s) => ({
          studyPlans: {
            ...s.studyPlans,
            [planKey]: (s.studyPlans[planKey] ?? []).map((ch) =>
              ch.id === chapterId ? { ...ch, items: ch.items.map((it) => (it.id === itemId ? { ...it, done: !it.done } : it)) } : ch,
            ),
          },
        }))
      },
      addStudyPlanItemAsTask: (planKey, chapterId, itemId, taskSubjectId) => {
        const chapter = get().studyPlans[planKey]?.find((ch) => ch.id === chapterId)
        const item = chapter?.items.find((it) => it.id === itemId)
        if (!item) return
        const task = get().addTask({ subjectId: taskSubjectId ?? planKey, title: item.title, dueDate: item.dueDate, priority: 'media' })
        set((s) => ({
          studyPlans: {
            ...s.studyPlans,
            [planKey]: (s.studyPlans[planKey] ?? []).map((ch) =>
              ch.id === chapterId ? { ...ch, items: ch.items.map((it) => (it.id === itemId ? { ...it, addedAsTask: true, taskId: task.id } : it)) } : ch,
            ),
          },
        }))
      },

      addTask: (t) => {
        const task: Task = { ...t, id: uid(), createdAt: nowIso(), done: false, subtasks: t.subtasks ?? [] }
        set((s) => ({ tasks: [...s.tasks, task] }))
        const u = get().currentUserId
        if (canSync(u))
          syncUpsert('tasks', u, {
            id: task.id,
            subject_id: task.subjectId,
            title: task.title,
            description: task.description,
            due_date: task.dueDate,
            done: task.done,
            priority: task.priority,
            estimate_minutes: task.estimateMinutes,
            subtasks: task.subtasks,
            page_range: task.pageRange ?? null,
          })
        return task
      },
      updateTask: (id, patch) => {
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
        const u = get().currentUserId
        const task = get().tasks.find((t) => t.id === id)
        if (canSync(u) && task)
          syncUpsert('tasks', u, {
            id: task.id,
            subject_id: task.subjectId,
            title: task.title,
            description: task.description,
            due_date: task.dueDate,
            done: task.done,
            done_at: task.doneAt,
            priority: task.priority,
            estimate_minutes: task.estimateMinutes,
            subtasks: task.subtasks,
            page_range: task.pageRange ?? null,
          })
      },
      toggleSubtask: (taskId, subtaskId) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? { ...t, subtasks: t.subtasks.map((st) => (st.id === subtaskId ? { ...st, done: !st.done } : st)) }
              : t,
          ),
        }))
      },
      removeTask: (id) => {
        set((s) => ({ tasks: s.tasks.filter((x) => x.id !== id) }))
        const u = get().currentUserId
        if (canSync(u)) syncDelete('tasks', u, id)
      },
      completeTask: (id) => {
        const task = get().tasks.find((t) => t.id === id)
        const alreadyDone = task?.done
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: true, doneAt: nowIso() } : t)),
        }))
        // Real bug found live (2026-08-25, verifying the study-plan-on-
        // calendar feature): completeTask never pushed the done/doneAt
        // change to Supabase, unlike updateTask -- so App.tsx's periodic
        // hydrateFromRemote pull (runs again on every session refresh, not
        // just first login) would silently fetch the still-`done:false` row
        // back and revert a completion that had just happened, taking the
        // XP/streak gain with it since applyXp had the same gap (fixed
        // below). Reproduced live: two tasks completed back to back, only
        // one survived a few seconds later once a pull landed.
        const completed = get().tasks.find((t) => t.id === id)
        const u0 = get().currentUserId
        if (!alreadyDone && canSync(u0) && completed)
          syncUpsert('tasks', u0, {
            id: completed.id,
            subject_id: completed.subjectId,
            title: completed.title,
            description: completed.description,
            due_date: completed.dueDate,
            done: completed.done,
            done_at: completed.doneAt,
            priority: completed.priority,
            estimate_minutes: completed.estimateMinutes,
            subtasks: completed.subtasks,
            page_range: completed.pageRange ?? null,
          })
        // Mirror completion back onto any study-plan step this task was
        // auto-created from (2026-08-24) -- checking a task off in Oggi
        // must also mark its plan step done, same "single source of truth,
        // no drift" reasoning as recordRetrievalReview's cross-plan lookup
        // just below. Cheap: only iterates when a real match exists.
        if (!alreadyDone) {
          set((s) => {
            let changed = false
            const studyPlans: typeof s.studyPlans = { ...s.studyPlans }
            for (const [planKey, chapters] of Object.entries(studyPlans)) {
              if (!chapters.some((c) => c.items.some((it) => it.taskId === id))) continue
              changed = true
              studyPlans[planKey] = chapters.map((c) => ({
                ...c,
                items: c.items.map((it) => (it.taskId === id ? { ...it, done: true } : it)),
              }))
            }
            return changed ? { studyPlans } : {}
          })
        }
        if (alreadyDone) {
          return { xpGained: 0, leveledUp: false, streakChanged: false, newStreak: get().profile.streakCount, usedFreeze: false }
        }
        const xpGained = task?.priority === 'alta' ? 25 : task?.priority === 'media' ? 15 : 10
        return get().applyXp(xpGained)
      },

      addEvent: (e) => {
        const event: CalendarEvent = { ...e, id: uid(), createdAt: nowIso() }
        set((s) => ({ events: [...s.events, event] }))
        const u = get().currentUserId
        if (canSync(u))
          syncUpsert('events', u, {
            id: event.id,
            subject_id: event.subjectId,
            task_id: event.taskId,
            title: event.title,
            start: event.start,
            end: event.end,
            all_day: event.allDay ?? false,
            color: event.color,
            notes: event.notes,
            type: event.type,
          })
        return event
      },
      updateEvent: (id, patch) => {
        set((s) => ({ events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
        const u = get().currentUserId
        const event = get().events.find((e) => e.id === id)
        if (canSync(u) && event)
          syncUpsert('events', u, {
            id: event.id,
            subject_id: event.subjectId,
            task_id: event.taskId,
            title: event.title,
            start: event.start,
            end: event.end,
            all_day: event.allDay ?? false,
            color: event.color,
            notes: event.notes,
            type: event.type,
          })
      },
      removeEvent: (id) => {
        set((s) => ({ events: s.events.filter((x) => x.id !== id) }))
        const u = get().currentUserId
        if (canSync(u)) syncDelete('events', u, id)
      },

      addChatMessage: (m) => {
        set((s) => ({ chat: [...s.chat, { ...m, id: uid(), createdAt: nowIso() }] }))
      },
      clearChat: () => set({ chat: [] }),

      applyXp: (amount) => {
        const state = get()
        const xp = state.profile.xp + amount
        const level = levelForXp(xp)
        const leveledUp = level > state.profile.level
        const { profile: bumped, result } = bumpStreak({ ...state.profile, xp, level })
        set({ profile: bumped })
        // Same missing-sync bug as completeTask above, same fix pattern as
        // setResearchConsent's syncUpsert('profiles', ...) just below --
        // xp/level/streak never left the browser before this, so any pull
        // (hydrateFromRemote runs again on every session refresh) silently
        // reverted every completion's XP gain along with the task itself.
        const u = get().currentUserId
        if (canSync(u))
          syncUpsert('profiles', u, {
            display_name: bumped.displayName,
            xp: bumped.xp,
            level: bumped.level,
            streak_count: bumped.streakCount,
            last_active_date: bumped.lastActiveDate,
            streak_freezes: bumped.streakFreezes,
            research_consent: bumped.researchConsent ?? false,
            research_consent_at: bumped.researchConsentAt,
            skill_sharing_consent: bumped.skillSharingConsent ?? false,
            skill_sharing_consent_at: bumped.skillSharingConsentAt,
          })
        return { xpGained: amount, leveledUp, ...result }
      },
      registerFocusSessionCompleted: () => get().applyXp(20),

      setResearchConsent: (consent) => {
        set((s) => ({
          profile: { ...s.profile, researchConsent: consent, researchConsentAt: consent ? nowIso() : undefined },
        }))
        const u = get().currentUserId
        if (canSync(u)) {
          const p = get().profile
          syncUpsert('profiles', u, {
            display_name: p.displayName,
            xp: p.xp,
            level: p.level,
            streak_count: p.streakCount,
            last_active_date: p.lastActiveDate,
            streak_freezes: p.streakFreezes,
            research_consent: p.researchConsent ?? false,
            research_consent_at: p.researchConsentAt,
          })
        }
      },

      // Distinct from researchConsent on purpose -- see types.ts's
      // ProfileState.skillSharingConsent comment. `skill_sharing_consent`/
      // `skill_sharing_consent_at` need the same kind of Supabase migration
      // as `material_id`/`area_of_interest` did before this write round-trips
      // cross-device -- syncUpsert fails open (catches, console.warn) so this
      // is safe to ship ahead of that migration, same established pattern.
      setSkillSharingConsent: (consent) => {
        set((s) => ({
          profile: { ...s.profile, skillSharingConsent: consent, skillSharingConsentAt: consent ? nowIso() : undefined },
        }))
        const u = get().currentUserId
        if (canSync(u)) {
          const p = get().profile
          syncUpsert('profiles', u, {
            display_name: p.displayName,
            xp: p.xp,
            level: p.level,
            streak_count: p.streakCount,
            last_active_date: p.lastActiveDate,
            streak_freezes: p.streakFreezes,
            research_consent: p.researchConsent ?? false,
            research_consent_at: p.researchConsentAt,
            skill_sharing_consent: p.skillSharingConsent ?? false,
            skill_sharing_consent_at: p.skillSharingConsentAt,
          })
        }
      },

      ensureSkillsInitialized: () => {
        // Tops up any seed skill missing by id, EVERY load, not just once
        // (2026-08-26, real gap found while adding a new cheat_study seed):
        // the `skillsInitialized` early-return below used to skip this
        // entire function for any account already past its first-ever run,
        // so a seed added to seedSkills() LATER (after that account already
        // initialized) would never reach it -- same class of problem as a
        // new domain/status value added after a CHECK constraint was already
        // deployed (see CLAUDE.md). Cheap and idempotent once every seed
        // exists (empty diff), same "self-heal on every load" pattern as
        // librarianEnabled/researchConsent in App.tsx. Uses addSkill() so a
        // newly-added seed actually syncs to Supabase too -- the ORIGINAL
        // one-time seeding below never did (raw `set()`, no syncUpsert),
        // which is fine for content only ever read locally on this one
        // account/device, but would silently strand a seed that should be
        // there on every device.
        const existingIds = new Set(get().skills.map((s) => s.id))
        const missingSeeds = seedSkills().filter((s) => !existingIds.has(s.id))
        for (const seed of missingSeeds) get().addSkill(seed)

        if (get().skillsInitialized) return

        // Migrate the two legacy single-purpose memory fields into the
        // unified skill shape (not deleted from their old fields — kept
        // readable there too, in case anything still expects them).
        const migrated: Skill[] = []
        const now = nowIso()
        for (const m of get().materials) {
          if (!m.aiNotes) continue
          migrated.push({
            id: `migrated_material_${m.id}`,
            version: 1,
            title: `Memoria: ${m.title}`,
            domain: 'material_chat',
            capabilityTags: [`material:${m.id}`],
            content: m.aiNotes,
            status: 'PERSONAL_NOTE', // content-class domain, see domainClass() -- was VERIFIED pre-2026-08-24, never actually evidence-reviewed either way
            confidence: 1,
            uses: 0,
            successes: 0,
            generationMethod: 'distilled',
            createdAt: now,
            updatedAt: now,
          })
        }
        const playbook = get().studyPlanPlaybook
        if (playbook.trim()) {
          migrated.push({
            id: 'migrated_study_plan_playbook',
            version: 1,
            title: 'Quaderno piani di studio (migrato)',
            domain: 'study_plan',
            capabilityTags: ['piano', 'capitolo', 'studio'],
            content: playbook,
            status: 'PERSONAL_NOTE', // content-class domain, see domainClass() -- was VERIFIED pre-2026-08-24, never actually evidence-reviewed either way
            confidence: 1,
            uses: 0,
            successes: 0,
            generationMethod: 'distilled',
            createdAt: now,
            updatedAt: now,
          })
        }

        // Seeds were already added above via addSkill() -- only the
        // one-time legacy migration goes into this final set().
        set((s) => ({ skills: [...s.skills, ...migrated], skillsInitialized: true }))
      },

      setLibrarianEnabled: (on) => set({ librarianEnabled: on }),

      addSkill: (skill) => {
        set((s) => ({ skills: [...s.skills, skill] }))
        const u = get().currentUserId
        if (canSync(u))
          syncUpsert('skills', u, {
            id: skill.id,
            version: skill.version,
            title: skill.title,
            domain: skill.domain,
            capability_tags: skill.capabilityTags,
            content: skill.content,
            status: skill.status,
            confidence: skill.confidence,
            uses: skill.uses,
            successes: skill.successes,
            generation_method: skill.generationMethod,
            derived_from: skill.derivedFrom,
            material_id: skill.materialId,
            area_of_interest: skill.areaOfInterest,
            created_at: skill.createdAt, // see resyncSkillsForDomainFix's comment
            updated_at: skill.updatedAt,
          })
      },

      upsertSkillContent: (id, content, fallback) => {
        const now = nowIso()
        set((s) => {
          const exists = s.skills.some((sk) => sk.id === id)
          if (exists) {
            return { skills: s.skills.map((sk) => (sk.id === id ? { ...sk, content, updatedAt: now } : sk)) }
          }
          return { skills: [...s.skills, { ...fallback, id, content, createdAt: now, updatedAt: now }] }
        })
        const u = get().currentUserId
        const skill = get().skills.find((sk) => sk.id === id)
        if (canSync(u) && skill)
          syncUpsert('skills', u, {
            id: skill.id,
            version: skill.version,
            title: skill.title,
            domain: skill.domain,
            capability_tags: skill.capabilityTags,
            content: skill.content,
            status: skill.status,
            confidence: skill.confidence,
            uses: skill.uses,
            successes: skill.successes,
            generation_method: skill.generationMethod,
            derived_from: skill.derivedFrom,
            material_id: skill.materialId,
            area_of_interest: skill.areaOfInterest,
            created_at: skill.createdAt, // see resyncSkillsForDomainFix's comment
            updated_at: skill.updatedAt,
          })
      },

      restoreSkill: (id) => {
        const skill = get().archivedSkills.find((sk) => sk.id === id)
        if (!skill) return
        const restored: Skill = { ...skill, status: 'DRAFT', updatedAt: nowIso() }
        set((s) => ({
          archivedSkills: s.archivedSkills.filter((sk) => sk.id !== id),
          skills: [...s.skills, restored],
        }))
        const u = get().currentUserId
        if (canSync(u))
          syncUpsert('skills', u, {
            id: restored.id,
            version: restored.version,
            title: restored.title,
            domain: restored.domain,
            capability_tags: restored.capabilityTags,
            content: restored.content,
            status: restored.status,
            confidence: restored.confidence,
            uses: restored.uses,
            successes: restored.successes,
            generation_method: restored.generationMethod,
            derived_from: restored.derivedFrom,
            material_id: restored.materialId,
            area_of_interest: restored.areaOfInterest,
            created_at: restored.createdAt, // see resyncSkillsForDomainFix's comment
            updated_at: restored.updatedAt,
          })
      },

      logFormulaGateAttempt: (attempt) => {
        set((s) => ({ formulaGateAttempts: [...s.formulaGateAttempts, attempt].slice(-SKILL_EVENTS_CAP) }))
      },

      logSkillCall: (domain, config, skillIds, model) => {
        const event = logCall(domain, config, skillIds, model)
        set((s) => ({ skillEvents: [...s.skillEvents, event].slice(-SKILL_EVENTS_CAP) }))
        const u = get().currentUserId
        syncSkillEvent(u, event)
        return event
      },

      recordSkillOutcome: (callEvent, outcome) => {
        const event = logOutcome(callEvent, outcome)
        set((s) => {
          const events = [...s.skillEvents, event].slice(-SKILL_EVENTS_CAP)
          const touched = new Set(event.skillIds)
          const bumped = s.skills.map((sk) =>
            touched.has(sk.id) ? { ...sk, uses: sk.uses + 1, successes: sk.successes + (outcome === 'positive' ? 1 : 0) } : sk,
          )
          const reviewed = reviewSkills(bumped, events)
          return { skillEvents: events, skills: reviewed }
        })
        const u = get().currentUserId
        syncSkillEvent(u, event)
        if (canSync(u)) {
          for (const sk of get().skills.filter((sk) => event.skillIds.includes(sk.id))) {
            syncUpsert('skills', u, {
              id: sk.id,
              version: sk.version,
              title: sk.title,
              domain: sk.domain,
              capability_tags: sk.capabilityTags,
              content: sk.content,
              status: sk.status,
              confidence: sk.confidence,
              uses: sk.uses,
              successes: sk.successes,
              generation_method: sk.generationMethod,
              derived_from: sk.derivedFrom,
              material_id: sk.materialId,
              area_of_interest: sk.areaOfInterest,
              created_at: sk.createdAt, // see resyncSkillsForDomainFix's comment
              updated_at: sk.updatedAt,
            })
          }
        }
      },

      addHighlight: (h) => {
        const now = nowIso()
        const highlight: MaterialHighlight = { ...h, id: uid(), createdAt: now, updatedAt: now }
        set((s) => ({ highlights: [...s.highlights, highlight] }))
        const u = get().currentUserId
        if (canSync(u))
          syncUpsert('material_highlights', u, {
            id: highlight.id,
            material_id: highlight.materialId,
            page: highlight.page,
            text: highlight.text,
            rects: highlight.rects,
            note: highlight.note,
            color: highlight.color,
          })
        return highlight
      },
      updateHighlightNote: (id, note) => {
        const now = nowIso()
        set((s) => ({ highlights: s.highlights.map((h) => (h.id === id ? { ...h, note, updatedAt: now } : h)) }))
        const u = get().currentUserId
        const highlight = get().highlights.find((h) => h.id === id)
        if (canSync(u) && highlight)
          syncUpsert('material_highlights', u, {
            id: highlight.id,
            material_id: highlight.materialId,
            page: highlight.page,
            text: highlight.text,
            rects: highlight.rects,
            note: highlight.note,
            color: highlight.color,
          })
      },
      removeHighlight: (id) => {
        set((s) => ({ highlights: s.highlights.filter((h) => h.id !== id) }))
        const u = get().currentUserId
        if (canSync(u)) syncDelete('material_highlights', u, id)
      },

      setMaterialChapters: (materialId, chapters) => {
        const now = nowIso()
        const u = get().currentUserId
        const old = get().chapters.filter((c) => c.materialId === materialId)
        const next: MaterialChapter[] = chapters.map((c, i) => ({
          id: old[i]?.id ?? uid(), // reuse ids in order where possible so a manual edit updates rows instead of orphaning them
          materialId,
          title: c.title,
          startPage: c.startPage,
          endPage: c.endPage,
          order: i,
          subsections: c.subsections ?? [],
          transcribedText: c.transcribedText,
          createdAt: old[i]?.createdAt ?? now,
          updatedAt: now,
        }))
        set((s) => ({ chapters: [...s.chapters.filter((c) => c.materialId !== materialId), ...next] }))
        if (canSync(u)) {
          for (const c of old) if (!next.some((n) => n.id === c.id)) syncDelete('material_chapters', u, c.id)
          for (const c of next)
            syncUpsert('material_chapters', u, {
              id: c.id,
              material_id: c.materialId,
              title: c.title,
              start_page: c.startPage,
              end_page: c.endPage,
              order: c.order,
              subsections: c.subsections,
              transcribed_text: c.transcribedText ?? null,
            })
        }
      },

      addFlashcards: (cards) => {
        const now = nowIso()
        const created: Flashcard[] = cards.map((c) => ({ ...c, id: uid(), createdAt: now }))
        set((s) => ({ flashcards: [...s.flashcards, ...created] }))
        const u = get().currentUserId
        if (canSync(u))
          for (const c of created)
            syncUpsert('flashcards', u, { id: c.id, material_id: c.materialId, chapter_id: c.chapterId, section_id: c.sectionId, front: c.front, back: c.back, suspended: false })
      },
      removeFlashcardsFor: (materialId, chapterId, sectionId) => {
        const toRemove = get().flashcards.filter((f) => f.materialId === materialId && f.chapterId === chapterId && f.sectionId === sectionId)
        set((s) => ({ flashcards: s.flashcards.filter((f) => !toRemove.some((r) => r.id === f.id)) }))
        const u = get().currentUserId
        if (canSync(u)) for (const f of toRemove) syncDelete('flashcards', u, f.id)
      },
      removeFlashcard: (id) => {
        set((s) => ({ flashcards: s.flashcards.filter((f) => f.id !== id) }))
        const u = get().currentUserId
        if (canSync(u)) syncDelete('flashcards', u, id)
      },
      updateFlashcard: (id, patch) => {
        set((s) => ({ flashcards: s.flashcards.map((f) => (f.id === id ? { ...f, ...patch } : f)) }))
        const u = get().currentUserId
        const card = get().flashcards.find((f) => f.id === id)
        if (canSync(u) && card)
          syncUpsert('flashcards', u, {
            id: card.id,
            material_id: card.materialId,
            chapter_id: card.chapterId,
            section_id: card.sectionId,
            front: card.front,
            back: card.back,
            suspended: card.suspended ?? false,
          })
      },

      setSummary: (materialId, chapterId, sectionId, content) => {
        const now = nowIso()
        const existing = get().summaries.find((s) => s.materialId === materialId && s.chapterId === chapterId && s.sectionId === sectionId)
        const summary: MaterialSummary = existing
          ? { ...existing, content, updatedAt: now }
          : { id: uid(), materialId, chapterId, sectionId, content, createdAt: now, updatedAt: now }
        set((s) => ({ summaries: [...s.summaries.filter((x) => x.id !== summary.id), summary] }))
        const u = get().currentUserId
        if (canSync(u))
          syncUpsert('summaries', u, {
            id: summary.id,
            material_id: summary.materialId,
            chapter_id: summary.chapterId,
            section_id: summary.sectionId,
            content: summary.content,
          })
      },
      removeSummary: (id) => {
        set((s) => ({ summaries: s.summaries.filter((x) => x.id !== id) }))
        const u = get().currentUserId
        if (canSync(u)) syncDelete('summaries', u, id)
      },

      setCheatStudySolution: (examMaterialId, chapterId, sectionId, content) => {
        const now = nowIso()
        const existing = get().cheatStudySolutions.find((s) => s.examMaterialId === examMaterialId && s.chapterId === chapterId && s.sectionId === sectionId)
        const solution: CheatStudySolution = existing
          ? { ...existing, content, updatedAt: now }
          : { id: uid(), examMaterialId, chapterId, sectionId, content, createdAt: now, updatedAt: now }
        set((s) => ({ cheatStudySolutions: [...s.cheatStudySolutions.filter((x) => x.id !== solution.id), solution] }))
        const u = get().currentUserId
        if (canSync(u))
          syncUpsert('cheat_study_solutions', u, {
            id: solution.id,
            exam_material_id: solution.examMaterialId,
            chapter_id: solution.chapterId,
            section_id: solution.sectionId,
            content: solution.content,
          })
      },
      removeCheatStudySolution: (id) => {
        set((s) => ({ cheatStudySolutions: s.cheatStudySolutions.filter((x) => x.id !== id) }))
        const u = get().currentUserId
        if (canSync(u)) syncDelete('cheat_study_solutions', u, id)
      },

      setCheatStudyExercise: (examMaterialId, chapterId, sectionId, content) => {
        const now = nowIso()
        const existing = get().cheatStudyExercises.find((s) => s.examMaterialId === examMaterialId && s.chapterId === chapterId && s.sectionId === sectionId)
        const exercise: CheatStudyExercise = existing
          ? { ...existing, content, updatedAt: now }
          : { id: uid(), examMaterialId, chapterId, sectionId, content, createdAt: now, updatedAt: now }
        set((s) => ({ cheatStudyExercises: [...s.cheatStudyExercises.filter((x) => x.id !== exercise.id), exercise] }))
        const u = get().currentUserId
        if (canSync(u))
          syncUpsert('cheat_study_exercises', u, {
            id: exercise.id,
            exam_material_id: exercise.examMaterialId,
            chapter_id: exercise.chapterId,
            section_id: exercise.sectionId,
            content: exercise.content,
          })
      },
      removeCheatStudyExercise: (id) => {
        set((s) => ({ cheatStudyExercises: s.cheatStudyExercises.filter((x) => x.id !== id) }))
        const u = get().currentUserId
        if (canSync(u)) syncDelete('cheat_study_exercises', u, id)
      },

      setCheatStudyPrereq: (examMaterialId, chapterId, sectionId, content) => {
        const now = nowIso()
        const existing = get().cheatStudyPrereqs.find((s) => s.examMaterialId === examMaterialId && s.chapterId === chapterId && s.sectionId === sectionId)
        const prereq: CheatStudyPrereqSet = existing
          ? { ...existing, content, updatedAt: now }
          : { id: uid(), examMaterialId, chapterId, sectionId, content, createdAt: now, updatedAt: now }
        set((s) => ({ cheatStudyPrereqs: [...s.cheatStudyPrereqs.filter((x) => x.id !== prereq.id), prereq] }))
        const u = get().currentUserId
        if (canSync(u))
          syncUpsert('cheat_study_prereqs', u, {
            id: prereq.id,
            exam_material_id: prereq.examMaterialId,
            chapter_id: prereq.chapterId,
            section_id: prereq.sectionId,
            content: prereq.content,
          })
      },
      removeCheatStudyPrereq: (id) => {
        set((s) => ({ cheatStudyPrereqs: s.cheatStudyPrereqs.filter((x) => x.id !== id) }))
        const u = get().currentUserId
        if (canSync(u)) syncDelete('cheat_study_prereqs', u, id)
      },

      setCheatStudyLinkedMaterials: (examMaterialId, linkedMaterialIds) => {
        get().updateMaterial(examMaterialId, { cheatStudyLinkedMaterialIds: linkedMaterialIds })
      },

      setTextEdit: (materialId, page, rect, replacement) => {
        const now = nowIso()
        const existing = get().textEdits.find(
          (t) => t.materialId === materialId && t.page === page && Math.abs(t.x - rect.x) < 1 && Math.abs(t.y - rect.y) < 1,
        )
        const edit: TextEdit = existing
          ? { ...existing, ...rect, replacement, updatedAt: now }
          : { id: uid(), materialId, page, ...rect, replacement, createdAt: now, updatedAt: now }
        set((s) => ({ textEdits: [...s.textEdits.filter((t) => t.id !== edit.id), edit] }))
        const u = get().currentUserId
        if (canSync(u))
          syncUpsert('text_edits', u, {
            id: edit.id,
            material_id: edit.materialId,
            page: edit.page,
            x: edit.x,
            y: edit.y,
            width: edit.width,
            height: edit.height,
            replacement: edit.replacement,
          })
      },
      removeTextEdit: (id) => {
        set((s) => ({ textEdits: s.textEdits.filter((t) => t.id !== id) }))
        const u = get().currentUserId
        if (canSync(u)) syncDelete('text_edits', u, id)
      },
    }),
    {
      name: 'aria-app-storage',
      partialize: (s) => ({
        subjects: s.subjects,
        materials: s.materials,
        tasks: s.tasks,
        events: s.events,
        chat: s.chat,
        profile: s.profile,
        studyPlans: s.studyPlans,
        studyPlanPlaybook: s.studyPlanPlaybook,
        studyPlanCallEvents: s.studyPlanCallEvents,
        retrievalReviews: s.retrievalReviews,
        pushedLocalDataFor: s.pushedLocalDataFor,
        skillsResyncedForDomainFix: s.skillsResyncedForDomainFix,
        skills: s.skills,
        archivedSkills: s.archivedSkills,
        archivedMaterials: s.archivedMaterials,
        skillEvents: s.skillEvents,
        formulaGateAttempts: s.formulaGateAttempts,
        librarianEnabled: s.librarianEnabled,
        skillsInitialized: s.skillsInitialized,
        highlights: s.highlights,
        chapters: s.chapters,
        flashcards: s.flashcards,
        summaries: s.summaries,
        cheatStudySolutions: s.cheatStudySolutions,
        cheatStudyExercises: s.cheatStudyExercises,
        cheatStudyPrereqs: s.cheatStudyPrereqs,
        textEdits: s.textEdits,
      }),
    },
  ),
)
