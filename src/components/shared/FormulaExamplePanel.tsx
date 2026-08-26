import { useState } from 'react'
import { Sparkles, Loader2, CircleCheck, CircleX, CircleHelp } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { GEMINI_MODEL } from '../../lib/gemini'
import { maybeDistillFromExchanges } from '../../lib/skills'
import { generateFormulaExample, unrollSteps, complexityLabel, FAMILY_LABEL, FAMILY_HAS_NUMERIC_GATE, type FormulaExampleResult } from '../../lib/formulaExamples'
import { MessageFeedback } from './MessageFeedback'
import type { SkillEvent } from '../../lib/types'

/**
 * "Genera esempio" action attached to every BLOCK formula in a summary
 * (2026-08-24, real user request). Two gates, never merged:
 *
 * Gate 1 (correttezza matematica) -- generateFormulaExample() calls Gemini
 * for classification + structured parameters ONLY (never for a verdict),
 * then runs a REAL numeric simulation locally (formulaExamples.ts's
 * verifyRecurrenceExample). An example that fails Gate 1 is never shown as
 * a worked example -- only its discard reason is, and the attempt is
 * logged either way (logFormulaGateAttempt) so per-family reliability
 * (see FAMILY_HAS_NUMERIC_GATE) is a real count, not a guess.
 *
 * Gate 2 (utilità pedagogica) -- ONLY reachable once Gate 1 has already
 * passed. Reuses the existing skill CALL/OUTCOME/distillation cycle
 * exactly as every other domain does (MessageFeedback -> recordSkillOutcome
 * -> maybeDistillFromExchanges), not a parallel promotion system.
 */
export function FormulaExamplePanel({ latex, context }: { latex: string; context: string }) {
  const logSkillCall = useAppStore((s) => s.logSkillCall)
  const addSkill = useAppStore((s) => s.addSkill)
  const logFormulaGateAttempt = useAppStore((s) => s.logFormulaGateAttempt)

  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<FormulaExampleResult | null>(null)
  const [callEvent, setCallEvent] = useState<SkillEvent | undefined>(undefined)

  async function generate() {
    setState('loading')
    try {
      const { result, attempt } = await generateFormulaExample(latex, context)
      logFormulaGateAttempt(attempt)
      setResult(result)
      setState('done')
      // Gate 2 only starts once Gate 1 has actually passed -- see the
      // module comment. A discarded or unverifiable example never gets a
      // CALL event, so it can never be reviewed into a "useful" skill.
      if (result.verification?.pass) {
        setCallEvent(logSkillCall('formula_example', 'B', [], GEMINI_MODEL))
      }
    } catch {
      setState('error')
    }
  }

  function onFeedbackGiven() {
    if (!callEvent || !result?.params) return
    const workedText = unrollSteps(result.params, 1000)
      .map((s) => `T(${s.n}) = ${result.params!.a}*T(${s.recurse}) + f(${s.n}) => ${s.total.toFixed(0)}`)
      .join('\n')
    maybeDistillFromExchanges(
      'formula_example',
      [
        { role: 'user', text: latex },
        { role: 'model', text: workedText, skillEventRef: callEvent.id },
      ],
      useAppStore.getState().skillEvents,
    )
      .then((candidate) => {
        if (!candidate) return
        // Family tag appended here, not derivable from tagsFromText(latex)
        // alone -- see formulaExamples.ts's FamilyStats for why per-family
        // tracking (point 5) needs this on the skill itself.
        addSkill({ ...candidate, capabilityTags: [...candidate.capabilityTags, `family:${result.family}`] })
      })
      .catch(() => {})
  }

  if (state === 'idle') {
    return (
      <button
        onClick={generate}
        className="my-1 flex items-center gap-1.5 text-xs font-medium text-[var(--color-primary)] hover:underline"
      >
        <Sparkles size={13} /> Genera esempio
      </button>
    )
  }

  if (state === 'loading') {
    return (
      <p className="my-1 flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
        <Loader2 size={13} className="animate-spin" /> Genero un esempio numerico...
      </p>
    )
  }

  if (state === 'error' || !result) {
    return (
      <p className="my-1 flex items-center gap-1.5 text-xs text-[var(--color-warn)]">
        <CircleX size={13} /> Non sono riuscita a generare un esempio. Riprova tra poco.
      </p>
    )
  }

  // Family with no numeric verifier at all (2026-08-24, point 5: "vanno
  // etichettate onestamente... non nascoste né spacciate per verificate").
  // Still shows a real worked example when the model produced one
  // (2026-08-26, real user report: outside the one algorithms recurrence
  // pilot, this always showed the bare disclaimer below and never any
  // actual content -- "esce sempre questo, non generando nessun
  // esercizio") -- just honestly labeled as unverified rather than upgraded
  // to look like a passed Gate 1.
  if (!FAMILY_HAS_NUMERIC_GATE[result.family]) {
    if (result.genericExample) {
      return (
        <div className="my-2 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)]">
            <CircleHelp size={13} /> Esempio non verificato numericamente ({FAMILY_LABEL[result.family]})
          </p>
          <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-[var(--color-ink)]">{result.genericExample}</p>
        </div>
      )
    }
    return (
      <p className="my-1 flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
        <CircleHelp size={13} /> {FAMILY_LABEL[result.family]}: non verificato a questo livello (nessun controllo numerico disponibile per questa famiglia).
      </p>
    )
  }

  const v = result.verification
  const params = result.params
  if (!v || !params) {
    return (
      <p className="my-1 flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
        <CircleHelp size={13} /> Non classificabile con sicurezza -- nessun esempio generato.
      </p>
    )
  }

  if (!v.pass) {
    return (
      <div className="my-2 rounded-lg border border-dashed border-[var(--color-warn)]/40 p-2.5 text-xs text-[var(--color-warn)]">
        <p className="flex items-center gap-1.5 font-medium">
          <CircleX size={13} /> Esempio scartato
        </p>
        <p className="mt-1 text-[var(--color-ink-muted)]">{v.reason}</p>
      </div>
    )
  }

  const steps = unrollSteps(params, 1000)

  return (
    <div className="my-2 rounded-lg border border-[var(--color-good)]/30 bg-[color-mix(in_srgb,var(--color-good)_6%,transparent)] p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-good)]">
        <CircleCheck size={13} /> Esempio verificato ({FAMILY_LABEL[result.family]})
      </p>
      <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
        {params.context} — a={params.a}, b={params.b}, f(n): {params.fnDescription} ({complexityLabel(params.fn)})
      </p>
      <p className="mt-1 text-xs text-[var(--color-ink)]">
        Complessità: <strong>{complexityLabel(params.declaredComplexity)}</strong>
        {params.declaredCase !== undefined ? ` (caso ${params.declaredCase})` : ''}
      </p>
      <div className="mt-2 overflow-x-auto rounded bg-[var(--color-surface-2)] p-2 font-mono text-[11px] leading-relaxed">
        {steps.slice(0, 5).map((s) => (
          <div key={s.n}>
            T({s.n}) = {params.a}·T({s.recurse}) + f({s.n}) → {s.total.toFixed(0)}
          </div>
        ))}
        {steps.length > 5 && <div className="text-[var(--color-ink-muted)]">... ({steps.length - 5} altri livelli)</div>}
      </div>
      {callEvent && <MessageFeedback callEvent={callEvent} onGiven={onFeedbackGiven} />}
    </div>
  )
}
