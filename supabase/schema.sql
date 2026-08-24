-- Aria — schema Supabase
-- Incolla questo intero file nel SQL Editor del tuo progetto Supabase
-- (https://app.supabase.com -> il tuo progetto -> SQL Editor -> New query) ed esegui "Run".

create table if not exists subjects (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#6C5CE7',
  icon text not null default 'book',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists materials (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references subjects(id) on delete set null,
  type text not null check (type in ('link', 'note', 'file')),
  title text not null,
  url text,
  content text,
  file_name text,
  file_data_url text,
  file_path text,
  ai_notes text,
  annotation_data_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references subjects(id) on delete set null,
  title text not null,
  description text,
  due_date date,
  done boolean not null default false,
  done_at timestamptz,
  priority text not null default 'media' check (priority in ('bassa', 'media', 'alta')),
  estimate_minutes int,
  subtasks jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references subjects(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  title text not null,
  start timestamptz not null,
  "end" timestamptz,
  all_day boolean not null default false,
  color text,
  notes text,
  -- 'esame' marks a deadline the study plan generator looks up to pace
  -- itself against (2026-08-20) -- absent/'evento' for a normal event.
  type text default 'evento' check (type in ('evento', 'esame')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Explicit ALTER too, not just in the create-table body above: on a project
-- where `events` already existed before this column was added, the
-- create-table-if-not-exists is a no-op and never touches it.
alter table events add column if not exists type text default 'evento' check (type in ('evento', 'esame'));

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Tu',
  xp int not null default 0,
  level int not null default 1,
  streak_count int not null default 0,
  last_active_date date,
  streak_freezes int not null default 2,
  -- Consenso esplicito alla ricerca (2026-08-20, aggiunto PRIMA che esistano
  -- utenti diversi dalla prima, non recuperato dopo): opt-in, default false.
  -- Qualunque query/script che aggrega skills/skill_events TRA utenti diversi
  -- (non la vista personale del singolo utente sui propri dati, sempre
  -- consentita) deve filtrare su research_consent = true. Il contenuto delle
  -- skill (specialmente material_chat, che può contenere note personali) non
  -- va incluso in export aggregati anche per chi ha dato consenso -- solo
  -- metadati (domain, config, outcome, skill_ids) sono pensati per l'uso
  -- aggregato multi-utente.
  research_consent boolean not null default false,
  research_consent_at timestamptz,
  -- Distinto da research_consent (2026-08-24): quello copre analisi
  -- aggregate su EVENTI d'uso; questo copre il CONTENUTO delle skill reso
  -- visibile ad altri account. Opt-in, default false anche per chi ha dato
  -- research_consent. Nessuna pipeline di condivisione lo legge ancora --
  -- vedi src/lib/skills.ts's domainClass() e types.ts's SkillDomain.
  skill_sharing_consent boolean not null default false,
  skill_sharing_consent_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Libreria di skill (Librarian) e log eventi/metriche — porta l'architettura
-- della ricerca Cognitive RPG dentro Aria. Vedi src/lib/skills.ts.
create table if not exists skills (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  version int not null default 1,
  title text not null,
  domain text not null check (domain in ('chat', 'task_breakdown', 'material_chat', 'study_plan', 'pdf_edit', 'material_knowledge', 'chapters', 'flashcards', 'summary')),
  capability_tags text[] not null default '{}',
  content text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'VERIFIED', 'PERSONAL_NOTE', 'REJECTED', 'ARCHIVED')),
  confidence real not null default 0,
  uses int not null default 0,
  successes int not null default 0,
  generation_method text not null default 'manual' check (generation_method in ('manual', 'distilled')),
  derived_from uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists skill_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ts timestamptz not null default now(),
  domain text not null,
  config text not null check (config in ('F', 'B')),
  event_type text not null check (event_type in ('CALL', 'OUTCOME')),
  skill_ids uuid[] not null default '{}',
  ref text not null default '',
  outcome text check (outcome in ('positive', 'negative')),
  -- Exact Gemini model string used for this CALL (2026-08-20) -- so a
  -- silent model change can be spotted by diffing this field over time,
  -- the same confound that hit the Python research's first real run.
  model text
);

-- Evidenziazioni PDF ("collegamenti", 2026-08-20) -- vedi src/lib/pdfHighlights.ts,
-- components/materials/PdfViewer.tsx. `rects` è la selezione reale catturata al
-- momento dell'evidenziazione (in unità di pagina non scalate, scale=1), non
-- una posizione ricalcolata dal testo -- resta ancorata a quel punto preciso,
-- non a ogni occorrenza della stessa parola nel documento.
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

-- Capitoli PDF per intervallo di pagine (2026-08-20), auto-rilevati una volta
-- e poi cache -- vedi lib/gemini.ts generateChapters, MaterialChapter in
-- types.ts. `subsections` e' un array di {id,title,startPage,endPage}.
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

-- Flashcard generate da un materiale, opzionalmente scoped a un capitolo
-- (chapter_id null = generate dall'intero materiale). Revisionate con lo
-- stesso scheduler SM-2 gia' usato per "Ripasso lampo" (retrievalReviews),
-- non una tabella di scheduling separata.
create table if not exists flashcards (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  chapter_id uuid references material_chapters(id) on delete set null,
  section_id uuid, -- one of chapter_id's subsections (ChapterSection.id, not its own table) -- null = whole chapter, not "whole material" (2026-08-21: flashcards are always chapter-scoped now)
  front text not null,
  back text not null,
  created_at timestamptz not null default now(),
  suspended boolean not null default false
);
alter table flashcards add column if not exists section_id uuid;
alter table flashcards add column if not exists suspended boolean not null default false;

-- Riassunti per capitolo o singola sotto-sezione (2026-08-20, sectioned
-- 2026-08-21), sezione a parte dalle flashcard -- section_id null = intero
-- capitolo. Un solo riassunto per (material_id, chapter_id, section_id):
-- rigenerare sovrascrive
-- quello esistente invece di accumularli.
create table if not exists summaries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  chapter_id uuid references material_chapters(id) on delete set null,
  section_id uuid,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table summaries add column if not exists section_id uuid;

-- Correzioni visive di testo sul PDF ("modifica testo", 2026-08-20) -- NON
-- riscrive il file PDF: copre il testo originale con un rettangolo e disegna
-- la sostituzione sopra al momento del rendering. Vedi TextEdit in types.ts
-- per il limite noto (il text layer sotto resta quello originale).
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

-- Punteggi del minigioco pausa: leggibili da tutti (classifica), scrivibili solo dal proprio utente.
create table if not exists game_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Giocatore',
  score int not null,
  created_at timestamptz not null default now()
);

alter table subjects enable row level security;
alter table materials enable row level security;
alter table tasks enable row level security;
alter table events enable row level security;
alter table profiles enable row level security;
alter table game_scores enable row level security;
alter table skills enable row level security;
alter table skill_events enable row level security;
alter table material_highlights enable row level security;
alter table material_chapters enable row level security;
alter table flashcards enable row level security;
alter table summaries enable row level security;
alter table text_edits enable row level security;

-- drop-if-exists prima di ogni create policy: questo file è pensato per
-- essere rieseguibile su un progetto che ha già parte delle tabelle (2026-08-20,
-- dopo che un run parziale si è fermato qui con "policy already exists" --
-- create policy non supporta "if not exists" in Postgres).
drop policy if exists "own rows" on subjects;
create policy "own rows" on subjects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own rows" on materials;
create policy "own rows" on materials for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own rows" on tasks;
create policy "own rows" on tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own rows" on events;
create policy "own rows" on events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own rows" on profiles;
create policy "own rows" on profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "insert own score" on game_scores;
create policy "insert own score" on game_scores for insert with check (auth.uid() = user_id);
drop policy if exists "read all scores" on game_scores;
create policy "read all scores" on game_scores for select using (true);
drop policy if exists "own rows" on skills;
create policy "own rows" on skills for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own rows" on skill_events;
create policy "own rows" on skill_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own rows" on material_highlights;
create policy "own rows" on material_highlights for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own rows" on material_chapters;
create policy "own rows" on material_chapters for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own rows" on flashcards;
create policy "own rows" on flashcards for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own rows" on summaries;
create policy "own rows" on summaries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own rows" on text_edits;
create policy "own rows" on text_edits for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime (per il sync live tra PC e mobile) -- una tabella alla volta con
-- gestione errore: "alter publication add table" non supporta "if not
-- exists" e altrimenti si ferma alla prima già presente, come le policy sopra.
do $$
declare
  t text;
begin
  foreach t in array array['subjects','materials','tasks','events','profiles','game_scores','skills','skill_events','material_highlights','material_chapters','flashcards','summaries','text_edits']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Bucket per i file dei materiali: privato, ogni utente vede/scrive solo dentro la propria cartella (uid/...)
insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

drop policy if exists "own files select" on storage.objects;
create policy "own files select" on storage.objects for select
  using (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "own files insert" on storage.objects;
create policy "own files insert" on storage.objects for insert
  with check (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "own files update" on storage.objects;
create policy "own files update" on storage.objects for update
  using (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "own files delete" on storage.objects;
create policy "own files delete" on storage.objects for delete
  using (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);
