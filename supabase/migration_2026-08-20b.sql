-- Aria — migrazione mirata 2026-08-20b (riassunti per capitolo/materiale)
-- Da incollare nel SQL Editor di Supabase ed eseguire una volta -- idempotente,
-- sicura da rieseguire.

create table if not exists summaries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  chapter_id uuid references material_chapters(id) on delete set null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table summaries enable row level security;

drop policy if exists "own rows" on summaries;
create policy "own rows" on summaries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$
begin
  alter publication supabase_realtime add table summaries;
exception when duplicate_object then null;
end $$;
