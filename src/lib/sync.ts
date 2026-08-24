import { supabase, isSupabaseConfigured } from './supabase'

// Write-through sync: local (zustand+localStorage) is always the source of
// truth for instant UI feedback (critical for ADHD — never wait on a
// network round-trip to see your own click register). When Supabase is
// configured and the user is logged in, every mutation is mirrored to
// Postgres in the background so PC and mobile stay in sync.

export function canSync(userId: string | undefined): userId is string {
  return isSupabaseConfigured && Boolean(userId) && Boolean(supabase)
}

// Returns false on any failure (network throw OR a Postgrest-level `.error`,
// e.g. a CHECK constraint violation) so a caller that cares can react --
// existing call sites that don't await/check this are unaffected (2026-08-24
// fix: previously this only caught thrown exceptions and silently ignored
// `.error`, so a constraint violation logged nothing at all, not even the
// existing console.warn -- see CLAUDE.md's skills.domain/status note).
export async function syncUpsert(table: string, userId: string, row: Record<string, unknown>): Promise<boolean> {
  if (!supabase) return false
  try {
    const { error } = await supabase.from(table).upsert({ ...row, user_id: userId })
    if (error) {
      console.error(`[sync] upsert ${table} failed`, error)
      return false
    }
    return true
  } catch (err) {
    console.warn(`[sync] upsert ${table} failed`, err)
    return false
  }
}

export async function syncDelete(table: string, userId: string, id: string): Promise<boolean> {
  if (!supabase) return false
  try {
    const { error } = await supabase.from(table).delete().eq('id', id).eq('user_id', userId)
    if (error) {
      console.error(`[sync] delete ${table} failed`, error)
      return false
    }
    return true
  } catch (err) {
    console.warn(`[sync] delete ${table} failed`, err)
    return false
  }
}

export async function syncPushAll(
  userId: string,
  data: {
    subjects: import('./types').Subject[]
    materials: import('./types').Material[]
    tasks: import('./types').Task[]
    events: import('./types').CalendarEvent[]
    profile: import('./types').ProfileState
    skills: import('./types').Skill[]
    skillEvents: import('./types').SkillEvent[]
    highlights: import('./types').MaterialHighlight[]
    chapters: import('./types').MaterialChapter[]
    flashcards: import('./types').Flashcard[]
    summaries: import('./types').MaterialSummary[]
    textEdits: import('./types').TextEdit[]
  },
): Promise<{ ok: boolean; failedTables: string[] }> {
  if (!supabase) return { ok: false, failedTables: [] }
  const db = supabase

  // Per-ROW, not per-table-batch (2026-08-24, generalized after the
  // skills.domain/status CHECK constraint bug -- see CLAUDE.md). The
  // original version did one multi-row upsert per table: a single bad row
  // (a CHECK violation, for instance) fails a Postgres multi-row upsert
  // statement ATOMICALLY, so one skill in an unrecognized domain could
  // silently take twenty good ones down with it, table-wide. First fixed
  // only for `skills` (resyncSkillsForDomainFix), then generalized here to
  // every table: at this app's real scale (a handful of users, dozens to
  // low hundreds of rows per table) the extra HTTP requests from per-row
  // upserts cost nothing worth trading away the isolation for. Also: the
  // old version never looked at any result's `.error` at all -- Supabase-js
  // resolves `{data, error}` on a rejected row instead of throwing, so a
  // constraint violation was invisible even to the try/catch, not just
  // under-logged. `failedTables` (now a count-carrying set, one entry can
  // still fail without its table-mates) lets a caller (App.tsx's
  // first-login push, or a manual "risincronizza" action) know a resync is
  // still needed instead of marking the push done regardless.
  const entries: [string, PromiseLike<{ error: { message: string } | null }>][] = []
  const pushRow = (table: string, row: Record<string, unknown>) => entries.push([table, db.from(table).upsert(row)])

  for (const s of data.subjects) pushRow('subjects', { id: s.id, user_id: userId, name: s.name, color: s.color, icon: s.icon })
  for (const m of data.materials) {
    pushRow('materials', {
      id: m.id,
      user_id: userId,
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
    })
  }
  for (const t of data.tasks) {
    pushRow('tasks', {
      id: t.id,
      user_id: userId,
      subject_id: t.subjectId,
      title: t.title,
      description: t.description,
      due_date: t.dueDate,
      done: t.done,
      done_at: t.doneAt,
      priority: t.priority,
      estimate_minutes: t.estimateMinutes,
      subtasks: t.subtasks,
    })
  }
  for (const e of data.events) {
    pushRow('events', {
      id: e.id,
      user_id: userId,
      subject_id: e.subjectId,
      task_id: e.taskId,
      title: e.title,
      start: e.start,
      end: e.end,
      all_day: e.allDay ?? false,
      color: e.color,
      notes: e.notes,
      type: e.type,
    })
  }
  pushRow('profiles', {
    user_id: userId,
    display_name: data.profile.displayName,
    xp: data.profile.xp,
    level: data.profile.level,
    streak_count: data.profile.streakCount,
    last_active_date: data.profile.lastActiveDate,
    streak_freezes: data.profile.streakFreezes,
    research_consent: data.profile.researchConsent ?? true, // see useAppStore.ts's hydrateFromRemote comment -- never push a silent false
    research_consent_at: data.profile.researchConsentAt,
    skill_sharing_consent: data.profile.skillSharingConsent ?? false,
    skill_sharing_consent_at: data.profile.skillSharingConsentAt,
  })
  for (const sk of data.skills) {
    pushRow('skills', {
      id: sk.id,
      user_id: userId,
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
      created_at: sk.createdAt, // real local timestamps -- see useAppStore.ts's resyncSkillsForDomainFix comment
      updated_at: sk.updatedAt,
    })
  }
  for (const e of data.skillEvents) {
    pushRow('skill_events', {
      id: e.id,
      user_id: userId,
      ts: e.ts,
      domain: e.domain,
      config: e.config,
      event_type: e.eventType,
      skill_ids: e.skillIds,
      ref: e.ref,
      outcome: e.outcome,
      model: e.model,
    })
  }
  for (const h of data.highlights) {
    pushRow('material_highlights', {
      id: h.id,
      user_id: userId,
      material_id: h.materialId,
      page: h.page,
      text: h.text,
      rects: h.rects,
      note: h.note,
      color: h.color,
    })
  }
  for (const c of data.chapters) {
    pushRow('material_chapters', {
      id: c.id,
      user_id: userId,
      material_id: c.materialId,
      title: c.title,
      start_page: c.startPage,
      end_page: c.endPage,
      order: c.order,
      subsections: c.subsections,
    })
  }
  for (const f of data.flashcards) {
    pushRow('flashcards', { id: f.id, user_id: userId, material_id: f.materialId, chapter_id: f.chapterId, section_id: f.sectionId, front: f.front, back: f.back, suspended: f.suspended ?? false })
  }
  for (const s of data.summaries) {
    pushRow('summaries', { id: s.id, user_id: userId, material_id: s.materialId, chapter_id: s.chapterId, section_id: s.sectionId, content: s.content })
  }
  for (const t of data.textEdits) {
    pushRow('text_edits', {
      id: t.id,
      user_id: userId,
      material_id: t.materialId,
      page: t.page,
      x: t.x,
      y: t.y,
      width: t.width,
      height: t.height,
      replacement: t.replacement,
    })
  }

  try {
    const results = await Promise.all(entries.map(([, req]) => req))
    const failedTables = Array.from(new Set(entries.filter((_, i) => results[i].error).map(([table]) => table)))
    for (let i = 0; i < entries.length; i++) {
      if (results[i].error) console.error(`[sync] push row in ${entries[i][0]} failed`, results[i].error)
    }
    return { ok: failedTables.length === 0, failedTables }
  } catch (err) {
    console.warn('[sync] initial push failed', err)
    return { ok: false, failedTables: Array.from(new Set(entries.map(([table]) => table))) }
  }
}

export async function syncPullAll(userId: string) {
  if (!supabase) return null
  const [subjects, materials, tasks, events, profile, skills, skillEvents, highlights, chapters, flashcards, summaries, textEdits] = await Promise.all([
    supabase.from('subjects').select('*').eq('user_id', userId),
    supabase.from('materials').select('*').eq('user_id', userId),
    supabase.from('tasks').select('*').eq('user_id', userId),
    supabase.from('events').select('*').eq('user_id', userId),
    supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('skills').select('*').eq('user_id', userId),
    supabase.from('skill_events').select('*').eq('user_id', userId),
    supabase.from('material_highlights').select('*').eq('user_id', userId),
    supabase.from('material_chapters').select('*').eq('user_id', userId),
    supabase.from('flashcards').select('*').eq('user_id', userId),
    supabase.from('summaries').select('*').eq('user_id', userId),
    supabase.from('text_edits').select('*').eq('user_id', userId),
  ])
  return {
    subjects: subjects.data ?? [],
    materials: materials.data ?? [],
    tasks: tasks.data ?? [],
    events: events.data ?? [],
    profile: profile.data,
    skills: skills.data ?? [],
    skillEvents: skillEvents.data ?? [],
    highlights: highlights.data ?? [],
    chapters: chapters.data ?? [],
    flashcards: flashcards.data ?? [],
    summaries: summaries.data ?? [],
    textEdits: textEdits.data ?? [],
  }
}
