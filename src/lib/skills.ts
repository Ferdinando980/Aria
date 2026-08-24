import { getGeminiKey, generateWithFallback } from './gemini'
import { uid, nowIso } from './utils'
import type { Skill, SkillDomain, SkillEvent } from './types'

/**
 * Skill library — port of the Cognitive RPG research architecture into Aria.
 * See cognitive_rpg/models.py (Book), cognitive_rpg/librarian/librarian.py
 * (route()), cognitive_rpg/librarian/skill_generator.py + optimizer.py
 * (candidate generation + promotion gate) for the originals.
 *
 * One deliberate adaptation, spelled out because it changes what "verified"
 * means here: the Python originals gate every promotion on real pytest
 * verification (an objective correctness oracle). Aria's domain has no such
 * oracle — a task breakdown or a study plan doesn't have a single "correct"
 * answer to run a test against. So verification here means accumulated
 * REAL BEHAVIORAL OUTCOME evidence instead (task completed, plan followed,
 * thumbs up) — see skillEvents.ts for where that evidence is recorded, and
 * reviewDraftSkills() below for the promotion gate built on top of it. The
 * PRINCIPLE ports exactly (never promote without real evidence, never
 * silently overwrite, log every decision) — the oracle does not, because it
 * can't.
 */

// ---- retrieval: deterministic tag-overlap, no model call --------------
// Direct port of librarian.route(): at this library's scale (tens of
// skills, not thousands), scoring by tag overlap is enough — no embeddings,
// no extra API call, so retrieval itself never shows up as a hidden cost.

// ---- two-stage load: metadata for ranking, content only for the selected
// few (2026-08-24, real user request, modeled on Claude Skills' own
// metadata-then-body pattern). Every field routeSkills()/routeMaterialKnowledge()
// actually rank or filter on (domain, capabilityTags, status, confidence,
// uses) already lived outside `content` -- this makes that boundary
// explicit and enforced by the type system instead of just true by
// convention. At today's real corpus size (tens of skills per user,
// already narrowed to 1-2 before the prompt -- see CLAUDE.md) this doesn't
// cut any real memory/network cost yet, since every skill already lives
// fully in-memory in the Zustand store; it establishes the SEPARATION now,
// cheaply, so a real lazy-fetch (e.g. a split skills_meta/skills_content
// Supabase table, once a subject's skill count genuinely grows past
// ~20-30) can be dropped into resolveSkillContent() alone, without
// touching the ranking logic or any of routeSkills()'s callers.
export type SkillMeta = Omit<Skill, 'content'>

function toMeta(s: Skill): SkillMeta {
  const { content: _content, ...meta } = s
  return meta
}

/** Stage two: given the (already narrow, post-selection) metadata chosen by
 * a router below, pulls each one's full content back from the real
 * in-memory skill list. Today this is a plain Map lookup (no lazy fetch
 * exists yet, see the block comment above) -- swapping it for a real one
 * later touches this one function, not every routeSkills()/
 * routeMaterialKnowledge() call site. */
function resolveSkillContent(metas: SkillMeta[], allSkills: Skill[]): Skill[] {
  const byId = new Map(allSkills.map((s) => [s.id, s]))
  return metas.map((m) => byId.get(m.id)).filter((s): s is Skill => !!s)
}

export function routeSkills(
  skills: Skill[],
  domain: SkillDomain,
  tags: string[],
  maxSkills = 2,
  minOverlap = 1,
  events: SkillEvent[] = [], // already in the store, no new cost -- see domainsWithoutMeasuredBenefit
): Skill[] {
  if (events.length > 0 && domainsWithoutMeasuredBenefit(events).some((b) => b.domain === domain)) return []

  const tagSet = new Set(tags)
  const scored = skills
    .map(toMeta)
    .filter((s) => s.domain === domain && s.status !== 'REJECTED')
    .map((s) => ({ skill: s, overlap: s.capabilityTags.filter((t) => tagSet.has(t)).length }))
    .filter((x) => x.overlap >= minOverlap)
  scored.sort((a, b) => b.overlap - a.overlap)
  const selected = scored.slice(0, maxSkills).map((x) => x.skill)
  return resolveSkillContent(selected, skills)
}

/**
 * material_knowledge retrieval (2026-08-21): deliberately NOT routeSkills().
 * routeSkills() ranks by fuzzy tagSet overlap (overlap>=1 against ANY of the
 * task's tags) -- fine for "find something relevant", wrong for "find what
 * this exact material taught us", where a coincidental tag match on other
 * tags could surface another material's fact. This filters on the exact
 * `materialId` field instead (see types.ts's Skill.materialId comment), then
 * ranks the (usually few) matches by trust -- promoted (VERIFIED or, since
 * material_knowledge is 'content'-class, realistically always PERSONAL_NOTE
 * -- see domainClass()) before DRAFT, REJECTED excluded (matches
 * routeSkills()'s own exclusion), highest confidence/uses first within each
 * tier -- since there's no relevance question left to answer once the
 * material match is exact.
 */
const PROMOTED_STATUSES = new Set(['VERIFIED', 'PERSONAL_NOTE'])

// Specificity tier relative to the CURRENT question's context (2026-08-24,
// chapter/section retrieval) -- lower is more specific, null means "not
// relevant here, exclude". A skill scoped to one section/chapter must never
// surface for a DIFFERENT section/chapter of the same material (that would
// reintroduce exactly the cross-contamination routeMaterialKnowledge was
// built to avoid, just one level down) -- only material-wide skills
// (chapterId AND sectionId both unset) are always relevant regardless of
// where in the material the question falls.
function specificityTier(s: Pick<Skill, 'sectionId' | 'chapterId'>, chapterId?: string, sectionId?: string): number | null {
  if (s.sectionId) return sectionId && s.sectionId === sectionId ? 0 : null
  if (s.chapterId) return chapterId && s.chapterId === chapterId ? 1 : null
  return 2
}

/** `chapterId`/`sectionId` (2026-08-24) narrow retrieval to what's actually
 * relevant to the part of the material being asked about, instead of every
 * fact ever learned about the whole material -- see the scoping note in
 * CLAUDE.md. Omit both for the original 2026-08-21 material-wide behavior
 * (still correct for link/note materials, which have no chapter concept). */
export function routeMaterialKnowledge(skills: Skill[], materialId: string, options: { chapterId?: string; sectionId?: string; maxSkills?: number } = {}): Skill[] {
  const { chapterId, sectionId, maxSkills = 3 } = options
  const matches = skills
    .map(toMeta)
    .filter((s) => s.domain === 'material_knowledge' && s.materialId === materialId && s.status !== 'REJECTED')
    .map((s) => ({ skill: s, tier: specificityTier(s, chapterId, sectionId) }))
    .filter((x): x is { skill: SkillMeta; tier: number } => x.tier !== null)
  matches.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    const aPromoted = PROMOTED_STATUSES.has(a.skill.status)
    const bPromoted = PROMOTED_STATUSES.has(b.skill.status)
    if (aPromoted !== bPromoted) return aPromoted ? -1 : 1
    if (b.skill.confidence !== a.skill.confidence) return b.skill.confidence - a.skill.confidence
    return b.skill.uses - a.skill.uses
  })
  const selected = matches.slice(0, maxSkills).map((x) => x.skill)
  return resolveSkillContent(selected, skills)
}

export function skillsAsPromptContext(skills: Skill[]): string {
  if (skills.length === 0) return ''
  return skills.map((s) => `### ${s.title}\n${s.content.trim()}`).join('\n\n')
}

/** Simple, deterministic keyword tags from free text — no embeddings, matches
 * the Python design's "tag overlap is enough at this scale" reasoning. Strips
 * common Italian stopwords, keeps words >= 4 chars, lowercased. */
const STOPWORDS = new Set([
  'questo', 'questa', 'quello', 'quella', 'della', 'dello', 'delle', 'degli',
  'sulla', 'sullo', 'sulle', 'sugli', 'nella', 'nello', 'nelle', 'negli',
  'come', 'cosa', 'devo', 'posso', 'vorrei', 'sono', 'hai', 'aiuto', 'aiutami',
  'perché', 'quindi', 'anche', 'ancora', 'sempre', 'molto', 'poco', 'tutto',
])

export function tagsFromText(...texts: (string | undefined)[]): string[] {
  const words = texts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents so "perché"/"perche" tag the same
    .match(/[a-z0-9]{4,}/g)
  if (!words) return []
  const unique = Array.from(new Set(words)).filter((w) => !STOPWORDS.has(w))
  return unique.slice(0, 8)
}

// ---- seed skills: authored, VERIFIED, generationMethod 'manual' --------
// A few, deliberately not many — Aria's system prompts (gemini.ts) already
// carry most generic ADHD-coaching guidance. These seed the domains where
// "learned/personalizable over time" adds something the always-on prompt
// can't: a starting point the automatic pipeline below can refine per-user.

export function seedSkills(): Skill[] {
  const now = nowIso()
  const base = { status: 'VERIFIED' as const, confidence: 1, uses: 0, successes: 0, generationMethod: 'manual' as const, version: 1, createdAt: now, updatedAt: now }
  return [
    {
      id: 'seed_task_breakdown_first_step',
      title: 'Primo passo sotto i 2 minuti',
      domain: 'task_breakdown',
      capabilityTags: ['spezza', 'passi', 'compito', 'inizio', 'blocco'],
      content:
        'Il primissimo passo di qualunque scomposizione deve essere completabile in meno di 2 minuti e non richiedere alcuna decisione — solo azione meccanica (es. "apri il documento", non "scrivi l\'introduzione"). Se un passo contiene la congiunzione "e" (fai X e Y), è quasi sempre due passi mascherati da uno: dividilo.',
      ...base,
    },
    {
      id: 'seed_study_plan_chapter_density',
      title: 'Densità dei capitoli in base alla lunghezza reale',
      domain: 'study_plan',
      capabilityTags: ['piano', 'capitolo', 'studio', 'materiale'],
      content:
        'Il numero di passi per capitolo segue la densità reale del contenuto, non uno schema fisso: un capitolo breve o già familiare regge 2-3 passi, uno lungo o tecnico può arrivare a 5. Non forzare tutti i capitoli alla stessa lunghezza solo per uniformità.',
      ...base,
    },
    {
      id: 'seed_material_chat_honesty',
      title: "Onestà su cosa si può leggere davvero",
      domain: 'material_chat',
      capabilityTags: ['materiale', 'link', 'file', 'contenuto'],
      content:
        "Quando il contenuto reale di un link o file non è disponibile, dichiaralo in una riga breve prima di rispondere in base a quello che l'utente stesso racconta — mai fingere di aver letto qualcosa che non è stato fornito.",
      ...base,
    },
  ]
}

// ---- automatic learning loop: candidate distillation + promotion gate --

const _EXPERT_DISTILL_PROMPT = `Distilli consigli riusabili per un'assistente di studio "Aria", per una persona con ADHD, a partire da scambi reali andati bene.
Ti passo alcuni scambi recenti (richiesta dell'utente + risposta di Aria) che hanno avuto un esito positivo (task completato, piano seguito, o feedback positivo esplicito).
Scrivi UN consiglio generale, riusabile su richieste future SIMILI — non specifico al contenuto di questo singolo scambio (niente nomi propri, niente materie specifiche).
Rispondi SOLO con il testo del consiglio (2-4 righe), nessuna introduzione, nessun markdown.`

export interface DistillInput {
  domain: SkillDomain
  exchanges: { userText: string; ariaText: string }[]
}

// Mirrors a real bug found and fixed the same day on the Python research
// side (librarian/optimizer.py): a "compress this" prompt was accepted as
// successful purely on accuracy, with no check that the result actually
// stayed short -- 4 of 10 historical "accepted" compressions had silently
// GROWN instead (up to +196 words). Aria's distillation has no "original"
// to compare against (it creates new content, not a compression), so the
// equivalent guard here is an absolute cap: a distilled skill that ignores
// the "2-4 righe" instruction in _EXPERT_DISTILL_PROMPT and comes back long
// is discarded rather than silently added to every future prompt's
// overhead forever.
const MAX_DISTILLED_WORDS = 60

// Deliberately the OPPOSITE framing from _EXPERT_DISTILL_PROMPT above: that
// prompt explicitly strips material-specific detail ("niente materie
// specifiche") because it's building a generalizable coaching tip. This one
// wants exactly what that one throws away -- a fact tied to ONE material --
// so it can't reuse the same prompt/function (see distillMaterialKnowledge).
const _MATERIAL_KNOWLEDGE_DISTILL_PROMPT = `Distilli conoscenza specifica su UN materiale di studio, per una persona con ADHD, a partire da domande e risposte reali su quel materiale.
Ti passo il titolo del materiale e alcuni scambi recenti (domanda dell'utente + risposta di Aria) andati bene.
Scrivi UN fatto, chiarimento o collegamento specifico e riusabile su QUESTO materiale -- non un consiglio generico di metodo di studio, non qualcosa che varrebbe per qualunque materiale. Dev'essere qualcosa che, se dimenticato, servirebbe rileggerlo per riottenerlo (una definizione precisa, un collegamento tra due concetti del materiale, un punto su cui l'utente si è confuso e la chiarificazione corretta).
Rispondi SOLO con il testo del fatto (1-3 righe), nessuna introduzione, nessun markdown.`

export interface DistillMaterialKnowledgeInput {
  materialId: string
  materialTitle: string
  exchanges: { userText: string; ariaText: string }[]
  /** Chapter/section the exchanges happened in, if known (2026-08-24) --
   * stamped onto the resulting skill so it only ever surfaces again for the
   * same chapter/section, see routeMaterialKnowledge()'s specificityTier(). */
  chapterId?: string
  sectionId?: string
}

/** Sibling of distillCandidate() for domain 'material_knowledge' -- same
 * MAX_DISTILLED_WORDS safety cap (same rationale: a distilled note that
 * ignores the "1-3 righe" instruction shouldn't silently weigh on every
 * future chat about this material forever), same DRAFT-first shape so it
 * goes through reviewSkills()'s normal evidence gate -- the one real
 * difference is materialId, set here rather than left to a tag. */
export async function distillMaterialKnowledge({ materialId, materialTitle, exchanges, chapterId, sectionId }: DistillMaterialKnowledgeInput): Promise<Skill | null> {
  const key = getGeminiKey()
  if (!key || exchanges.length === 0) return null
  const prompt = `Materiale: ${materialTitle}\n\n${exchanges.map((e, i) => `Scambio ${i + 1}:\nUtente: ${e.userText}\nAria: ${e.ariaText}`).join('\n\n')}`
  const result = await generateWithFallback(key, { systemInstruction: _MATERIAL_KNOWLEDGE_DISTILL_PROMPT }, (model) => model.generateContent(prompt))
  const content = result.response.text().trim()
  if (!content) return null
  if (content.split(/\s+/).length > MAX_DISTILLED_WORDS) return null

  const now = nowIso()
  return {
    id: uid(),
    version: 1,
    title: content.slice(0, 60),
    domain: 'material_knowledge',
    capabilityTags: [`material:${materialId}`, ...tagsFromText(materialTitle)],
    materialId,
    chapterId,
    sectionId,
    content,
    status: 'DRAFT',
    confidence: 0,
    uses: 0,
    successes: 0,
    generationMethod: 'distilled',
    createdAt: now,
    updatedAt: now,
  }
}

export async function distillCandidate({ domain, exchanges }: DistillInput): Promise<Skill | null> {
  const key = getGeminiKey()
  if (!key || exchanges.length === 0) return null
  const prompt = exchanges.map((e, i) => `Scambio ${i + 1}:\nUtente: ${e.userText}\nAria: ${e.ariaText}`).join('\n\n')
  const result = await generateWithFallback(key, { systemInstruction: _EXPERT_DISTILL_PROMPT }, (model) => model.generateContent(prompt))
  const content = result.response.text().trim()
  if (!content) return null
  if (content.split(/\s+/).length > MAX_DISTILLED_WORDS) return null

  const now = nowIso()
  const tags = tagsFromText(...exchanges.map((e) => e.userText))
  return {
    id: uid(),
    version: 1,
    title: content.slice(0, 60),
    domain,
    capabilityTags: tags,
    content,
    status: 'DRAFT',
    confidence: 0,
    uses: 0,
    successes: 0,
    generationMethod: 'distilled',
    createdAt: now,
    updatedAt: now,
  }
}

// Promotion is intentionally NOT a one-shot gate. The Python side had a real
// oracle (pytest) and still found skills that "passed" for the wrong reason
// (mutable_default_argument passing by execution-order accident,
// temperature_reached passing on a structurally wrong solution,
// shipment_weight_match "validated" against a never-independently-checked
// formula). Here the signal is a weaker behavioral proxy (👍/👎, task
// completion, ≥50% plan steps before regenerating) — a 3-use/2-success
// streak can promote a skill that was liked for reasons unrelated to its
// content (tone, timing, luck on one task). So: (a) review runs on VERIFIED
// skills too, on a rolling recent window, not just once at promotion — a
// skill whose real success rate later drops gets DEMOTED back to DRAFT, not
// left VERIFIED forever on an early lucky sample; (b) a distilled skill
// whose content states a concrete number/threshold — the exact shape that
// caused every real bug this session's Python research found — needs more
// evidence than a purely structural one before being trusted.

const REVIEW_WINDOW = 10
// 6, not 3 (2026-08-19, prompted by external review): at uses=3, a
// success rate can only take the values 0/33/67/100% -- one different
// outcome swings it by 33 points, so MIN_LIFT_OVER_BASELINE's 15-point
// margin below wasn't a real statistical threshold at that sample size,
// just an eyeballed "clearly better" cutoff dressed up as one. At uses=6
// the step size halves (~17 points), enough to make the margin below mean
// something. Costs nothing extra -- same telemetry already collected,
// just more patience before a promotion is even attempted.
const PROMOTE_MIN_USES = 6
const PROMOTE_MIN_RATIO = 0.7
const DEMOTE_MIN_RATIO = 0.5 // lower than the promote bar on purpose (hysteresis) -- otherwise a skill hovering near 0.7 flaps DRAFT<->VERIFIED every other outcome
const NUMERIC_PROMOTE_MIN_USES = 6
const NUMERIC_PROMOTE_MIN_RATIO = 0.85

/** Does this skill's text state a concrete number a reader could copy
 * out of context (a threshold, a duration, a count)? Deliberately broad
 * (structural skills rarely need a bare digit) -- false positives just mean
 * a slightly higher bar, which is the safe direction to be wrong in. */
export function hasConcreteValue(content: string): boolean {
  return /\d/.test(content)
}

function requiredBar(skill: Skill): { minUses: number; minRatio: number } {
  if (skill.generationMethod === 'distilled' && hasConcreteValue(skill.content)) {
    return { minUses: NUMERIC_PROMOTE_MIN_USES, minRatio: NUMERIC_PROMOTE_MIN_RATIO }
  }
  return { minUses: PROMOTE_MIN_USES, minRatio: PROMOTE_MIN_RATIO }
}

// The gap flagged explicitly (2026-08-19, prompted by external review) as
// the most fragile point of this whole design: an absolute bar
// (uses>=3, ratio>=0.7) cannot tell "this skill caused the good outcome"
// from "this domain just goes well anyway, skill or not" -- exactly the
// correlation-vs-causation question the Python research spent a full day
// answering for one skill with an ablation (manipulate the suspected cause
// directly, check the effect follows). That full investigation isn't
// affordable per-skill here -- but its CHEAPEST real component is: compare
// against an unaided baseline. Aria already logs that baseline for free,
// every time the Librarian is off or finds nothing (config 'B') -- so this
// costs zero extra calls, unlike the Python side's dedicated ablation
// calls. A DRAFT skill is only promoted if its own recent success rate
// beats the domain's own recent 'B' (no-skill) rate by a real margin, not
// just an absolute threshold both could clear by luck.
const MIN_LIFT_OVER_BASELINE = 0.15
const MIN_BASELINE_OBSERVATIONS = 3

/** Recent config='B' OUTCOME success rate for a domain -- the "no skill
 * involved at all" control condition, computed from data already logged.
 * Returns null when there isn't enough baseline evidence yet to compare
 * against (too few B-outcomes in this domain) -- callers must decide how
 * to treat that, not silently assume a 0% or 100% baseline. */
function baselineRatio(domain: SkillDomain, events: SkillEvent[]): number | null {
  const baseline = events.filter((e) => e.domain === domain && e.config === 'B' && e.eventType === 'OUTCOME').slice(-REVIEW_WINDOW)
  if (baseline.length < MIN_BASELINE_OBSERVATIONS) return null
  return baseline.filter((e) => e.outcome === 'positive').length / baseline.length
}

/** Procedure vs content classification (2026-08-24) -- see the SkillDomain
 * doc comment in types.ts for the full reasoning. Deliberately a static
 * lookup, not a per-skill heuristic run over `content`: the boundary needs
 * to be predictable and auditable (a domain either can or cannot ever
 * promote to a shareable status), not something a content-sniffing function
 * could get wrong on one skill and silently misclassify. 'chat' is the one
 * judgment call not explicitly named in that discussion (only task_breakdown
 * and material_chat were) -- defaulted to 'content' out of caution, since
 * free-form chat has no material/subject scoping to rule out topic-specific
 * content the way task_breakdown's generic prompts do. */
export function domainClass(domain: SkillDomain): 'procedure' | 'content' {
  switch (domain) {
    case 'material_chat':
    case 'material_knowledge':
    case 'study_plan': // always routed with a material/subject tag -- see MaterialPlanPanel/StudyPlanPanel
    case 'chat': // no material scoping to rule out topic-specific content; defaulted conservatively
      return 'content'
    case 'task_breakdown':
    case 'chapters':
    case 'flashcards':
    case 'summary':
    case 'pdf_edit': // never actually distills a skill (no retrievable content), classification is moot
      return 'procedure'
    // 2026-08-24, explicit user request: "la tecnica non dipende dal contenuto
    // specifico di una materia, è candidata futura alla condivisione" -- a
    // worked numeric example TECHNIQUE (how to build/verify one) generalizes
    // across subjects the same way task_breakdown does; the specific formula
    // it was generated for lives in the example's own content, not in what
    // makes the skill shareable.
    case 'formula_example':
      return 'procedure'
  }
}

/** Port of optimizer.py's accept/reject gate, on behavioral evidence instead
 * of pytest -- see the note above for why this differs from a one-shot
 * pytest-style gate. Pure function, call after recording any OUTCOME event.
 * `events` should be the full skillEvents log (OUTCOME events are filtered
 * here by skillId, most recent REVIEW_WINDOW per skill). */
export function reviewSkills(skills: Skill[], events: SkillEvent[]): Skill[] {
  const outcomesBySkill = new Map<string, SkillEvent[]>()
  for (const e of events) {
    if (e.eventType !== 'OUTCOME') continue
    for (const skillId of e.skillIds) {
      const list = outcomesBySkill.get(skillId) ?? []
      list.push(e)
      outcomesBySkill.set(skillId, list)
    }
  }

  return skills.map((s) => {
    if (s.status === 'REJECTED') return s // terminal -- no automatic resurrection, matches optimizer.py

    const recent = (outcomesBySkill.get(s.id) ?? []).slice(-REVIEW_WINDOW)
    const { minUses, minRatio } = requiredBar(s)
    if (recent.length < minUses) return s

    const successes = recent.filter((e) => e.outcome === 'positive').length
    const ratio = successes / recent.length

    if (s.status === 'DRAFT') {
      if (ratio < minRatio) return { ...s, status: 'REJECTED' as const, updatedAt: nowIso() } // unchanged: doesn't even clear the absolute bar

      // Clears the absolute bar -- but is that the skill, or just a domain
      // that goes well regardless? Compare against the unaided baseline.
      const baseline = baselineRatio(s.domain, events)
      // No baseline evidence yet: cannot rule out "this domain just does
      // well anyway" -- hold at DRAFT rather than promote on faith. This
      // means a skill in a domain where the Librarian is always on (no B
      // calls ever logged) can never promote automatically -- by design:
      // the control condition has to actually exist to compare against.
      if (baseline === null) return s
      if (ratio - baseline >= MIN_LIFT_OVER_BASELINE) {
        // Same bar, different terminal label -- content-class skills never
        // reach VERIFIED (see domainClass() and SkillStatus's comment).
        const promoted = domainClass(s.domain) === 'content' ? ('PERSONAL_NOTE' as const) : ('VERIFIED' as const)
        return { ...s, status: promoted, confidence: ratio, updatedAt: nowIso() }
      }
      // Clears the absolute bar but not distinguishable from baseline luck
      // yet -- the same ambiguity currency's 0.01 left unresolved for
      // months in the Python research (it was scale-correct on every
      // no-hint task tried, so nothing ever forced the comparison). Give it
      // one extra window of evidence before rejecting outright, rather than
      // deciding off the same small sample that just failed the lift check.
      if (recent.length >= minUses * 2) return { ...s, status: 'REJECTED' as const, updatedAt: nowIso() }
      return s
    }
    // s.status is 'VERIFIED' or 'PERSONAL_NOTE': re-checked on the same
    // rolling window every time, not just at the moment it was first
    // promoted. Both demote the same way -- losing real usefulness doesn't
    // depend on which terminal label a skill was promoted to.
    if (ratio < DEMOTE_MIN_RATIO) return { ...s, status: 'DRAFT' as const, confidence: ratio, updatedAt: nowIso() }
    return { ...s, confidence: ratio, updatedAt: nowIso() }
  })
}

/** How many positive CALL events in a domain trigger an attempt at
 * distilling a new candidate skill — matches skill_generator.py's "gap/
 * evidence driven, not generate for everything" stance: only fires when
 * there's a run of real positive signal to learn from. */
export const DISTILL_TRIGGER_EVERY = 5

// ---- retrieval waste analysis: Aria's twin of the Python research's
// retrieval_waste_analysis() (cognitive_rpg/experiment/metrics.py),
// designed now rather than after months of unused real data (2026-08-20,
// prompted by external review). A real structural difference from the
// Python original must stay explicit: that one pairs F and B on the SAME
// task_id within the same experiment run (a true matched counterfactual --
// "would THIS exact quest have passed without the skill?"). Aria has no
// such pairing -- a real user message is only ever answered once, under
// whichever config (F or B) was active at that moment, never both. So this
// is a between-groups comparison (F's recent success rate vs B's, per
// domain), not a matched counterfactual -- weaker evidence than the Python
// version, closer to an ongoing A/B test than to a controlled ablation.
// Good enough to flag "this domain's Librarian isn't earning its overhead"
// once real volume exists; not strong enough to prove a single skill
// caused a single outcome the way the Python side's paired design can.

export interface DomainWasteReport {
  domain: SkillDomain
  fCalls: number
  fPositiveRate: number | null
  bCalls: number
  bPositiveRate: number | null
  /** fPositiveRate - bPositiveRate. Null whenever either side lacks enough
   * outcome data to compare -- never silently treated as zero. */
  lift: number | null
}

const DOMAINS: SkillDomain[] = ['chat', 'task_breakdown', 'material_chat', 'study_plan', 'pdf_edit', 'material_knowledge', 'chapters', 'flashcards', 'summary', 'formula_example']

export function retrievalWasteAnalysis(events: SkillEvent[]): DomainWasteReport[] {
  return DOMAINS.map((domain) => {
    const fOutcomes = events.filter((e) => e.domain === domain && e.config === 'F' && e.eventType === 'OUTCOME')
    const bOutcomes = events.filter((e) => e.domain === domain && e.config === 'B' && e.eventType === 'OUTCOME')
    const fRate = fOutcomes.length > 0 ? fOutcomes.filter((e) => e.outcome === 'positive').length / fOutcomes.length : null
    const bRate = bOutcomes.length > 0 ? bOutcomes.filter((e) => e.outcome === 'positive').length / bOutcomes.length : null
    return {
      domain,
      fCalls: fOutcomes.length,
      fPositiveRate: fRate,
      bCalls: bOutcomes.length,
      bPositiveRate: bRate,
      lift: fRate !== null && bRate !== null ? fRate - bRate : null,
    }
  })
}

// ---- domain-level auto-block: extends retrievalWasteAnalysis() with a
// gate routeSkills() consults BEFORE the F/B comparison exists, not after
// (2026-08-20, prompted by external review). One deliberate departure from
// the reviewer's original proposal, made because of how this codebase
// already works: every routeSkills() caller derives config purely from
// `retrieved.length > 0 ? 'F' : 'B'` (see Assistant.tsx and the material
// panels), so `if (blocked) return []` doesn't just suppress injection --
// it also means every future call in that domain logs 'B' forever, so no
// new F evidence can ever be produced again once blocked. An unwindowed,
// all-time lift stat would only reopen when the *global*, cross-domain
// SKILL_EVENTS_CAP (1000, shared by every domain/config) happens to evict
// the frozen F events -- slow, and paced by whichever domain is busiest,
// not by this one. Windowing per-domain instead (last DOMAIN_WINDOW events
// of THAT domain, any config) makes the reopen bounded and predictable:
// once blocked, only B events keep entering the window, so the frozen F
// evidence ages out of it after roughly DOMAIN_WINDOW more interactions in
// that domain, and the domain gets one fresh trial before a verdict is
// possible again. This is what actually delivers "no manual reminder
// needed" -- honestly, as periodic re-trial, not as detection of a real
// fix (that distinction matters -- don't oversell it in UI copy either).
//
// Margin also raised from the reviewer's proposed 0.05 to MIN_LIFT_OVER_
// BASELINE (0.15): at MIN_SAMPLE_PER_GROUP=15 the standard error of a
// two-proportion difference is ~18pt (p=0.5), so a 5pt margin sits inside
// the noise -- a single flipped outcome could flip the verdict. Blocking a
// whole domain (every skill in it, present and future) is a bigger, harder
// -to-reverse call than one skill staying DRAFT; it should not use a
// LOOSER bar than promotion's own 0.15, which was itself sized to survive
// this same noise at a comparable sample size.
const DOMAIN_WINDOW = 60
const MIN_SAMPLE_PER_GROUP = 15
const NO_BENEFIT_MARGIN = MIN_LIFT_OVER_BASELINE

export interface DomainBlock {
  domain: SkillDomain
  /** Human-readable reason, shown as-is in Settings -- a blocked domain
   * must stay visible with why, never just silently disappear from the list. */
  reason: string
}

/** Domains whose recent (last DOMAIN_WINDOW events) F vs B comparison shows
 * F clearly not-better than B, with enough samples in both groups to say
 * so. Pure function of the event log -- cheap enough to recompute on every
 * routeSkills() call at this app's real scale (a handful of domains, a
 * capped 1000-event log), so there's no separate cache to invalidate and
 * no staleness to reason about. */
export function domainsWithoutMeasuredBenefit(events: SkillEvent[]): DomainBlock[] {
  return DOMAINS.flatMap((domain) => {
    const windowed = events.filter((e) => e.domain === domain).slice(-DOMAIN_WINDOW)
    const report = retrievalWasteAnalysis(windowed).find((r) => r.domain === domain)
    if (!report || report.fCalls < MIN_SAMPLE_PER_GROUP || report.bCalls < MIN_SAMPLE_PER_GROUP) return []
    if (report.lift === null || report.lift > -NO_BENEFIT_MARGIN) return []
    const fPct = report.fPositiveRate !== null ? Math.round(report.fPositiveRate * 100) : null
    const bPct = report.bPositiveRate !== null ? Math.round(report.bPositiveRate * 100) : null
    return [
      {
        domain,
        reason: `retrieval disattivato: nessun beneficio misurato sulle ultime ${report.fCalls + report.bCalls} interazioni (F ${fPct}% vs B ${bPct}%)`,
      },
    ]
  })
}

export function shouldDistill(events: SkillEvent[], domain: SkillDomain): boolean {
  const positiveCalls = events.filter((e) => e.domain === domain && e.eventType === 'OUTCOME' && e.outcome === 'positive').length
  return positiveCalls > 0 && positiveCalls % DISTILL_TRIGGER_EVERY === 0
}

export interface ExchangeMessage {
  role: 'user' | 'model'
  text: string
  skillEventRef?: string
}

/** Ties it together: checks the trigger, reconstructs the last few positive
 * exchanges (the model message whose CALL event has a positive OUTCOME,
 * paired with the user message right before it) from a flat message list,
 * and distills+returns a new candidate skill if there's enough to work
 * with. Callers pass the result straight to the store's addSkill — a no-op
 * (returns null) most of the time, by design (see DISTILL_TRIGGER_EVERY). */
export async function maybeDistillFromExchanges(domain: SkillDomain, messages: ExchangeMessage[], events: SkillEvent[]): Promise<Skill | null> {
  if (!shouldDistill(events, domain)) return null

  const positiveCallIds = new Set(events.filter((e) => e.domain === domain && e.eventType === 'OUTCOME' && e.outcome === 'positive').map((e) => e.ref))
  const exchanges: DistillInput['exchanges'] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'model' || !m.skillEventRef || !positiveCallIds.has(m.skillEventRef)) continue
    const prevUser = [...messages.slice(0, i)].reverse().find((x) => x.role === 'user')
    if (prevUser) exchanges.push({ userText: prevUser.text, ariaText: m.text })
  }
  return distillCandidate({ domain, exchanges: exchanges.slice(-DISTILL_TRIGGER_EVERY) })
}

/** material_knowledge sibling of maybeDistillFromExchanges(). Trigger is
 * still shouldDistill(events, 'material_knowledge') -- domain-wide, like
 * every other domain's trigger, NOT scoped per materialId. Deliberately not
 * scoped: `messages` is already this one material's own conversation (the
 * caller's local chat state resets per material), so the candidate
 * exchanges extracted below are correctly material-specific regardless: a
 * shared trigger counter across materials can only cost a wasted
 * no-candidate check (exchanges.length === 0 short-circuits distillCandidate
 * for a material with no positive outcomes yet), never leak the wrong
 * material's content into a candidate. Same looseness this codebase already
 * accepts for e.g. study_plan's trigger not being scoped per subject. */
export async function maybeDistillMaterialKnowledge(
  materialId: string,
  materialTitle: string,
  messages: ExchangeMessage[],
  events: SkillEvent[],
  location: { chapterId?: string; sectionId?: string } = {},
): Promise<Skill | null> {
  if (!shouldDistill(events, 'material_knowledge')) return null

  const positiveCallIds = new Set(events.filter((e) => e.domain === 'material_knowledge' && e.eventType === 'OUTCOME' && e.outcome === 'positive').map((e) => e.ref))
  const exchanges: DistillMaterialKnowledgeInput['exchanges'] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'model' || !m.skillEventRef || !positiveCallIds.has(m.skillEventRef)) continue
    const prevUser = [...messages.slice(0, i)].reverse().find((x) => x.role === 'user')
    if (prevUser) exchanges.push({ userText: prevUser.text, ariaText: m.text })
  }
  return distillMaterialKnowledge({ materialId, materialTitle, exchanges: exchanges.slice(-DISTILL_TRIGGER_EVERY), ...location })
}

// ---- archival on material deletion (2026-08-21) -- mirrors cognitive_rpg/
// librarian/archive_duplicates.py's rule: never delete, move out of the
// live/routable set into a separate collection, keep it resolvable/
// recoverable but not surfaced by default. Pure function -- the caller
// (useAppStore.ts's removeMaterial) owns actually updating state + sync.

/** Which skills belong to a material about to be deleted -- both the new
 * material_knowledge binding (materialId field, exact) and the legacy
 * material_chat memory note (migrated_material_{id}, id/tag-based, predates
 * the materialId field) -- same orphaned-skill problem, same fix, so swept
 * up together here rather than left as a second untouched loose end. */
export function skillsForMaterial(skills: Skill[], materialId: string): Skill[] {
  const legacyTag = `material:${materialId}`
  const legacyId = `migrated_material_${materialId}`
  return skills.filter((s) => s.materialId === materialId || s.id === legacyId || s.capabilityTags.includes(legacyTag))
}

/** Returns the split -- caller sets both halves of state from this, doesn't
 * mutate its inputs. Archived entries get status 'ARCHIVED' (see types.ts's
 * SkillStatus comment for why this is safe: that value is never seen inside
 * the live `skills` array, only inside `archivedSkills`, so it can't be
 * confused with a REJECTED live skill anywhere reviewSkills()/routeSkills()
 * look). `areaOfInterest`, when passed (whole-Subject deletion cascade,
 * useAppStore.ts's removeSubject -- NOT the plain removeMaterial path,
 * which archives skills without one), is stamped on every archived skill so
 * a later matching Subject can recognize and restore it. */
export function archiveSkillsForMaterial(skills: Skill[], materialId: string, areaOfInterest?: string): { kept: Skill[]; archived: Skill[] } {
  const toArchive = new Set(skillsForMaterial(skills, materialId).map((s) => s.id))
  const kept: Skill[] = []
  const archived: Skill[] = []
  const now = nowIso()
  for (const s of skills) {
    if (toArchive.has(s.id)) archived.push({ ...s, status: 'ARCHIVED', areaOfInterest: areaOfInterest ?? s.areaOfInterest, updatedAt: now })
    else kept.push(s)
  }
  return { kept, archived }
}

// ---- area-of-interest recognition (2026-08-21) -- when a NEW Subject is
// created, check whether it relates to any previously archived area. Same
// deterministic tag-overlap matching used everywhere else in this file (no
// embeddings/API call, no hidden cost) -- consistent with the project's
// established convention rather than a new matching strategy invented just
// for this. A subject "recognizes" an archived area when their tag sets
// (tagsFromText on the two names) overlap by at least MIN_AREA_OVERLAP.

const MIN_AREA_OVERLAP = 1

export function matchesAreaOfInterest(archivedAreaLabel: string, newSubjectName: string): boolean {
  const a = new Set(tagsFromText(archivedAreaLabel))
  const b = new Set(tagsFromText(newSubjectName))
  let overlap = 0
  for (const t of a) if (b.has(t)) overlap++
  return overlap >= MIN_AREA_OVERLAP
}

/** Pure split of archivedSkills into what a new Subject recognizes vs what
 * stays archived. Caller (useAppStore.ts's addSubject) moves `recognized`
 * into the live `skills` array with status reset to DRAFT -- see
 * types.ts's Skill.areaOfInterest comment for why DRAFT, not the skill's
 * old (pre-archival) status: recognition is a reason to give a skill
 * another chance, not a reason to trust it again for free. */
export function recognizeArchivedSkills(archivedSkills: Skill[], newSubjectName: string): { recognized: Skill[]; stillArchived: Skill[] } {
  const recognized: Skill[] = []
  const stillArchived: Skill[] = []
  for (const s of archivedSkills) {
    if (s.areaOfInterest && matchesAreaOfInterest(s.areaOfInterest, newSubjectName)) recognized.push(s)
    else stillArchived.push(s)
  }
  return { recognized, stillArchived }
}
