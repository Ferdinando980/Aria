import { supabase, isSupabaseConfigured } from './supabase'
import { uid, nowIso } from './utils'
import type { SkillDomain, SkillEvent, SkillOutcome } from './types'

/**
 * Real-usage metrics log — port of cognitive_rpg/experiment/events.py's
 * emit(). Every Gemini call instrumented with the skill library logs a CALL
 * event (which skills were retrieved, F/B config); every later behavioral
 * signal (task completed, plan followed, thumbs up/down) logs an OUTCOME
 * event tied back to it via `ref`. This is the data "test sul campo" is
 * meant to produce — exportable from Settings without needing synthetic
 * experiment calls.
 */

// `source` (2026-08-26): undefined/omitted means 'organic' (real usage) --
// only the skill-training section (SkillTraining.tsx) ever passes
// 'training' explicitly. See SkillEvent.source's comment in types.ts.
export function logCall(domain: SkillDomain, config: 'F' | 'B', skillIds: string[], model: string, source?: 'organic' | 'training'): SkillEvent {
  return { id: uid(), ts: nowIso(), domain, config, eventType: 'CALL', skillIds, ref: '', model, source }
}

export function logOutcome(callEvent: SkillEvent, outcome: SkillOutcome, source?: 'organic' | 'training'): SkillEvent {
  return {
    id: uid(),
    ts: nowIso(),
    domain: callEvent.domain,
    config: callEvent.config,
    eventType: 'OUTCOME',
    skillIds: callEvent.skillIds,
    ref: callEvent.id,
    outcome,
    source: source ?? callEvent.source,
  }
}

export async function syncSkillEvent(userId: string | undefined, event: SkillEvent) {
  if (!isSupabaseConfigured || !userId || !supabase) return
  try {
    await supabase.from('skill_events').insert({
      id: event.id,
      user_id: userId,
      ts: event.ts,
      domain: event.domain,
      config: event.config,
      event_type: event.eventType,
      skill_ids: event.skillIds,
      ref: event.ref,
      outcome: event.outcome,
      model: event.model,
      source: event.source,
    })
  } catch (err) {
    console.warn('[skillEvents] sync failed', err)
  }
}
