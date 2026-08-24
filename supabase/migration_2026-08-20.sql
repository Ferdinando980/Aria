-- Aria — migrazione mirata 2026-08-20 (evidenziazioni PDF, capitoli, flashcard, esami)
-- Da incollare nel SQL Editor di Supabase ED ESEGUIRE UNA VOLTA -- sicura da
-- rieseguire più volte se serve (ogni pezzo è idempotente).

-- 1) Colonna 'type' su events (mancava: era dentro un create-table-if-not-exists
--    che su una tabella già esistente non fa nulla).
alter table events add column if not exists type text default 'evento' check (type in ('evento', 'esame'));

-- 2) Le 3 tabelle nuove (no-op se già create dal run parziale precedente).
create table if not exists material_highlights (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  page int not null,
  text text not null,
  rects jsonb not null default '[]',
  note text,
  color text not null default '#fdcb6e',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists material_chapters (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  title text not null,
  start_page int not null,
  end_page int not null,
  "order" int not null default 0,
  subsections jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists flashcards (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  chapter_id uuid references material_chapters(id) on delete set null,
  front text not null,
  back text not null,
  created_at timestamptz not null default now()
);

-- 3) RLS + policy (drop-if-exists prima, così è sicuro rieseguirlo).
alter table material_highlights enable row level security;
alter table material_chapters enable row level security;
alter table flashcards enable row level security;

drop policy if exists "own rows" on material_highlights;
create policy "own rows" on material_highlights for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on material_chapters;
create policy "own rows" on material_chapters for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on flashcards;
create policy "own rows" on flashcards for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4) Realtime -- solo le 3 tabelle nuove, una per una con gestione errore se
--    per caso una fosse già stata aggiunta (evita di fermarsi come prima).
do $$
begin
  alter publication supabase_realtime add table material_highlights;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table material_chapters;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table flashcards;
exception when duplicate_object then null;
end $$;
