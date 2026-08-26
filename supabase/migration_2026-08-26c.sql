-- Aria — migrazione mirata 2026-08-26c (Cheat Study: terzo output "Esercizi
-- di base" -- ladder di esercizi propedeutici per arrivare all'esercizio
-- della traccia, stessa forma/scoping di cheat_study_solutions/exercises)
-- Incolla per intero nel SQL Editor di Supabase ed esegui -- idempotente.
create table if not exists cheat_study_prereqs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_material_id uuid not null references materials(id) on delete cascade,
  chapter_id uuid references material_chapters(id) on delete set null,
  section_id uuid,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table cheat_study_prereqs enable row level security;

drop policy if exists "own rows" on cheat_study_prereqs;
create policy "own rows" on cheat_study_prereqs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
