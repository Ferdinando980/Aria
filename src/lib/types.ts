export type ID = string

export interface Subject {
  id: ID
  name: string
  color: string
  icon: string
  createdAt: string
}

export type MaterialType = 'link' | 'note' | 'file'

export interface Material {
  id: ID
  subjectId: ID
  type: MaterialType
  title: string
  url?: string
  content?: string
  fileName?: string
  /** Base64 data URL — only used as a local-only fallback when there's no Supabase Storage available. */
  fileDataUrl?: string
  /** Path inside the Supabase Storage "materials" bucket, when the file was uploaded to the cloud. */
  filePath?: string
  /** Bumped ONLY when the actual file bytes change (useAddFileMaterial's
   * initial upload, useReplaceMaterialFile's real replace) -- 2026-08-25,
   * a deliberately separate field from a generic `updatedAt` (this Material
   * type doesn't even have one), specifically so materialFileCache.ts's
   * staleness check has a signal that means "the file changed," not
   * "something in this record changed." updateMaterial() is also the same
   * function a rename/note-edit/annotation-save goes through -- a shared
   * generic timestamp would make renaming a material invalidate its cached
   * PDF blob exactly as if the file itself had been replaced. */
  fileUpdatedAt?: string
  /** Aria's accumulated notes about this specific material — grows across chat sessions, unique per file. */
  aiNotes?: string
  /** Freehand whiteboard sketch, per PDF page (page number -> PNG data URL) so a
   * doodle stays on the page it was drawn on instead of floating over whatever's
   * on screen when you scroll/change page. Non-PDF materials never key into this. */
  annotations?: Record<number, string>
  /** Set ONLY when this material has been archived by deleting its whole
   * Subject (useAppStore.ts's removeSubject) -- the subject's name at the
   * moment of deletion, kept even though the subject itself is gone, so a
   * later Subject with a related name can recognize it (see skills.ts's
   * matchesAreaOfInterest). Presence of this field IS the "archived" marker
   * -- a live material never has it set, so it doubles as the discriminator
   * hydrateFromRemote uses to route a synced row into `archivedMaterials` vs
   * `materials` (no separate boolean needed). Deliberately NOT set by
   * removeMaterial() (deleting one file directly, subject untouched) --
   * that's a hard delete same as before, an explicit single-item delete
   * reads as "I meant to remove this," not "archive this whole area." */
  areaOfInterest?: string
  createdAt: string
  /** Cheat Study (2026-08-26): materials the user explicitly linked to THIS
   * material when it's used as an exam paper -- an opt-in session config,
   * never the search input itself (the exam paper's own exercises are). When
   * set, CheatStudy.tsx searches for relevant sections ONLY within these
   * linked materials' chapters (by tag overlap with each exercise's own
   * text, then existing material_knowledge skills for the matched scope) --
   * never a full-text/online search. Undefined or empty = no material
   * linked, generation falls back to plain Gemini with no grounding. */
  cheatStudyLinkedMaterialIds?: string[]
  /** True for a file uploaded through Cheat Study's own "traccia d'esame"
   * dropzone (2026-08-26, real user correction: "le tracce di esame NON
   * devono essere messe in materiale, non c'entrano un cazzo... dovrebbe
   * essere una cosa a parte"). Before this flag, an uploaded exam paper was
   * a plain `Material` indistinguishable from real study material -- it
   * leaked into Materiali's browsing grid and into every other page's
   * material picker (Flashcards, Riassunti), mixed in with the user's
   * actual study files. Still stored and cached through the exact same
   * infrastructure as any other Material (Supabase Storage/IndexedDB blob
   * cache, so a traccia persists and reopens instantly later, same as
   * anything else) -- ONLY the surfacing changes: Materiali/Flashcards/
   * Riassunti/Piano di studio's material lists all filter this OUT, and
   * Cheat Study's own "riprendi una traccia già caricata" list filters FOR
   * it. A study material never has this set; there is no in-between. */
  isExamPaper?: boolean
}

/**
 * A word/phrase highlighted at a specific spot in a PDF, with an optional note
 * attached — the "collegamenti" feature. Tied to one exact location, not every
 * occurrence of the text: `rects` are the real selected glyph boxes captured at
 * highlight time, in unscaled PDF page units (viewport scale=1), so they stay
 * correctly positioned at any zoom level without re-deriving them from the text.
 */
export interface MaterialHighlight {
  id: ID
  materialId: ID
  page: number // 1-indexed
  text: string
  rects: { x: number; y: number; width: number; height: number }[]
  note?: string
  color: string
  createdAt: string
  updatedAt: string
}

/**
 * A staged PDF text correction, created and managed only inside PdfEditor.tsx
 * (2026-08-20, explicit request: "modifica del testo... solo se abilitata
 * con richiesta"; rebuilt the same day into a dedicated editor per "sto
 * editor pdf non mi piace... usami tutto quello che ha pdf.lib"). While
 * staged here it's just data -- nothing in the ordinary viewer renders it.
 * "Salva nel file" (pdfExport.ts's exportPdfWithEdits) burns every staged
 * edit into the material's actual file as real, selectable PDF text (a
 * white cover rect + a genuine drawText call, not a rasterized image), then
 * the records are deleted -- once saved, the correction is just normal PDF
 * content the viewer already knows how to show, so nothing needs to persist
 * here afterward. Known, disclosed limitation: pdf-lib can't remove the
 * original glyphs from the content stream, only cover them, so the old text
 * is still technically present underneath the correction in the saved file.
 */
export interface TextEdit {
  id: ID
  materialId: ID
  page: number
  x: number // unscaled page-space (viewport scale=1), same convention as MaterialHighlight.rects
  y: number
  width: number
  height: number
  replacement: string
  createdAt: string
  updatedAt: string
}

export interface ChapterSection {
  id: ID
  title: string
  startPage: number
  endPage: number
  /** Cheat Study image support (2026-08-26): set ONLY for a section detected
   * from a photo/scan (Gemini vision transcribed it directly, no PDF page to
   * extract from later) -- when present, callers use this text as-is
   * instead of calling getChapterScopedText, which is meaningless for a
   * material with no real PDF pages. Undefined for every PDF-derived
   * section, the overwhelming majority. */
  transcribedText?: string
}

/**
 * PDF page-range chapters (2026-08-20) — auto-detected once per material via
 * Gemini, then cached: opening the same material later shows the same
 * division instead of re-segmenting it every time. `startPage`/`endPage` are
 * user-redefinable (a bad automatic split shouldn't be a dead end), and
 * `subsections` cover the "sotto-sezioni interne al capitolo" case without a
 * separate top-level concept. This is deliberately a DIFFERENT structure
 * from StudyPlanChapter (the AI-authored study-plan chapters with RIASSUNTO/
 * passi/RIPASSO, generated from raw text with no page anchoring) — that one
 * already exists and stays as-is; this one exists because the study plan's
 * chapters can't be used to scope "which pages" for a flashcard deck or a
 * jump-to-page action, only ChapterSection's page range can.
 */
export interface MaterialChapter {
  id: ID
  materialId: ID
  title: string
  startPage: number
  endPage: number
  order: number
  subsections: ChapterSection[]
  createdAt: string
  updatedAt: string
  /** See ChapterSection.transcribedText -- same idea, for a chapter with no
   * subsections of its own (transcribed directly, whole chapter = whole
   * detected exercise on that image). */
  transcribedText?: string
}

/** A front/back flashcard generated from one material, ALWAYS scoped to a
 * chapter and, when that chapter has subsections, optionally to one
 * specific ChapterSection within it (sectionId undefined = the whole
 * chapter, not "whole material" -- 2026-08-21, explicit request: "le
 * flashcard le devi tenere sempre per capitolo e nel caso sezione". A
 * material with no detected chapters simply can't have flashcards yet; the
 * UI points the person at "Capitoli" first rather than falling back to a
 * flat whole-material deck). Reviewed with the SAME SM-2-lite scheduler
 * already built for "Ripasso lampo" (see recordRetrievalReview in
 * useAppStore.ts) — a flashcard's `id` is just another key into
 * `retrievalReviews`, no separate scheduling logic needed. */
export interface Flashcard {
  id: ID
  materialId: ID
  chapterId: ID
  sectionId?: ID
  front: string
  back: string
  createdAt: string
  /** 2026-08-24 (roadmap: "sospendere eventualmente una card"). Excluded
   * from review (scopedCards still lists it for management, dueCards does
   * not) without deleting it -- for a card that's still correct but not
   * worth reviewing right now (already rock-solid, or temporarily not
   * relevant), same "archive don't delete" principle used elsewhere in this
   * app rather than a one-way removeFlashcard. */
  suspended?: boolean
}

/** A written summary, same scoping rule as Flashcard (always a chapter,
 * optionally one of its sections) -- deliberately its own record type, not
 * a field on MaterialChapter, so "genera riassunto" can be requested
 * per-scope independently of chapter detection and shown in its own section
 * (2026-08-20, explicit request: summaries live apart from flashcards). */
export interface MaterialSummary {
  id: ID
  materialId: ID
  chapterId: ID
  sectionId?: ID
  content: string
  createdAt: string
  updatedAt: string
}

/** Cheat Study (2026-08-25) — a past-exam exercise (one chapter/section of a
 * material used AS an exam paper, reusing the existing chapter-detection
 * feature rather than inventing a separate "exam" concept) paired with an
 * AI-explained solution grounded in the user's OWN real study material from
 * the same subject (found by tag overlap, see CheatStudy.tsx) — never
 * generated from the exercise text alone. `examMaterialId`/`chapterId`/
 * `sectionId` identify the exercise being solved, same triple shape as
 * MaterialSummary's material/chapter/section scoping. */
export interface CheatStudySolution {
  id: ID
  examMaterialId: ID
  chapterId: ID
  sectionId?: ID
  content: string
  createdAt: string
  updatedAt: string
}

/** The other Cheat Study output (2026-08-26, real user correction: "e ti
 * permette di generare esercizi equivalenti") -- same scoping triple as
 * CheatStudySolution, a sibling not a replacement: both are shown for the
 * same exercise. */
export interface CheatStudyExercise {
  id: ID
  examMaterialId: ID
  chapterId: ID
  sectionId?: ID
  content: string
  createdAt: string
  updatedAt: string
}

/** Third sibling output (2026-08-26, real user request: "ti crea gli
 * esercizi base per arrivare a svolgere l'esercizio proposto... partire
 * dalle piccole cose, adatto a persone con ADHD") -- a ladder of small
 * warm-up exercises leading up to the real one, same "small steps, first
 * one trivial" principle already applied to task breakdown (see
 * SYSTEM_PROMPT in gemini.ts). Same shape/scoping as CheatStudySolution/
 * CheatStudyExercise on purpose -- content is markdown text using the same
 * "## Esercizio base N" + [LABEL] conventions, rendered by the same
 * CheatStudySteps component, not a separate JSON structure. */
export interface CheatStudyPrereqSet {
  id: ID
  examMaterialId: ID
  chapterId: ID
  sectionId?: ID
  content: string
  createdAt: string
  updatedAt: string
}

export interface SubTask {
  id: ID
  title: string
  done: boolean
}

export type Priority = 'bassa' | 'media' | 'alta'

export interface Task {
  id: ID
  subjectId?: ID
  title: string
  description?: string
  dueDate?: string // ISO date
  done: boolean
  doneAt?: string
  priority: Priority
  estimateMinutes?: number
  subtasks: SubTask[]
  createdAt: string
  /** Real page range (from the source MaterialChapter/ChapterSection this
   * task's study-plan step was generated from), 2026-08-24, real user
   * request: "vorrei che dividesse il numero di pagine da studiare... oggi
   * ho fatto 10-15 pagine, domani 20-25". A SUB-range of the chapter's own
   * pages, one per step (2026-08-26, follow-up user correction: "le task
   * devono essere divise su pagine... tipo pagine 2-5 6-8" -- the first cut
   * of this feature gave every step of a chapter the identical whole-chapter
   * range, which didn't actually tell the user which pages to read on which
   * day). See utils.ts's splitPageRange. Undefined for a task whose source
   * chapter has no detected page range yet (a material with no "Rileva
   * capitoli" run) -- no page badge shown rather than a fabricated one. See
   * StudyPlanPanel/MaterialPlanPanel's generate(). */
  pageRange?: { start: number; end: number }
}

export interface CalendarEvent {
  id: ID
  createdAt: string
  subjectId?: ID
  title: string
  start: string // ISO datetime
  end?: string // ISO datetime
  allDay?: boolean
  color?: string
  notes?: string
  taskId?: ID
  /** Absent/'evento' = normal event. 'esame' marks a deadline the study plan
   * generator looks up (see studyPlanDeadline in gemini.ts's caller) to pace
   * itself against, instead of planning with no sense of how much time is
   * actually left. */
  type?: 'evento' | 'esame'
}

export interface FocusSession {
  id: ID
  taskId?: ID
  startedAt: string
  durationMinutes: number
  completed: boolean
}

export interface ChatMessage {
  id: ID
  role: 'user' | 'model'
  text: string
  /** Filename shown for messages that had a file attached. */
  attachmentName?: string
  attachmentMimeType?: string
  /** Only kept for small attachments so they can be reopened later — big files just keep the name. */
  attachmentDataUrl?: string
  /** For 'model' messages produced through the skill library: the CALL SkillEvent
   * id, so a 👍/👎 on this message can log an OUTCOME tied back to it. */
  skillEventRef?: string
  skillDomain?: SkillDomain
  createdAt: string
}

export interface StudyPlanItem {
  id: ID
  title: string
  done: boolean
  addedAsTask?: boolean
  /** ISO date (YYYY-MM-DD), 2026-08-24 -- which day this step is scheduled
   * for, spread evenly across the days remaining until the subject's exam
   * (see utils.ts's distributeAcrossDays). Undefined when no exam date is
   * known yet (see MaterialPlanPanel/StudyPlanPanel's exam-date prompt) --
   * a plan with no known deadline has no real basis for a day-by-day
   * schedule, so it stays a flat checklist instead of faking one. Reassigned
   * (see useAppStore.ts's reassignOverdueStudyPlanItems) only on explicit
   * user action, never silently in the background -- matches this app's
   * no-surprises design principle (CLAUDE.md). */
  dueDate?: string
  /** Real Task id this step was turned into (2026-08-24, real user request:
   * "voglio che mi assegni le task giornaliere... che vado poi a spuntare
   * appena fatte" -- a scheduled step is no longer just tracked internally,
   * it becomes an actual Task with the same dueDate so it shows up in "Oggi"
   * and can be checked off there like anything else). Undefined when the
   * item has no dueDate yet (no exam date known) or predates this feature --
   * `addedAsTask` alone still covers the older manual "+task" button. Kept
   * in sync both ways: useAppStore.ts's completeTask() mirrors a real task's
   * completion back onto the item with this id; reassignOverdueStudyPlanItems
   * moves the linked task's own dueDate along with the item's. */
  taskId?: ID
  /** Same as Task.pageRange (a per-STEP sub-range, not the whole chapter's
   * pages -- see its comment), mirrored here so the plan panel itself can
   * show it without looking up the linked task (2026-08-24). */
  pageRange?: { start: number; end: number }
}

/** A short recall-practice question tied to one chapter — the "testing effect" (Roediger & Karpicke): actively
 * retrieving a fact cements it far better than re-reading. Resurfaced later, spaced out, from the Oggi page. */
export interface StudyPlanQuizItem {
  id: ID
  question: string
}

export interface StudyPlanChapter {
  id: ID
  title: string
  /** Written once by Aria and cached — regenerating extends it rather than rewriting from scratch. */
  summary: string
  items: StudyPlanItem[]
  quiz?: StudyPlanQuizItem[]
  /** Links this plan chapter back to the real MaterialChapter it was
   * generated from (see gemini.ts's generateStudyPlan/linkMaterialChapterIds
   * and materialContent.ts's buildStudyPlanChapterInputs) -- lets the UI
   * look up that chapter's own MaterialSummary and show it inline, per
   * explicit user request (2026-08-21): "quando clicco su una parte...
   * mostri il riassunto di quella parte." Undefined when this plan predates
   * the fix, or the source material had no detected chapters yet. */
  materialChapterId?: ID
  /** Set alongside materialChapterId when this plan block came from one real
   * detected SUBSECTION, not a whole chapter (2026-08-24, real user report:
   * "manca la divisione per sezioni" -- flagged missing earlier, built now).
   * Lets the summary lookup below match the exact section, not just its
   * parent chapter. Undefined for a chapter with no subsections, or the
   * whole-material fallback. */
  materialSectionId?: ID
  /** Minutes, from the model's own real estimate for this chapter -- see
   * gemini.ts's ParsedChapter.estimatedMinutes comment. Drives day-by-day
   * scheduling (utils.ts's distributeByWeight); undefined for a plan
   * generated before this field existed, or a rare parse miss. */
  estimatedMinutes?: number
}

/** Lightweight spaced-repetition state per quiz question (SM-2-lite): interval doubles on "facile",
 * resets to 1 day on "da rivedere" — spacing retrieval out over time is what makes it stick (Cepeda et al.). */
export interface RetrievalReviewState {
  dueDate: string // ISO date
  intervalDays: number
}

export interface ProfileState {
  displayName: string
  xp: number
  level: number
  streakCount: number
  lastActiveDate?: string
  streakFreezes: number
  /** Opt-in, default false: consenso esplicito a includere i propri dati
   * (skills/skillEvents, mai il contenuto delle skill material_chat) in
   * analisi aggregate multi-utente. La vista personale dei propri dati in
   * Impostazioni non dipende da questo -- vedi supabase/schema.sql. */
  researchConsent?: boolean
  researchConsentAt?: string
  /** Opt-in, default FALSE (unlike researchConsent's default-true -- these
   * are not the same consent). researchConsent covers aggregate analysis of
   * this account's own usage data, for the researcher's own thesis.
   * skillSharingConsent covers something categorically different: this
   * account's DISTILLED skill content being visible to and usable BY OTHER
   * ARIA USERS. No sharing pipeline reads this flag yet (deferred until
   * there's a second real user's promotion data to design the pipeline
   * against, see CLAUDE.md) -- it exists now so the switch is real and
   * reversible from day one, not bolted on retroactively once sharing
   * exists. Even when true, only 'procedure'-class domains are ever
   * eligible (see SkillDomain's comment in this file) -- this flag grants
   * permission, it is not by itself a claim that any of this account's
   * skills qualify. */
  skillSharingConsent?: boolean
  skillSharingConsentAt?: string
}

export const XP_PER_LEVEL = 120

/**
 * Skill library — port of the Cognitive RPG research's Book/Librarian architecture
 * (see cognitive_rpg/models.py, cognitive_rpg/librarian/librarian.py) into Aria.
 * Replaces the old single-purpose `Material.aiNotes` and `studyPlanPlaybook` fields:
 * a per-material note is just a Skill whose capabilityTags only ever match that one
 * material (`material:{id}`); the study-plan playbook is a Skill in the 'study_plan'
 * domain. Both migrate into this shape on first load — see useAppStore.ts.
 */
// 'pdf_edit' (2026-08-20) is the one domain here with no Gemini call behind
// it -- the PDF-to-Word-and-back conversion (WordEditFlow.tsx) is a local
// LibreOffice round-trip, nothing to retrieve skill context INTO. It's still
// logged through this same CALL/OUTCOME pipeline (always config 'B', no
// skillIds) purely so this interaction surface shows up in the same
// research dataset as every other domain, per explicit user request.
// 'material_knowledge' (2026-08-21): distinct from 'material_chat' on purpose
// -- material_chat is HOW to talk about materials in general (behavioral,
// generalized across materials, see skills.ts's _EXPERT_DISTILL_PROMPT which
// explicitly strips material-specific detail). material_knowledge is WHAT is
// true/useful about ONE specific material -- facts, clarifications, points
// of confusion -- the opposite framing. See skills.ts's distillMaterialKnowledge.
// 'chapters'/'flashcards'/'summary' (2026-08-21): the three remaining AI
// generation surfaces in the app (ChaptersPanel.tsx, Flashcards.tsx x2) that
// had NO skill-library loop at all until now -- zero retrieval, zero CALL/
// OUTCOME logging, zero learning. User's explicit instruction: every AI
// surface in Aria should run through this same loop, both for the product
// benefit and because the whole point of this app-as-research-instrument is
// comparable real-usage data across surfaces (see project memory). General/
// tag-overlap routing like 'material_chat'/'study_plan' (technique-level,
// e.g. "buoni titoli capitolo", not tied to one material) -- NOT the
// exact-materialId shape 'material_knowledge' uses, since these are about
// HOW to generate well, not WHAT one specific material says.
// Procedure vs content boundary (2026-08-24 design discussion, ahead of any
// cross-user skill sharing): a domain is 'content'-class if a skill in it
// can carry traces of ONE specific person's specific study material (topic,
// course, how a question was phrased) even after the domain's own
// distillation prompt tries to strip specifics -- that stripping is a
// quality filter for a concise local note, not a privacy guarantee, so it
// doesn't change the classification. 'procedure'-class domains are about HOW
// to do something well in general (task breakdown, chapter titling,
// flashcard/summary technique) -- would work for anyone studying anything.
// See skills.ts's domainClass(): only 'procedure'-class skills can ever
// become future sharing candidates; 'content'-class skills top out at
// PERSONAL_NOTE (see SkillStatus) and are never eligible, regardless of
// consent -- consent is necessary but not sufficient, per that discussion.
export type SkillDomain = 'chat' | 'task_breakdown' | 'material_chat' | 'study_plan' | 'pdf_edit' | 'material_knowledge' | 'chapters' | 'flashcards' | 'summary' | 'formula_example' | 'cheat_study'
// 'ARCHIVED' is used ONLY inside AppState.archivedSkills (useAppStore.ts),
// never inside the live `skills` array -- keeps it from ever being confused
// with 'REJECTED' (failed the evidence bar) in the DRAFT/VERIFIED/REJECTED
// review cycle reviewSkills() runs. A skill becomes ARCHIVED only when its
// source material is deleted (removeMaterial), moved out of `skills` into
// `archivedSkills` entirely rather than flagged in place -- routeSkills()
// only ever reads `skills`, so an archived skill is structurally unroutable,
// not just hidden by a status check someone has to remember to add. Mirrors
// cognitive_rpg/librarian/archive_duplicates.py: never deleted, moved out of
// the live/routable set, still resolvable for history, recoverable on
// purpose (see useAppStore.ts's restoreSkill) but never surfaces by default.
// 'PERSONAL_NOTE' (2026-08-24): the terminal status for a 'content'-class
// domain (see domainClass() in skills.ts) that clears the same evidence bar
// a 'procedure'-class skill needs to reach VERIFIED. Deliberately NOT called
// VERIFIED -- that word implies "this technique is broadly trustworthy",
// which a 👍/task-completion signal cannot support for a note distilled from
// one person's specific study material (a student can like an explanation
// that's subtly wrong; VERIFIED-for-content would misrepresent that as
// having been checked). "Used, not verified" -- content stays useful and
// keeps being retrieved locally exactly like VERIFIED does, it just never
// becomes a candidate for the cross-user sharing pipeline (still unbuilt,
// deferred until there's real multi-user promotion evidence to design
// against -- see CLAUDE.md's skill-sharing note). Reached via the SAME
// reviewSkills() bar as VERIFIED, just a different terminal label.
export type SkillStatus = 'DRAFT' | 'VERIFIED' | 'PERSONAL_NOTE' | 'REJECTED' | 'ARCHIVED'

export interface Skill {
  id: ID
  version: number
  title: string
  domain: SkillDomain
  capabilityTags: string[]
  content: string
  status: SkillStatus
  confidence: number
  uses: number
  successes: number
  generationMethod: 'manual' | 'distilled'
  derivedFrom?: string
  /** Set only for domain 'material_knowledge' (and, retroactively, the
   * legacy 'migrated_material_{id}' material_chat note) -- the exact id of
   * the Material this skill's knowledge came from. A first-class field
   * rather than encoding it only in capabilityTags (`material:{id}`)
   * because routing material_knowledge needs an EXACT match, not
   * routeSkills()'s fuzzy tag-overlap (which only requires overlap>=1 with
   * OTHER tags too -- a material_knowledge skill could otherwise get
   * retrieved for the wrong material by coincidence). See skills.ts's
   * routeMaterialKnowledge(). */
  materialId?: string
  /** Chapter/section granularity (2026-08-24), for 'material_knowledge'
   * skills distilled from a question asked while a specific chapter/section
   * was in view -- same first-class-field-not-tag rationale as `materialId`
   * (routeMaterialKnowledge needs exact match, not fuzzy overlap). `chapterId`
   * without `sectionId` means "about this chapter as a whole, not one
   * specific sub-section" -- mirrors Flashcard/MaterialSummary's existing
   * chapterId-required/sectionId-optional shape (same concept, ported here
   * rather than invented fresh). Both undefined means "material-wide", the
   * original (2026-08-21) material_knowledge shape -- still valid, e.g. for
   * link/note materials with no chapter concept at all. */
  chapterId?: string
  sectionId?: string
  /** Set when this skill was archived via a whole-Subject deletion (see
   * Material.areaOfInterest -- same label, the subject's name at deletion
   * time). Independent of materialId: materialId ties a skill to ONE
   * material's identity; areaOfInterest survives even that material being
   * archived too, so a skill can be recognized and restored (status back to
   * DRAFT -- re-earns trust through reviewSkills() again, never reinstated
   * as VERIFIED on the old evidence) when a NEW Subject with a related name
   * is created later, per explicit user design (2026-08-21): "riconosciute,
   * verificate e poi utilizzate in quel contesto." */
  areaOfInterest?: string
  createdAt: string
  updatedAt: string
}

/**
 * Real-usage metrics log — port of cognitive_rpg/experiment/events.py's JSONL event
 * log. `config` mirrors the research's F/B configs: 'F' when the Librarian was
 * active and injected skill content into this call, 'B' when it ran bare.
 */
export type SkillEventType = 'CALL' | 'OUTCOME'
export type SkillOutcome = 'positive' | 'negative'

export interface SkillEvent {
  id: ID
  ts: string
  domain: SkillDomain
  config: 'F' | 'B'
  eventType: SkillEventType
  skillIds: string[]
  /** Ties an OUTCOME event back to the CALL event it judges (the CALL's own id). */
  ref: string
  outcome?: SkillOutcome
  /** Exact Gemini model string used for this CALL (see gemini.ts's GEMINI_MODEL) --
   * logged so a silent model change can be spotted later by diffing this field
   * across events, instead of only suspecting it after the fact. Absent on
   * OUTCOME events (they don't make their own model call). */
  model?: string
}
