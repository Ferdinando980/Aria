import { generateWithFallback, getGeminiKey } from './gemini'

/**
 * Numeric example generator for block formulas in summaries (2026-08-24,
 * real user request). The whole point: correctness of a generated example
 * is decided by REAL COMPUTATION, never by the model's own claim that its
 * example is right -- same "verifier is not the thing being verified"
 * principle cognitive_rpg's domain/verifier.py uses (real pytest, not an
 * LLM judge). Two separate gates, never merged (see below): Gate 1
 * (mathematical correctness, computed, must pass before an example ever
 * exists) and Gate 2 (pedagogical usefulness, the existing skill
 * uses/promotion/demotion cycle -- reused as-is, applied only to examples
 * that already cleared Gate 1). An example "used often and liked" is not
 * automatically correct; a "correct" example that nobody finds useful stays
 * DRAFT forever, which is fine.
 */

// ---- family taxonomy (2026-08-24) -----------------------------------
// Only ONE family currently has a real numeric verifier: divide-and-conquer
// recurrences of the shape T(n) = a*T(n/b) + f(n), which can be simulated
// directly from their own recursive definition -- no symbolic library
// needed, no network call, pure client-side arithmetic. Every other family
// found in real material (graph complexity, NP-hardness reductions, and
// plenty of non-recurrence formulas) has NO numeric verifier here yet --
// they are labeled honestly as unverified in the UI, never silently treated
// as if Gate 1 had run and passed.
export type FormulaFamily = 'divide_conquer_recurrence' | 'graph_complexity' | 'np_reduction' | 'other'

export const FAMILY_HAS_NUMERIC_GATE: Record<FormulaFamily, boolean> = {
  divide_conquer_recurrence: true,
  graph_complexity: false,
  np_reduction: false,
  other: false,
}

export const FAMILY_LABEL: Record<FormulaFamily, string> = {
  divide_conquer_recurrence: 'Ricorrenza divide-et-impera',
  graph_complexity: 'Complessità su grafi',
  np_reduction: 'Riduzione NP',
  other: 'Altro',
}

// ---- growth classes, computable without a symbolic parser -------------
// The model never writes f(n)/T(n) as a literal expression -- it picks a
// CATEGORICAL growth class (this small fixed vocabulary), which is enough
// to know how the theorem/complexity comparison works and is directly
// mappable to a real JS function for simulation. This is what makes "no
// symbolic library" possible: understanding f(n) is reduced to a
// classification the model already has to get right anyway (it's asked to
// STATE it, not derive it from prose), verification then checks the
// classification against real computed behavior, not against the model's
// prose explanation of why it chose it.
export type GrowthOrder = 'constant' | 'logarithmic' | 'linear' | 'linearithmic' | 'polynomial'

export interface ComplexityClass {
  order: GrowthOrder
  /** Only meaningful when order === 'polynomial' (n^k, k != 1). Ignored otherwise. */
  polynomialDegree?: number
  /** Multiplies the base growth by log n -- lets e.g. n^2 log n be expressed
   * without a dedicated order value for every polynomial-degree x log-factor
   * combination. Redundant with order:'linearithmic' for the degree-1 case
   * (both mean n log n); 'linearithmic' stays as the common-case shorthand. */
  hasLogFactor?: boolean
}

export const GROWTH_ORDER_LABEL: Record<GrowthOrder, string> = {
  constant: 'costante',
  logarithmic: 'logaritmica',
  linear: 'lineare',
  linearithmic: 'lineare-logaritmica (n log n)',
  polynomial: 'polinomiale',
}

/** Renders a ComplexityClass as the Θ(...) string a person would recognize
 * from the material -- for display only, never parsed back. */
export function complexityLabel(c: ComplexityClass): string {
  const deg = c.order === 'polynomial' ? (c.polynomialDegree ?? 2) : undefined
  const base =
    c.order === 'constant' ? '1' :
    c.order === 'logarithmic' ? 'log n' :
    c.order === 'linear' ? 'n' :
    c.order === 'linearithmic' ? 'n log n' :
    deg === 2 ? 'n²' : deg === 3 ? 'n³' : `n^${deg}`
  const withLog = c.hasLogFactor && c.order !== 'linearithmic' && c.order !== 'logarithmic' ? `${base} log n` : base
  return `Θ(${withLog})`
}

function growthFn(c: ComplexityClass): (n: number) => number {
  const base = (n: number): number => {
    const safe = Math.max(n, 2)
    switch (c.order) {
      case 'constant':
        return 1
      case 'logarithmic':
        return Math.log2(safe)
      case 'linear':
        return n
      case 'linearithmic':
        return n * Math.log2(safe)
      case 'polynomial':
        return Math.pow(n, c.polynomialDegree ?? 2)
    }
  }
  const needsExtraLog = c.hasLogFactor && c.order !== 'linearithmic' && c.order !== 'logarithmic'
  return needsExtraLog ? (n: number) => base(n) * Math.log2(Math.max(n, 2)) : base
}

// ---- Gate 1: real computation, not model judgment ----------------------

export interface RecurrenceParams {
  a: number
  b: number
  fn: ComplexityClass
  fnDescription: string
  /** Short flavor/story for the worked example (e.g. "MergeSort su un
   * array di n elementi") -- context only, never used to derive the
   * numbers shown; those come from computeT() on the params above. */
  context: string
  /** Master Theorem case (1/2/3), when the model believes the classic
   * theorem applies. Checked arithmetically against a/b/fn below --
   * disagreement fails Gate 1 even if the numeric curve check alone would
   * have passed, since a wrong case number is itself a real error. */
  declaredCase?: 1 | 2 | 3
  declaredComplexity: ComplexityClass
}

export interface RecurrenceVerification {
  pass: boolean
  reason: string
  empirical: { n: number; T: number }[]
  /** What a/b/fn actually imply via the classic 3-case comparison (log_b(a)
   * vs fn's polynomial degree) -- null when fn's shape doesn't fit the
   * classic comparison (e.g. fn is logarithmic/linearithmic), in which case
   * only the numeric curve check applies. */
  computedCase: 1 | 2 | 3 | null
}

const SAMPLE_NS = [10, 100, 1000, 10000]
// Deliberately generous (2026-08-24) -- 4 sample points and integer
// floor-division in the recursion mean the empirical ratio never converges
// perfectly even for a genuinely correct complexity class. The point of
// this tolerance is to catch a GENUINELY wrong class (which typically
// produces ratio growth of 10x-1000x+ over this range), not to demand
// textbook-clean convergence from a numeric simulation.
const RATIO_TOLERANCE_LOW = 0.1
const RATIO_TOLERANCE_HIGH = 10

/** T(n) = a*T(n/b) + f(n), computed by directly applying the recursive
 * definition -- no closed form, no symbolic solving. Recursion depth is
 * log_b(n) (≈14 for n=10000, b=2), no memoization needed at this scale. */
export function computeT(a: number, b: number, fn: ComplexityClass, n: number): number {
  if (n <= 1) return 1
  return a * computeT(a, b, fn, Math.floor(n / b)) + growthFn(fn)(n)
}

function masterTheoremCase(a: number, b: number, fn: ComplexityClass): 1 | 2 | 3 | null {
  if (fn.hasLogFactor) return null // classic 3-case comparison doesn't cover a log-factor f(n) cleanly
  if (fn.order !== 'polynomial' && fn.order !== 'constant' && fn.order !== 'linear') return null
  const fnDegree = fn.order === 'constant' ? 0 : fn.order === 'linear' ? 1 : (fn.polynomialDegree ?? 2)
  const critical = Math.log(a) / Math.log(b)
  const EPS = 1e-9
  if (fnDegree < critical - EPS) return 1
  if (Math.abs(fnDegree - critical) <= EPS) return 2
  return 3 // regularity condition assumed (standard textbook simplification, not separately checked)
}

/** The actual Gate 1 gate. Pure function -- same inputs, same verdict,
 * every time, independent of any model call. */
export function verifyRecurrenceExample(params: RecurrenceParams): RecurrenceVerification {
  if (!(params.a > 0) || !(params.b > 1)) {
    return { pass: false, reason: 'parametri non validi: a deve essere positivo, b deve essere maggiore di 1', empirical: [], computedCase: null }
  }
  const empirical = SAMPLE_NS.map((n) => ({ n, T: computeT(params.a, params.b, params.fn, n) }))
  const g = growthFn(params.declaredComplexity)
  const ratios = empirical.map((e) => e.T / g(e.n))
  const ratioGrowth = ratios[ratios.length - 1] / ratios[0]
  const numericPass = Number.isFinite(ratioGrowth) && ratioGrowth >= RATIO_TOLERANCE_LOW && ratioGrowth <= RATIO_TOLERANCE_HIGH

  const computedCase = masterTheoremCase(params.a, params.b, params.fn)
  const casePass = params.declaredCase === undefined || computedCase === null || params.declaredCase === computedCase

  if (!numericPass) {
    return {
      pass: false,
      reason: `la curva empirica di T(n) non è compatibile con la complessità dichiarata (${complexityLabel(params.declaredComplexity)}): il rapporto T(n)/g(n) cambia di ${ratioGrowth.toFixed(1)}x tra n=${SAMPLE_NS[0]} e n=${SAMPLE_NS[SAMPLE_NS.length - 1]}, fuori dalla tolleranza [${RATIO_TOLERANCE_LOW}x, ${RATIO_TOLERANCE_HIGH}x]`,
      empirical,
      computedCase,
    }
  }
  if (!casePass) {
    return {
      pass: false,
      reason: `il caso dichiarato (caso ${params.declaredCase}) non corrisponde al caso calcolato da a=${params.a}, b=${params.b}, f(n)=${complexityLabel(params.fn)} (caso ${computedCase})`,
      empirical,
      computedCase,
    }
  }
  return {
    pass: true,
    reason: `verificato: la curva empirica di T(n) è compatibile con ${complexityLabel(params.declaredComplexity)}${params.declaredCase !== undefined ? ` (caso ${params.declaredCase}, confermato dal calcolo)` : ''}`,
    empirical,
    computedCase,
  }
}

/** The real worked-example numbers shown to the user -- computed from the
 * SAME verified params, never from separate model-written prose. This is
 * what guarantees the numbers on screen match what Gate 1 actually
 * checked: there is no second, unchecked narrative of the same example. */
export function unrollSteps(params: RecurrenceParams, n: number): { n: number; fnValue: number; recurse: number; total: number }[] {
  const steps: { n: number; fnValue: number; recurse: number; total: number }[] = []
  let current = n
  while (current > 1) {
    const fnValue = growthFn(params.fn)(current)
    const recurse = Math.floor(current / params.b)
    steps.push({ n: current, fnValue, recurse, total: 0 }) // total filled in below, once recursion bottoms out
    current = recurse
  }
  // Fill totals bottom-up: T(1)=1, then T(n)=a*T(n/b)+f(n) walking back up.
  let acc = 1
  for (let i = steps.length - 1; i >= 0; i--) {
    acc = params.a * acc + steps[i].fnValue
    steps[i].total = acc
  }
  return steps
}

// ---- generation: structured output, model produces params only --------

export interface FormulaExampleResult {
  family: FormulaFamily
  params?: RecurrenceParams // only present when family === 'divide_conquer_recurrence'
  verification?: RecurrenceVerification // only present when params is present
}

const FORMULA_EXAMPLE_PROMPT = `Analizzi una formula matematica presa da un riassunto di studio di algoritmi. Il tuo compito è SOLO classificarla e, se è una ricorrenza divide-et-impera (forma T(n) = a*T(n/b) + f(n)), estrarne i parametri strutturati -- MAI dichiarare tu stesso se l'esempio è corretto, quello lo verifica un calcolo reale dopo, non tu.

Rispondi SOLO con un oggetto JSON, nessun testo fuori dal JSON, in questa forma esatta:
{
  "family": "divide_conquer_recurrence" | "graph_complexity" | "np_reduction" | "other",
  "params": {
    "a": <numero, solo se family è divide_conquer_recurrence>,
    "b": <numero, solo se family è divide_conquer_recurrence>,
    "fn": { "order": "constant"|"logarithmic"|"linear"|"linearithmic"|"polynomial", "polynomialDegree": <numero, solo se order è polynomial>, "hasLogFactor": <bool, opzionale> },
    "fnDescription": "<breve descrizione di cosa rappresenta f(n) in questo contesto>",
    "context": "<breve scenario concreto per un esempio numerico, es. 'MergeSort su un array di interi'>",
    "declaredCase": <1, 2, o 3, solo se il Master Theorem classico si applica>,
    "declaredComplexity": { "order": ..., "polynomialDegree": ..., "hasLogFactor": ... }
  }
}
Se family NON è "divide_conquer_recurrence", ometti "params" del tutto.
Se a/b non sono determinabili dalla formula con sicurezza, usa family "other" invece di indovinare.`

/** Discard log, same shape/spirit as a skill REJECTED event (2026-08-24) --
 * every Gate-1 attempt that fails is recorded here, pass or fail, so the
 * per-family reliability numbers (see formulaExampleStats below) are real
 * counts, not just a tally of successes. Kept separate from SkillEvent on
 * purpose: Gate 1 is a deterministic computed gate, not a behavioral
 * outcome signal, so it doesn't belong in the CALL/OUTCOME vocabulary that
 * drives skill promotion/demotion (see the module comment above). */
export interface FormulaGateAttempt {
  id: string
  ts: string
  family: FormulaFamily
  gate1Pass: boolean | null // null when the family has no numeric gate at all
  reason: string
}

/** Calls Gemini for classification + params only (never for a correctness
 * verdict), then runs the REAL Gate 1 check locally. The returned
 * `verification` (when present) is always the pure-function result, never
 * anything the model claimed. */
export async function generateFormulaExample(formulaLatex: string, surroundingContext: string): Promise<{ result: FormulaExampleResult; attempt: FormulaGateAttempt }> {
  const key = getGeminiKey()
  const now = new Date().toISOString()
  const attemptId = crypto.randomUUID()
  if (!key) {
    return { result: { family: 'other' }, attempt: { id: attemptId, ts: now, family: 'other', gate1Pass: null, reason: 'nessuna chiave Gemini configurata' } }
  }
  const prompt = `Formula: ${formulaLatex}\n\nContesto (dal riassunto, per capire di cosa si parla): ${surroundingContext.slice(0, 800)}`
  const raw = await generateWithFallback(
    key,
    { systemInstruction: FORMULA_EXAMPLE_PROMPT, generationConfig: { responseMimeType: 'application/json' } },
    (model) => model.generateContent(prompt),
  )
  const text = raw.response.text().trim()

  let parsed: { family?: string; params?: Record<string, unknown> }
  try {
    parsed = JSON.parse(text)
  } catch {
    return { result: { family: 'other' }, attempt: { id: attemptId, ts: now, family: 'other', gate1Pass: null, reason: 'risposta non era JSON valido' } }
  }

  const family: FormulaFamily = parsed.family === 'divide_conquer_recurrence' ? 'divide_conquer_recurrence' : parsed.family === 'graph_complexity' ? 'graph_complexity' : parsed.family === 'np_reduction' ? 'np_reduction' : 'other'

  if (family !== 'divide_conquer_recurrence' || !parsed.params) {
    return { result: { family }, attempt: { id: attemptId, ts: now, family, gate1Pass: null, reason: FAMILY_HAS_NUMERIC_GATE[family] ? 'nessun parametro estratto' : 'famiglia senza verifica numerica disponibile' } }
  }

  const p = parsed.params as Partial<RecurrenceParams>
  if (typeof p.a !== 'number' || typeof p.b !== 'number' || !p.fn || !p.declaredComplexity || typeof p.fnDescription !== 'string' || typeof p.context !== 'string') {
    return { result: { family: 'other' }, attempt: { id: attemptId, ts: now, family: 'other', gate1Pass: null, reason: 'parametri incompleti o malformati -- trattato come non classificabile' } }
  }

  const params: RecurrenceParams = {
    a: p.a,
    b: p.b,
    fn: p.fn,
    fnDescription: p.fnDescription,
    context: p.context,
    declaredCase: p.declaredCase,
    declaredComplexity: p.declaredComplexity,
  }
  const verification = verifyRecurrenceExample(params)
  return {
    result: { family, params, verification },
    attempt: { id: attemptId, ts: now, family, gate1Pass: verification.pass, reason: verification.reason },
  }
}

// ---- per-family reliability (2026-08-24) -------------------------------
// One rate would hide exactly the distinction point 5 asked for: a family
// with a real numeric gate failing often is a DIFFERENT finding from a
// family with no gate at all. Grouped by family, not flattened into one
// global percentage.
export interface FamilyStats {
  family: FormulaFamily
  hasNumericGate: boolean
  attempts: number
  gate1Passes: number
}

export function formulaExampleStats(attempts: FormulaGateAttempt[]): FamilyStats[] {
  const families = Array.from(new Set(attempts.map((a) => a.family)))
  return families.map((family) => ({
    family,
    hasNumericGate: FAMILY_HAS_NUMERIC_GATE[family],
    attempts: attempts.filter((a) => a.family === family).length,
    gate1Passes: attempts.filter((a) => a.family === family && a.gate1Pass === true).length,
  }))
}
