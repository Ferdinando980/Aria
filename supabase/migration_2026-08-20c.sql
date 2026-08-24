-- Aria — migrazione mirata 2026-08-20c (modifica testo visiva sul PDF)
-- Incolla per intero nel SQL Editor di Supabase ed esegui -- idempotente.

create table if not exists text_edits (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  page int not null,
  x double precision not null,
  y double precision not null,
  width double precision not null,
  height double precision not null,
  replacement text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table text_edits enable row level security;

drop policy if exists "own rows" on text_edits;
create policy "own rows" on text_edits for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$
begin
  alter publication supabase_realtime add table text_edits;
exception when duplicate_object then null;
end $$;
