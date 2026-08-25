-- Aria — migrazione mirata 2026-08-25d (Cheat Study)
-- Incolla per intero nel SQL Editor di Supabase ed esegui -- idempotente.
--
-- Nuova tabella per le soluzioni spiegate di Cheat Study + il dominio
-- 'cheat_study' aggiunto al CHECK esistente su skills.domain. Eseguita
-- SUBITO sul progetto reale, non solo scritta qui -- vedi schema_drift_check.mjs
-- e la lezione del 2026-08-24/25 sulle colonne/domini aggiunti al codice ma
-- mai applicati al DB esistente.

create table if not exists cheat_study_solutions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_material_id uuid not null references materials(id) on delete cascade,
  chapter_id uuid references material_chapters(id) on delete set null,
  section_id uuid,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table cheat_study_solutions enable row level security;
drop policy if exists "own rows" on cheat_study_solutions;
create policy "own rows" on cheat_study_solutions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table skills drop constraint if exists skills_domain_check;
alter table skills add constraint skills_domain_check
  check (domain in ('chat', 'task_breakdown', 'material_chat', 'study_plan', 'pdf_edit', 'material_knowledge', 'chapters', 'flashcards', 'summary', 'formula_example', 'cheat_study'));
