-- Aria — migrazione mirata 2026-08-26 (Task.pageRange mai sincronizzato,
-- materials.area_of_interest mai dichiarata da nessuna parte, Cheat Study
-- linked materials)
-- Incolla per intero nel SQL Editor di Supabase ed esegui -- idempotente.
alter table tasks add column if not exists page_range jsonb;
alter table materials add column if not exists area_of_interest text;
alter table materials add column if not exists cheat_study_linked_ids uuid[];

create table if not exists cheat_study_exercises (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_material_id uuid not null references materials(id) on delete cascade,
  chapter_id uuid references material_chapters(id) on delete set null,
  section_id uuid,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table cheat_study_exercises enable row level security;
drop policy if exists "own rows" on cheat_study_exercises;
create policy "own rows" on cheat_study_exercises for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table material_chapters add column if not exists transcribed_text text;
