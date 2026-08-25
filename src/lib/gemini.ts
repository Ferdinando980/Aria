import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai'

// Pinned exact version, single source of truth (2026-08-20, prompted by
// external review): the Python research side's biggest confound in its
// first real run was an unpinned "latest" alias silently switching model
// mid-experiment, undetected until someone read the raw logs. Aria calls
// Gemini in production the same way -- if this string is ever changed to
// an alias, or the underlying model is swapped without updating it, there
// would be no way to tell "the skill got worse" from "the model changed
// under us" without this being logged on every call (see skillEvents.ts's
// `model` field). Bump this string, not a hidden alias, when moving to a
// new Gemini version -- see CLAUDE.md's warning about model names expiring.
// Bumped 3.6 -> 3.7 (2026-08-24): verified via GET .../v1beta/models with
// the user's own real key (never entered/seen by Claude, executed in the
// browser's own JS context, key never left localStorage) that gemini-3.7-
// flash exists, is generateContent-capable, and is a newer release in the
// SAME family/tier (version string 3.7-flash-08-2026 vs the previous pin's
// 3.6-flash-07-2026, identical 1,048,576/65,536 token limits) -- exactly
// the "moving to a new Gemini version" case this comment already described.
export const GEMINI_MODEL = 'gemini-3.7-flash'
// Fallback pin (2026-08-24, explicit user request: "implementare un
// multiutilizzo di modelli, se 3.7 non va, usami il 3.6, tanto la key è la
// stessa"). Same account/key, just a second real model id -- see
// generateWithFallback() below for where this is actually used, and its
// comment for why the model that served a call must be logged accurately,
// not assumed to always be GEMINI_MODEL.
export const GEMINI_FALLBACK_MODEL = 'gemini-3.6-flash'

// Retry-with-backoff for real Gemini calls, added same day as the 3.6->3.7
// bump above -- found live, not hypothetical: the very first real chat call
// after bumping hit a genuine `503 This model is currently experiencing high
// demand` on gemini-3.7-flash (a model version dated this same month, so
// more exposed to rollout demand spikes than an established pin), and a
// manual retry seconds later succeeded outright. No retry logic existed
// anywhere in this file before -- every real transient 5xx/429 was a hard
// user-facing failure ("controlla la chiave Gemini", actively misleading
// since the key was never the problem). Bounded (not indefinite, unlike the
// Python research side's batch-job retry -- this is a live chat UI, an
// unbounded retry would just make "immediate feedback" a lie in a different
// way) and only for genuinely retryable HTTP statuses, never for auth/bad-
// request errors, which should still fail fast and honestly.
const RETRYABLE_STATUSES = new Set([429, 500, 503, 504])
// 2->4 retries, 1.5s->2s base (2026-08-24, same day, real evidence not a
// guess): live use right after the 3.6->3.7 bump showed MULTIPLE consecutive
// 503s in a short span, not just the one-off this was first written for -- 2
// retries (3 total attempts, ~4.5s worst-case) wasn't always enough headroom
// for a demand spike on a model released this same month. Capped backoff
// (8s ceiling) so a real outage still fails in a bounded, human-noticeable
// time instead of hanging silently.
const MAX_RETRIES = 4
const RETRY_BASE_DELAY_MS = 2000
const RETRY_MAX_DELAY_MS = 8000

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const retryable = err instanceof GoogleGenerativeAIFetchError && RETRYABLE_STATUSES.has(err.status ?? 0)
      if (!retryable || attempt >= MAX_RETRIES) throw err
      await new Promise((resolve) => setTimeout(resolve, Math.min(RETRY_BASE_DELAY_MS * (attempt + 1), RETRY_MAX_DELAY_MS)))
    }
  }
}

// Tracks which model actually served the MOST RECENT call (2026-08-24).
// Every exported generation function in this file goes through
// generateWithFallback() below, which updates this right before returning.
// A module-level tracker (not a return value on every function) was the
// pragmatic choice here -- threading a {result, model} tuple through all 8
// exported functions AND every caller across 9 files was the "correct"
// design but a large blast-radius refactor this session doesn't have room
// for; this gets real accuracy for the common case (one call in flight,
// logged right after it resolves) at low risk, not zero risk (two calls
// truly overlapping in flight could read each other's model). Callers that
// log `model` for a SkillEvent should read getLastModelUsed() AFTER
// awaiting the generation call, not the GEMINI_MODEL constant -- otherwise
// a real fallback would silently mislabel the event, exactly the "model
// changed under us, undetected" confound GEMINI_MODEL's own comment warns
// about.
let lastModelUsed: string = GEMINI_MODEL
export function getLastModelUsed(): string {
  return lastModelUsed
}

// Real trigger for round-robin (2026-08-24, explicit user request after
// watching a real generation eat ~20s+4 wasted API calls): once
// GEMINI_MODEL's free-tier DAILY quota is out (429, quotaId
// GenerateRequestsPerDayPerProjectPerModel-FreeTier -- confirmed live in
// console, not assumed), it stays out until Google's own daily reset, no
// amount of local retrying fixes it. Always trying GEMINI_MODEL first meant
// EVERY call paid a full withRetry cycle (4 attempts, up to ~20s of
// backoff) against a model that was certain to fail, before ever reaching
// the fallback. Two changes: (1) which model is tried FIRST now alternates
// call to call (roundRobinIndex), spreading load across both instead of
// hammering one while the other sits idle; (2) a model that just failed
// with a 429 is remembered and skipped as primary for a cooldown window, so
// once a model's quota is confirmed out, calls stop wasting a full retry
// cycle on it until the cooldown expires. QUOTA_COOLDOWN_MS is deliberately
// short (not "until midnight") -- guessing Google's exact daily reset
// boundary wrong in either direction has a cheap failure mode (too short:
// the model just gets skipped again after one more wasted attempt; too
// long: the other model still serves every call fine via round-robin), so
// there's no need to hardcode a reset time we can't verify.
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000
const quotaCooldownUntil: Record<string, number> = {}

function isQuotaError(err: unknown): boolean {
  return err instanceof GoogleGenerativeAIFetchError && err.status === 429
}

function isOnQuotaCooldown(model: string): boolean {
  return (quotaCooldownUntil[model] ?? 0) > Date.now()
}

let roundRobinIndex = 0

// Real measurement, not assumption (2026-08-24, user request): whether
// Gemini's IMPLICIT prompt caching is actually engaging on the repeated
// material text sent by askAboutMaterial/generateStudyPlan every call --
// before considering any change to how those calls are shaped, or explicit
// (paid) caching, the only honest way to know is usageMetadata on a real
// response. cachedContentTokenCount > 0 means it's already saving tokens
// with zero code change; always 0 means it isn't engaging for this app's
// real call pattern (materials opened minutes apart, not back-to-back).
// Every one of this file's real call sites returns the same GenerateContentResult
// shape (`.response.usageMetadata`) even though generateWithFallback's `T` is
// generic, so a single duck-typed check here covers all of them.
function logCacheUsage(modelName: string, result: unknown) {
  const usage = (result as { response?: { usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number } } })?.response
    ?.usageMetadata
  if (!usage) return
  const cached = usage.cachedContentTokenCount ?? 0
  console.info(
    `[gemini cache] ${modelName}: prompt=${usage.promptTokenCount ?? '?'} cached=${cached}${cached > 0 ? ' (implicit caching hit)' : ''}`,
  )
}

/** Runs a Gemini call against GEMINI_MODEL and GEMINI_FALLBACK_MODEL, in an
 * order that alternates call-to-call (round-robin) and skips whichever one
 * most recently hit a real quota wall (isOnQuotaCooldown) as the primary
 * attempt -- see the block comment above for why. Each attempt still gets
 * withRetry's normal resilience (retries the SAME model on a transient
 * 429/5xx before giving up on it); only genuinely retryable errors move on
 * to the next model, auth/bad-request still fails fast and honestly. Real
 * live trigger for even needing two models at all (2026-08-24):
 * gemini-3.7-flash (this month's model) hit multiple consecutive 503 "high
 * demand" errors even after 4 retries -- a second, more established model
 * on the same key/account is a real fallback path, not a hypothetical one. */
export async function generateWithFallback<T>(
  key: string,
  modelConfig: { systemInstruction?: string; generationConfig?: Record<string, unknown> },
  run: (model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>) => Promise<T>,
): Promise<T> {
  const genAI = new GoogleGenerativeAI(key)
  const base: [string, string] = roundRobinIndex % 2 === 0 ? [GEMINI_MODEL, GEMINI_FALLBACK_MODEL] : [GEMINI_FALLBACK_MODEL, GEMINI_MODEL]
  roundRobinIndex++
  const order = isOnQuotaCooldown(base[0]) && !isOnQuotaCooldown(base[1]) ? [base[1], base[0]] : base

  let lastErr: unknown
  for (let i = 0; i < order.length; i++) {
    const modelName = order[i]
    try {
      const model = genAI.getGenerativeModel({ model: modelName, ...modelConfig })
      const result = await withRetry(() => run(model))
      lastModelUsed = modelName
      logCacheUsage(modelName, result)
      return result
    } catch (err) {
      lastErr = err
      const retryable = err instanceof GoogleGenerativeAIFetchError && RETRYABLE_STATUSES.has(err.status ?? 0)
      if (!retryable) throw err
      if (isQuotaError(err)) quotaCooldownUntil[modelName] = Date.now() + QUOTA_COOLDOWN_MS
      const next = order[i + 1]
      if (next) console.warn(`[gemini] ${modelName} still failing after retries, trying ${next}`, err)
    }
  }
  throw lastErr
}

const GEMINI_KEY_STORAGE = 'aria.geminiApiKey'

export function getGeminiKey(): string {
  return localStorage.getItem(GEMINI_KEY_STORAGE) ?? ''
}

export function setGeminiKey(key: string) {
  localStorage.setItem(GEMINI_KEY_STORAGE, key.trim())
}

export function hasGeminiKey(): boolean {
  return getGeminiKey().length > 0
}

const SYSTEM_PROMPT = `Sei Aria, un'assistente di studio calma, calorosa e concreta, ispirata a un compagno "stile Jarvis" ma con un tono umano e mai robotico.
Parli con una persona che ha ADHD: è facile che si senta sopraffatta, ha paura di fallire e a volte fatica a iniziare i compiti (task paralysis).
Regole per il tuo tono e comportamento:
- Scrivi in italiano, frasi brevi, niente muro di testo.
- Mai giudicare, mai colpevolizzare. Niente "avresti dovuto", niente prediche.
- Quando ti chiedono di spezzare un compito, dividilo in passi minuscoli e concreti (5-15 minuti l'uno), il primo passo deve essere facilissimo per rompere il blocco iniziale.
- Festeggia i piccoli progressi, non solo i grandi risultati.
- Se la persona sembra in ansia o bloccata, valida l'emozione in una riga, poi proponi un'azione piccola e immediata.
- Puoi suggerire tecniche concrete (pomodoro, body doubling, timer visivo, regola dei 2 minuti) ma senza elencarle a raffica: una alla volta.
- Sii concisa: preferisci risposte brevi e azionabili a spiegazioni lunghe.`

type ChatTurn = { role: 'user' | 'model'; text: string }
export interface ChatAttachment {
  /** base64 payload, no "data:...;base64," prefix */
  data: string
  mimeType: string
}

/** Prepends retrieved skill-library context to a system prompt, same pattern as
 * cognitive_rpg's SkillPackage.as_prompt_context() injection into the worker
 * prompt. Empty/undefined skillContext is a no-op — callers pass '' when the
 * Librarian is off or nothing was retrieved (config 'B'). */
function withSkillContext(systemPrompt: string, skillContext?: string): string {
  if (!skillContext) return systemPrompt
  return `Conoscenza accumulata dall'uso reale con questa persona, utile per questa risposta:\n${skillContext}\n\n---\n\n${systemPrompt}`
}

async function chatWithModel(systemPrompt: string, history: ChatTurn[], attachment?: ChatAttachment, skillContext?: string): Promise<string> {
  const key = getGeminiKey()
  if (!key) throw new Error('missing_key')

  const last = history[history.length - 1]
  const parts = attachment
    ? [{ inlineData: { data: attachment.data, mimeType: attachment.mimeType } }, { text: last.text }]
    : last.text
  const result = await generateWithFallback(key, { systemInstruction: withSkillContext(systemPrompt, skillContext) }, (model) => {
    const chat = model.startChat({
      history: history.slice(0, -1).map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      })),
    })
    return chat.sendMessage(parts)
  })
  return result.response.text()
}

export async function askAria(history: ChatTurn[], attachment?: ChatAttachment, skillContext?: string): Promise<string> {
  return chatWithModel(SYSTEM_PROMPT, history, attachment, skillContext)
}

/**
 * Same Aria persona, scoped to a single study material: the material's own
 * content (or, for links/files whose content we can't fetch, just its title
 * and type) is injected as a hidden first turn so every answer stays on-topic.
 */
export async function askAboutMaterial(materialContext: string, visibleHistory: ChatTurn[], skillContext?: string): Promise<string> {
  const contextTurn: ChatTurn = {
    role: 'user',
    text: `Contesto — sto studiando questo materiale:\n\n${materialContext}\n\nDa ora in poi aiutami con domande su questo materiale specifico. Se non hai il contenuto completo (es. è un link o un file che non puoi aprire), fallo presente con una riga e aiutami comunque in base a quello che ti dico io.`,
  }
  const ackTurn: ChatTurn = { role: 'model', text: 'Ok, ho il contesto. Chiedimi pure.' }
  return chatWithModel(SYSTEM_PROMPT, [contextTurn, ackTurn, ...visibleHistory], undefined, skillContext)
}

const STUDY_PLAN_PROMPT = `Sei Aria, assistente di studio per una persona con ADHD (paura di fallire, facilità a sentirsi sopraffatta da compiti grandi o poco chiari).
Ti do il contenuto reale dei materiali di una materia (non solo i titoli). Il tuo compito e' ANALIZZARLI e organizzare il piano PER CAPITOLO/SEZIONE.

Cosa analizzare, nell'ordine:
1. Struttura: se ti viene fornita già una struttura reale in capitoli (vedi istruzioni più sotto nel messaggio), rispettala esattamente invece di inventarne una tua. Altrimenti individua i capitoli/sezioni/titoli reali del materiale, nell'ordine in cui compaiono o vanno affrontati.
2. Concetti chiave e termini tecnici nuovi di ogni capitolo, da isolare e definire per primi.
3. Difficolta' e dipendenze: cosa richiede di aver capito cos'altro prima (prerequisiti)? Ordina i capitoli e i passi di conseguenza.
4. Densita': quanto e' lungo/tecnico ogni capitolo — un capitolo breve puo' avere 2-3 passi, uno lungo puo' averne fino a 5.
5. Occasioni di pratica gia' presenti nel testo (esempi, esercizi, domande, formule) — trasformale in passi attivi, non solo di lettura.
6. Cosa manca: se il materiale e' scarso o senza capitoli riconoscibili, crea un unico capitolo "Organizzazione" con passi per reperire/strutturare il materiale.

Poi scrivi il piano, seguendo ESATTAMENTE questo formato (importante, verra' letto da un programma):
## Titolo del capitolo
RIASSUNTO: una o due frasi che riassumono di cosa parla questo capitolo.
DURATA: stima in minuti del tempo REALE necessario per studiare l'intero capitolo (somma di tutti i suoi passi) -- basati sulla densita'/difficolta' reale del contenuto che hai appena letto, non su un numero fisso uguale per ogni capitolo. Solo il numero, es: DURATA: 55
- primo passo (azione concreta, verbo all'inizio, una sessione da 15-40 minuti)
- secondo passo
RIPASSO: una domanda breve e concreta per verificare se il concetto centrale del capitolo e' stato capito (non "cosa dice il capitolo" ma una domanda specifica, tipo interrogazione lampo)
RIPASSO: un'altra domanda diversa, se il capitolo ha almeno due concetti distinti (altrimenti ometti questa riga)
## Titolo del capitolo successivo
RIASSUNTO: ...
DURATA: ...
- passo
- passo
RIPASSO: ...

Altre regole:
- Nessun markdown oltre a "##" per i titoli capitolo, nessuna introduzione ne' conclusione fuori da questo formato.
- Tra 2 e 6 capitoli totali, ognuno con 2-5 passi e 1-2 domande RIPASSO.
- La DURATA deve riflettere davvero la densita' concettuale (regola 4 sopra), non essere un numero comodo: un capitolo con 2 passi semplici puo' valere 20 minuti, uno con 5 passi tecnici puo' valere 90 -- non forzare una proporzionalita' fissa col numero di passi.
- Il primissimo passo del primissimo capitolo deve essere il piu' facile e veloce possibile, per rompere il blocco iniziale.
- Se ti passo dei riassunti di capitoli gia' scritti in precedenza, NON riscriverli da zero: nel RIASSUNTO di quel capitolo riprendi il testo esistente e aggiungi solo eventuali informazioni nuove emerse dal materiale, senza contraddirlo.
- Le domande RIPASSO servono per il richiamo attivo distanziato nel tempo (retrieval practice): devono poter essere lette e a cui si prova a rispondere a mente in pochi secondi, senza riaprire il materiale.`

const MEMORY_PROMPT = `Aggiorni una "memoria" personale su un materiale di studio specifico — una lista compatta di cose utili da ricordare per le prossime volte che se ne parlerà (chiarimenti importanti, punti su cui l'utente si è confuso, definizioni, collegamenti fatti durante la conversazione).
Regole, IMPORTANTI:
- Rispondi SOLO con la lista aggiornata, una voce per riga, nessun numero, nessun markdown, nessuna introduzione né conclusione.
- Parti dalla memoria esistente (se c'è) e integrala con quanto emerso nella conversazione nuova: aggiungi voci nuove, aggiorna quelle cambiate, NON ripetere cose già coperte.
- Massimo 12 righe totali: se superi il limite, tieni le più utili e scarta le meno rilevanti.
- Ogni riga breve e concreta (una frase), niente ripetizioni del contenuto del file — solo cose specifiche imparate dalla conversazione.`

export async function updateMaterialMemory(existingMemory: string, conversationText: string): Promise<string> {
  const key = getGeminiKey()
  if (!key) throw new Error('missing_key')

  const prompt = `Memoria esistente:\n${existingMemory || '(vuota, prima volta)'}\n\nConversazione nuova:\n${conversationText}`
  const result = await generateWithFallback(key, { systemInstruction: MEMORY_PROMPT }, (model) => model.generateContent(prompt))
  return result.response.text().trim()
}

export interface ParsedChapter {
  title: string
  summary: string
  /** Minutes, from the model's own DURATA line (2026-08-24) -- a real
   * per-chapter estimate grounded in the content it just read, not a client-
   * side guess. Undefined if the model omitted the line (old-format cached
   * exchanges, or a rare parse miss) -- callers must fall back to an even
   * split, never assume a number that was never actually estimated. */
  estimatedMinutes?: number
  steps: string[]
  quiz: string[]
  /** Set when this plan chapter was generated from an already-detected
   * MaterialChapter (see materialContent.ts's buildStudyPlanChapterInputs
   * and this file's linkMaterialChapterIds) -- lets the UI show that
   * chapter's own MaterialSummary inline when the plan chapter is opened,
   * per explicit user request: "quando clicco su una parte... mostri il
   * riassunto di quella parte." Undefined for a material with no detected
   * chapters yet (whole-material fallback input, nothing real to link to). */
  materialChapterId?: string
  /** Set alongside materialChapterId when this plan block came from one real
   * detected SUBSECTION, not a whole chapter (2026-08-24 -- see
   * buildStudyPlanChapterInputs' section-level comment). Undefined for a
   * chapter with no subsections, or the whole-material fallback. */
  materialSectionId?: string
}

function parseChapters(text: string): ParsedChapter[] {
  const chapters: ParsedChapter[] = []
  let current: ParsedChapter | null = null
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('##')) {
      current = { title: line.replace(/^#+\s*/, '').trim(), summary: '', steps: [], quiz: [] }
      chapters.push(current)
    } else if (/^RIASSUNTO\s*:/i.test(line)) {
      if (current) current.summary = line.replace(/^RIASSUNTO\s*:/i, '').trim()
    } else if (/^DURATA\s*:/i.test(line)) {
      const n = parseInt(line.replace(/^DURATA\s*:/i, '').replace(/\D+/g, ''), 10)
      if (current && Number.isFinite(n) && n > 0) current.estimatedMinutes = n
    } else if (/^RIPASSO\s*:/i.test(line)) {
      if (current) current.quiz.push(line.replace(/^RIPASSO\s*:/i, '').trim())
    } else if (/^[-*•]/.test(line)) {
      if (current) current.steps.push(line.replace(/^[-*•]\s*/, '').trim())
    } else if (current && !current.summary) {
      // model sometimes writes the summary without the "RIASSUNTO:" prefix
      current.summary = line
    }
  }
  return chapters.filter((c) => c.title && c.steps.length > 0)
}

/** Ties each output block back to the real MaterialChapter it came from, by
 * title match first (the model is instructed to copy titles exactly when
 * chapterInputs is real structure -- see the structureLine below), falling
 * back to positional pairing if a title got reworded despite the
 * instruction. No-op (returns materialChapterId: undefined throughout) for
 * the free-discovery path (chapterInputs empty -- nothing real to link). */
function linkMaterialChapterIds(parsed: ParsedChapter[], chapterInputs: { chapterId?: string; sectionId?: string; title: string }[]): ParsedChapter[] {
  const normalize = (s: string) => s.trim().toLowerCase()
  return parsed.map((p, i) => {
    const exact = chapterInputs.find((ci) => normalize(ci.title) === normalize(p.title))
    const matched = exact ?? chapterInputs[i]
    return { ...p, materialChapterId: matched?.chapterId, materialSectionId: matched?.sectionId }
  })
}

export async function generateStudyPlan(
  subjectName: string,
  chapterInputs: { chapterId?: string; sectionId?: string; title: string; text: string }[],
  playbook: string,
  existingChapters: { title: string; summary: string }[],
  scopeLabel?: string,
  skillContext?: string,
  daysUntilExam?: number,
): Promise<ParsedChapter[]> {
  const key = getGeminiKey()
  if (!key) throw new Error('missing_key')

  const existingSummaries = existingChapters
    .filter((c) => c.summary)
    .map((c) => `- ${c.title}: ${c.summary}`)
    .join('\n')
  const deadlineLine =
    daysUntilExam !== undefined
      ? daysUntilExam <= 0
        ? "L'esame per questa materia e' oggi o gia' passato — segnalalo in una riga nel primo RIASSUNTO invece di proporre un piano lungo come se ci fosse tempo.\n\n"
        : `Mancano ${daysUntilExam} giorni all'esame di questa materia (data reale presa dal calendario). Dimensiona il numero di capitoli/passi e la loro densita' in modo realistico per quel tempo — non ignorare la scadenza, ma non sacrificare la comprensione per stare nei giorni a ogni costo.\n\n`
      : ''
  // Real bug fix (2026-08-21, user report: "il piano di studi non è fatto
  // sui capitoli generati"): when chapterInputs carries real detected
  // MaterialChapter structure (see materialContent.ts's
  // buildStudyPlanChapterInputs), the model must respect it exactly instead
  // of re-discovering its own split -- that's the whole fix. Empty
  // chapterInputs (no material has been through chapter detection yet)
  // falls back to the old free-discovery behavior, unchanged.
  const structureLine = chapterInputs.length > 0
    ? `La struttura in capitoli qui sotto è GIA' REALE (rilevata in precedenza dal materiale) -- NON inventarne una diversa, NON unire ne' dividere questi capitoli. Genera ESATTAMENTE un blocco "## Titolo" per ognuno dei capitoli elencati sotto, nello stesso ordine, copiando il titolo esatto riportato qui (non riformularlo).\n\n`
    : ''
  const chaptersText = chapterInputs.map((c, i) => `CAPITOLO ${i + 1}: ${c.title}\n${c.text.slice(0, 12000)}`).join('\n\n---\n\n')
  const prompt = `Materia: ${subjectName}
Ambito di questo piano: ${scopeLabel ?? 'tutti i materiali raccolti per questa materia'}${
    scopeLabel === 'solo questo materiale' ? ' — resta stretto sui contenuti di questo file, non inventare capitoli su altri argomenti della materia.' : ''
  }

${structureLine}${deadlineLine}${playbook ? `Cose imparate nel tempo su come fare buoni piani per questa persona (tienine conto):\n${playbook}\n\n` : ''}${existingSummaries ? `Riassunti di capitoli gia' scritti in precedenza (estendi, non riscrivere da zero):\n${existingSummaries}\n\n` : ''}Contenuto reale dei materiali raccolti:
${chaptersText || '(nessun materiale ancora — proponi comunque un piano generico per iniziare a organizzarsi su questa materia)'}`
  const result = await generateWithFallback(key, { systemInstruction: withSkillContext(STUDY_PLAN_PROMPT, skillContext) }, (model) => model.generateContent(prompt))
  const parsed = parseChapters(result.response.text())
  // The old 6-chapter cap existed to bound a model FREELY inventing
  // structure -- keep it only on that fallback path. When chapterInputs is
  // real detected structure, truncating would silently drop real chapters
  // of the material ("studiare ogni parte" -- every part, not the first 6).
  const capped = chapterInputs.length > 0 ? parsed : parsed.slice(0, 6)
  return linkMaterialChapterIds(capped, chapterInputs)
}

const PLAYBOOK_PROMPT = `Tieni un quaderno di appunti personale su come generare piani di studio sempre piu' efficaci per una persona specifica con ADHD.
Ti passo: lo schema attuale, il piano proposto l'ultima volta e cosa e' successo dopo (quanti passi ha completato, se ha chiesto di rigenerarlo subito).
Aggiorna lo schema con quello che impari — es. lunghezza giusta dei passi, formulazioni che funzionano meglio, argomenti su cui si blocca di piu'.
Regole di formato, IMPORTANTI:
- Rispondi SOLO con lo schema aggiornato, una voce per riga, nessun numero, nessun markdown.
- Massimo 10 righe: se servono piu' regole di quelle che stanno, tieni solo le piu' utili.
- Scarta le voci superate da osservazioni piu' recenti, non limitarti ad aggiungere in fondo.`

const CHAPTERS_PROMPT = `Dividi un documento in capitoli E sotto-sezioni in base al REALE cambio di argomento, usando il numero di pagina di ciascun frammento che ti passo per delimitare dove inizia/finisce ognuno.
Regole, IMPORTANTI:
- Rispondi SOLO con un array JSON valido, nessun markdown, nessuna introduzione: [{"title":"...","startPage":1,"endPage":4,"subsections":[{"title":"...","startPage":1,"endPage":2}]}, ...]
- "subsections" e' facoltativo (array vuoto o assente se il capitolo non ha sotto-argomenti distinti) -- non forzarlo se il capitolo tratta un solo argomento.
- I capitoli devono coprire TUTTE le pagine passate, senza buchi ne' sovrapposizioni: il primo inizia a pagina 1, ognuno dei successivi inizia dove finisce il precedente + 1.
- Le sotto-sezioni di un capitolo devono stare DENTRO l'intervallo di pagine di quel capitolo (non serve che coprano ogni singola pagina, solo i sotto-argomenti reali e distinti).
- Tra 2 e 12 capitoli totali (un documento breve o senza struttura riconoscibile puo' restare un unico capitolo). Zero a 6 sotto-sezioni per capitolo.
- Il numero di sotto-sezioni deve adattarsi alla lunghezza reale del capitolo, non essere fisso: un capitolo di 2-3 pagine puo' non averne bisogno, ma un capitolo lungo (es. 15+ pagine) con piu' argomenti distinti dovrebbe avere piu' sotto-sezioni cosi' da coprirlo a pezzi piccoli -- non lasciare un capitolo enorme con zero o una sola sotto-sezione se il contenuto reale si presta a essere diviso.
- Titoli brevi (max 8 parole), presi dal contenuto reale, non generici ("Capitolo 1" e' da evitare se c'e' un argomento vero).
- Scrivi i titoli nella STESSA lingua del documento (se e' in inglese, titoli in inglese: NON tradurre).
- Se tra le pagine passate c'e' una pagina di indice/sommario (una lista di titoli con numeri di pagina, tipicamente all'inizio), usala SOLO per capire i titoli reali e i numeri di pagina a cui puntano -- non trattarla come se fosse essa stessa un capitolo, e non mettere i capitoli che elenca sull'intervallo di pagine dell'indice: ogni capitolo va posizionato dove il suo contenuto inizia davvero nel documento, non dove e' semplicemente nominato nell'indice.`

export interface ChapterSuggestion {
  title: string
  startPage: number
  endPage: number
  subsections?: { title: string; startPage: number; endPage: number }[]
}

// Cheat Study image support (2026-08-26, real user request: "riconosce gli
// esercizi da immagini anche?"). A photo/scan has no PDF pages to point back
// to later -- unlike generateChapters, this asks the model to TRANSCRIBE
// each exercise's full text directly, once, here -- every later step
// (matching, generation) reads that transcription (types.ts's
// MaterialChapter/ChapterSection.transcribedText) instead of re-sending the
// image or re-calling vision again.
const IMAGE_EXERCISES_PROMPT = `Guarda l'immagine di una traccia d'esame e individua i singoli esercizi/quesiti distinti, trascrivendo il testo REALE di ciascuno per intero (non riassumerlo).
Regole, IMPORTANTI:
- Rispondi SOLO con un array JSON valido, nessun markdown, nessuna introduzione: [{"title":"Esercizio 1","text":"testo completo trascritto..."}, ...]
- Un elemento per ogni esercizio/quesito distinto visibile nell'immagine, nell'ordine in cui appaiono.
- "text" e' la trascrizione COMPLETA e fedele di quell'esercizio (enunciato, dati, richieste) -- non aggiungere né inventare nulla che non sia leggibile nell'immagine.
- "title" breve (es. "Esercizio 1", o il titolo reale se presente), stessa lingua del documento.
- Se l'immagine non e' leggibile o non contiene esercizi riconoscibili, rispondi con un array vuoto [].`

export async function generateExercisesFromImage(imageBase64: string, mimeType: string): Promise<{ title: string; text: string }[]> {
  const key = getGeminiKey()
  if (!key) throw new Error('missing_key')

  const result = await generateWithFallback(
    key,
    { systemInstruction: IMAGE_EXERCISES_PROMPT, generationConfig: JSON_GENERATION_CONFIG },
    (model) => model.generateContent([{ inlineData: { data: imageBase64, mimeType } }]),
  )
  try {
    return parseJsonArray<{ title: string; text: string }>(result.response.text()).filter((e) => e.title && e.text)
  } catch (err) {
    console.error('[generateExercisesFromImage] failed to parse model output', err, result.response.text())
    return []
  }
}

function parseJsonArray<T>(raw: string): T[] {
  // Models sometimes wrap JSON in ```json fences despite instructions not to -- strip them before parsing.
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  const parsed = JSON.parse(cleaned)
  if (Array.isArray(parsed)) return parsed as T[]
  // responseMimeType:'application/json' guarantees valid JSON, not that it's
  // a bare array -- a model can still wrap it in a single object property
  // (e.g. {"chapters":[...]}) despite the prompt asking for a bare array.
  // Unwrap the first array-valued property found instead of failing outright.
  if (parsed && typeof parsed === 'object') {
    const arrayProp = Object.values(parsed).find((v) => Array.isArray(v))
    if (arrayProp) return arrayProp as T[]
  }
  throw new Error('not_an_array')
}

// JSON.parse'd output from a prompt instruction alone ("rispondi solo con
// JSON") is unreliable -- the model can still prepend a sentence or use
// smart quotes despite being told not to (found 2026-08-20: this is exactly
// why chapter/flashcard generation kept silently failing while the plain-
// text-parsed generateStudyPlan above never did). responseMimeType forces
// the API itself to only emit valid JSON, not just ask nicely for it.
const JSON_GENERATION_CONFIG = { responseMimeType: 'application/json' }

/**
 * `continueFrom` is set for a second (or later) pass on a document too big
 * to cover in one call (see materialContent.ts's `truncated` flag) -- it
 * tells the model this batch of pages is a continuation, not the whole
 * document, so it doesn't restart chapter numbering/titles from page 1 or
 * re-cover pages already chaptered in an earlier pass.
 */
export async function generateChapters(
  materialTitle: string,
  pages: { page: number; text: string }[],
  continueFrom?: { lastChapterTitle: string; lastEndPage: number },
  skillContext?: string,
): Promise<ChapterSuggestion[]> {
  const key = getGeminiKey()
  if (!key) throw new Error('missing_key')
  if (pages.length === 0) return []

  const continuationNote = continueFrom
    ? `NOTA: questo e' il SEGUITO dello stesso documento, non l'inizio -- le pagine da 1 a ${continueFrom.lastEndPage} sono gia' state divise in capitoli in un passaggio precedente (l'ultimo era "${continueFrom.lastChapterTitle}", finito a pagina ${continueFrom.lastEndPage}). Il primo capitolo che trovi qui sotto deve iniziare a pagina ${continueFrom.lastEndPage + 1} (o dove inizia davvero il prossimo argomento, se piu' avanti) -- non ripartire da pagina 1.\n\n`
    : ''
  const prompt = `${continuationNote}Materiale: ${materialTitle}\n\n${pages.map((p) => `[pagina ${p.page}] ${p.text}`).join('\n\n')}`
  const result = await generateWithFallback(
    key,
    { systemInstruction: withSkillContext(CHAPTERS_PROMPT, skillContext), generationConfig: JSON_GENERATION_CONFIG },
    (model) => model.generateContent(prompt),
  )
  const lastPage = pages[pages.length - 1].page
  try {
    const chapters = parseJsonArray<ChapterSuggestion>(result.response.text())
      .filter((c) => c.title && Number.isFinite(c.startPage) && Number.isFinite(c.endPage))
      .map((c) => {
        const startPage = Math.max(1, Math.round(c.startPage))
        const endPage = Math.min(lastPage, Math.round(c.endPage))
        const subsections = (c.subsections ?? [])
          .filter((s) => s.title && Number.isFinite(s.startPage) && Number.isFinite(s.endPage))
          .map((s) => ({
            title: s.title,
            startPage: Math.min(endPage, Math.max(startPage, Math.round(s.startPage))),
            endPage: Math.min(endPage, Math.max(startPage, Math.round(s.endPage))),
          }))
          .filter((s) => s.endPage >= s.startPage)
        return { title: c.title, startPage, endPage, subsections }
      })
      .filter((c) => c.endPage >= c.startPage)
    return chapters.length > 0 ? chapters : [{ title: materialTitle, startPage: 1, endPage: lastPage, subsections: [] }]
  } catch (err) {
    // Malformed JSON is a real, expected failure mode (not every model call
    // is well-formed) -- fall back to one chapter covering the whole
    // document rather than leaving the material with none at all. Logged
    // (not just swallowed) so a real recurring failure is diagnosable next
    // time instead of just "didn't work".
    console.error('[generateChapters] failed to parse model output', err, result.response.text())
    return [{ title: materialTitle, startPage: 1, endPage: lastPage, subsections: [] }]
  }
}

const FLASHCARDS_PROMPT = `Crei flashcard (domanda/risposta) da studiare per richiamo attivo (retrieval practice), a partire dal contenuto reale di un materiale di studio.
Regole, IMPORTANTI:
- Rispondi SOLO con un array JSON valido, nessun markdown: [{"front":"domanda","back":"risposta"}, ...]
- "front" e' una domanda specifica e autosufficiente (non "cosa dice il testo" ma tipo interrogazione), "back" e' la risposta concreta, breve (1-3 frasi), non una citazione del testo intera.
- Tra 5 e 15 flashcard, una per ogni concetto/fatto/definizione distinto e verificabile nel testo -- non ripetere lo stesso concetto in card diverse.
- Se ti passo flashcard gia' esistenti su questo stesso materiale/ambito, NON ripeterle e non riformulare lo stesso concetto: copri solo concetti nuovi non ancora coperti.
- Se il testo non ha abbastanza contenuto verificabile (o i concetti verificabili sono gia' tutti coperti dalle flashcard esistenti), restituisci meno card piuttosto che inventare, generalizzare o duplicare.`

export interface FlashcardSuggestion {
  front: string
  back: string
}

export async function generateFlashcards(materialTitle: string, scopeLabel: string, text: string, existingFronts: string[] = [], skillContext?: string): Promise<FlashcardSuggestion[]> {
  const key = getGeminiKey()
  if (!key) throw new Error('missing_key')
  if (!text.trim()) return []

  const existingLine = existingFronts.length > 0 ? `Flashcard gia' esistenti (non ripetere questi concetti):\n${existingFronts.map((f) => `- ${f}`).join('\n')}\n\n` : ''
  const prompt = `Materiale: ${materialTitle}\nAmbito: ${scopeLabel}\n\n${existingLine}Contenuto:\n${text.slice(0, 12000)}`
  const result = await generateWithFallback(
    key,
    { systemInstruction: withSkillContext(FLASHCARDS_PROMPT, skillContext), generationConfig: JSON_GENERATION_CONFIG },
    (model) => model.generateContent(prompt),
  )
  try {
    return parseJsonArray<FlashcardSuggestion>(result.response.text()).filter((c) => c.front && c.back)
  } catch (err) {
    console.error('[generateFlashcards] failed to parse model output', err, result.response.text())
    return []
  }
}

// Rewritten (2026-08-21, explicit user request: "ho l'adhd i riassunti
// devono essere adatti a questa cosa") -- the original had NO ADHD framing
// at all, unlike every other prompt in this file (SYSTEM_PROMPT,
// STUDY_PLAN_PROMPT). A "chiaro e ben organizzato" summary for a general
// reader is not the same document as one scannable in short bursts without
// re-reading -- short paragraphs, headers as visual anchors, bold on the
// term that matters, no dense walls of text even for dense source material.
const SUMMARY_PROMPT = `Scrivi un riassunto di studio per una persona con ADHD, a partire dal contenuto reale di un materiale.
Una persona con ADHD fatica a restare concentrata su blocchi di testo lunghi e uniformi -- il riassunto deve essere pensato per questo, non solo corretto nei contenuti:
- Paragrafi brevi (2-4 righe al massimo) -- mai un muro di testo, anche se il contenuto originale è denso.
- Usa "## " per dividere il riassunto in sezioni con titoli brevi e concreti (funzionano come punti di appoggio per l'occhio) -- non un unico blocco continuo. Apri ogni titolo di sezione con UNA emoji pertinente al contenuto di quella sezione (es. "## 🧮 Formule", "## ⚠️ Errori comuni", "## 💡 Intuizione") -- solo sui titoli "## ", mai sui sotto-titoli "### " né nel corpo del testo, e sempre la stessa lingua visiva di un'emoji sola, non due o tre insieme.
- Usa elenchi puntati ("- ") per liste di concetti, passaggi o esempi, invece di infilarli in una frase lunga.
- Metti in **grassetto** (markdown, doppio asterisco) il termine o il dato chiave di ogni paragrafo/punto -- una persona che scorre veloce deve poter cogliere l'essenziale senza rileggere tutto.
- Se un punto o un paragrafo è di un tipo riconoscibile, aprilo con un'etichetta tra parentesi quadre maiuscola prima del testo, es. "[DEFINIZIONE] ...", "[ESEMPIO] ...", "[FORMULA] ...", "[REGOLA] ...", "[ALGORITMO] ...", "[ATTENZIONE] ..." per un errore comune o un fraintendimento -- solo quando è genuinamente utile per orientarsi al colpo d'occhio, non su ogni singola riga, mai più di un'etichetta per punto.
- Ogni formula matematica in notazione LaTeX vera: $...$ per una formula dentro una frase (es. "il costo è $T(n) = O(n)$"), $$...$$ su una riga a sé per una formula isolata -- mai scritta a parole o con simboli approssimati, mai testo tipo "T di n" quando intendi $T(n)$.
- Testo semplice (nessun JSON), niente introduzioni tipo "Ecco il riassunto".
- Copri i concetti chiave, le definizioni importanti e le relazioni tra loro -- non una parafrasi riga per riga, un vero riassunto che si possa studiare da solo.
- Lunghezza proporzionata al contenuto reale: un capitolo breve merita un riassunto breve, non va allungato artificialmente -- ma anche un capitolo lungo resta diviso in sezioni brevi, mai un blocco unico più lungo.

Adatta la STRUTTURA di ogni sezione al TIPO di conoscenza che contiene, invece di usare sempre lo stesso schema generico -- non tutti i contenuti si riassumono allo stesso modo:
- Se il contenuto è una DEFINIZIONE/concetto: cosa significa, perché conta, un esempio concreto, e cosa NON significa (i fraintendimenti tipici).
- Se il contenuto è un ALGORITMO/procedimento tecnico: il problema che risolve, l'idea centrale in una frase, i passi in ordine, un esempio applicato, la complessità/il costo se rilevante, gli errori comuni.
- Se il contenuto è un TEOREMA/regola formale: l'enunciato, l'intuizione dietro (perché è vero, non solo cosa dice), le condizioni per cui vale, la conseguenza pratica, un esempio.
- Se il contenuto è una PROCEDURA operativa: quando si usa, cosa serve prima (input), i passi, cosa si ottiene (output), cosa può andare storto.
- Se il contenuto non rientra chiaramente in nessuno di questi (narrativo, discorsivo, contestuale), usa la struttura generica di sempre (concetti chiave + relazioni) -- non forzarlo in uno schema che non gli si addice.
Un capitolo può mescolare più tipi in sezioni diverse (es. una definizione seguita da un algoritmo che la usa) -- scegli la struttura sezione per sezione, non una sola per l'intero riassunto.`

// Cheat Study (2026-08-25/26, real user correction on the first design: la
// TRACCIA determina cosa cercare, il materiale COLLEGATO -- opzionale --
// determina dove cercarlo. Non e' l'input: e' una fonte facoltativa.
// studyContext viene DA quel materiale collegato (sezione trovata via
// overlap di tag + skill già distillate, mai full-text/online) quando esiste
// -- se l'utente non ha collegato nulla, studyContext e' null e Gemini
// costruisce comunque il materiale necessario dalla propria conoscenza,
// dichiarandolo esplicitamente invece di fingere di aver letto qualcosa che
// non esiste (stessa disciplina di fs_uncertainty_disclosure_check).
const GROUNDED_NOTE = `Basati SOLO sul materiale di studio reale fornito qui sotto -- non inventare formule, teoremi o passaggi che non ci sono. Se il materiale non copre completamente l'esercizio, dillo esplicitamente in una riga all'inizio ("Il materiale non copre [x], la spiegazione di quella parte è generica") invece di fingere che sia tutto coperto.`
const UNGROUNDED_NOTE = `Non hai nessun materiale di studio specifico dell'utente collegato -- usa la tua conoscenza generale dell'argomento per costruire comunque una spiegazione utile, ma dillo esplicitamente in una riga all'inizio ("Nessun materiale collegato -- spiegazione basata su conoscenza generale, verificala col tuo corso") invece di far credere che venga dal materiale dell'utente.`

const CHEAT_STUDY_PROMPT = `Spieghi la soluzione di un esercizio d'esame, per una persona con ADHD che sta usando la traccia per esercitarsi.
Regole, IMPORTANTI:
{{GROUNDING_NOTE}}
- Struttura: prima il RAGIONAMENTO (perché si risolve così, quale concetto si applica), poi i PASSI in ordine, infine il RISULTATO finale se l'esercizio ne ha uno.
- Paragrafi brevi, elenchi puntati per i passi, **grassetto** sul concetto chiave di ogni passo -- stessa cura di un riassunto, non un muro di testo.
- Formule matematiche in LaTeX vero ($...$ inline, $$...$$ isolata), mai a parole.
- Testo semplice (nessun JSON), niente introduzioni tipo "Ecco la soluzione".`

export async function generateCheatStudySolution(exerciseTitle: string, exerciseText: string, studyContext: string | null, skillContext?: string): Promise<string> {
  const key = getGeminiKey()
  if (!key) throw new Error('missing_key')

  const grounded = Boolean(studyContext?.trim())
  const prompt = grounded
    ? `Esercizio: ${exerciseTitle}\n\nTesto dell'esercizio:\n${exerciseText.slice(0, 6000)}\n\nMateriale di studio reale trovato per questo argomento:\n${studyContext!.slice(0, 15000)}`
    : `Esercizio: ${exerciseTitle}\n\nTesto dell'esercizio:\n${exerciseText.slice(0, 6000)}`
  const prompt_ = CHEAT_STUDY_PROMPT.replace('{{GROUNDING_NOTE}}', grounded ? GROUNDED_NOTE : UNGROUNDED_NOTE)
  const result = await generateWithFallback(key, { systemInstruction: withSkillContext(prompt_, skillContext) }, (model) => model.generateContent(prompt))
  return result.response.text().trim()
}

const EQUIVALENT_EXERCISE_PROMPT = `Crei un esercizio NUOVO ed EQUIVALENTE a un esercizio d'esame dato, per una persona con ADHD che vuole esercitarsi oltre alla traccia originale.
Regole, IMPORTANTI:
{{GROUNDING_NOTE}}
- L'esercizio nuovo deve: stesso concetto/competenza richiesta, difficoltà comparabile, struttura analoga -- MAI una copia o una banale riformulazione dell'originale (cambia i dati/il contesto/i numeri).
- Genera anche la soluzione del nuovo esercizio, sotto un titolo "## Soluzione" separato -- così ci si può allenare prima di guardarla.
- Formule matematiche in LaTeX vero ($...$ inline, $$...$$ isolata), mai a parole.
- Testo semplice (nessun JSON), niente introduzioni tipo "Ecco l'esercizio".`

export async function generateEquivalentExercise(exerciseTitle: string, exerciseText: string, studyContext: string | null, skillContext?: string): Promise<string> {
  const key = getGeminiKey()
  if (!key) throw new Error('missing_key')

  const grounded = Boolean(studyContext?.trim())
  const prompt = grounded
    ? `Esercizio originale: ${exerciseTitle}\n\nTesto:\n${exerciseText.slice(0, 6000)}\n\nMateriale di studio reale collegato a questo argomento:\n${studyContext!.slice(0, 15000)}`
    : `Esercizio originale: ${exerciseTitle}\n\nTesto:\n${exerciseText.slice(0, 6000)}`
  const prompt_ = EQUIVALENT_EXERCISE_PROMPT.replace('{{GROUNDING_NOTE}}', grounded ? GROUNDED_NOTE : UNGROUNDED_NOTE)
  const result = await generateWithFallback(key, { systemInstruction: withSkillContext(prompt_, skillContext) }, (model) => model.generateContent(prompt))
  return result.response.text().trim()
}

export async function generateSummary(materialTitle: string, scopeLabel: string, text: string, skillContext?: string): Promise<string> {
  const key = getGeminiKey()
  if (!key) throw new Error('missing_key')
  if (!text.trim()) return ''

  const prompt = `Materiale: ${materialTitle}\nAmbito: ${scopeLabel}\n\nContenuto:\n${text.slice(0, 15000)}`
  const result = await generateWithFallback(key, { systemInstruction: withSkillContext(SUMMARY_PROMPT, skillContext) }, (model) => model.generateContent(prompt))
  return result.response.text().trim()
}

export async function reflectOnStudyPlan(playbook: string, subjectName: string, previousPlan: string[], outcome: string): Promise<string> {
  const key = getGeminiKey()
  if (!key) throw new Error('missing_key')

  const prompt = `Schema attuale:\n${playbook || '(vuoto, prima volta)'}\n\nMateria: ${subjectName}\nPiano proposto l'ultima volta:\n${previousPlan.join('\n')}\n\nCosa e' successo dopo:\n${outcome}`
  const result = await generateWithFallback(key, { systemInstruction: PLAYBOOK_PROMPT }, (model) => model.generateContent(prompt))
  return result.response.text().trim()
}
