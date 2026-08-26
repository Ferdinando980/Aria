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
  -- Bumped ONLY when the actual file bytes change (2026-08-25), never on a
  -- rename/note-edit/annotation-save -- see materialFileCache.ts and
  -- types.ts's Material.fileUpdatedAt comment for why this has to be a
  -- separate column from the generic `updated_at` below.
  file_updated_at timestamptz,
  ai_notes text,
  annotation_data_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- area_of_interest: referenced by code (removeSubject's archive path,
-- hydrateFromRemote's archived/live discriminator) since that feature
-- shipped, but never actually declared anywhere in this file -- found live
-- 2026-08-26 via information_schema.columns while adding cheat_study_linked_ids
-- to this same table: the real DB was missing it too, not just this file.
-- syncUpsert's fail-open swallowed the error the whole time, so archiving a
-- material by deleting its subject has silently never synced.
alter table materials add column if not exists area_of_interest text;
-- Cheat Study (2026-08-26): materials explicitly linked to an exam-paper
-- material, opt-in session config -- see types.ts's Material.cheatStudyLinkedMaterialIds.
alter table materials add column if not exists cheat_study_linked_ids uuid[];
alter table materials add column if not exists file_updated_at timestamptz;
-- Cheat Study (2026-08-26, real user correction: "le tracce di esame NON
-- devono essere messe in materiale, non c'entrano un cazzo... dovrebbe
-- essere una cosa a parte"). True for a file uploaded through Cheat Study's
-- own dropzone -- see types.ts's Material.isExamPaper for the full
-- rationale (same storage/caching path as any other material, only the
-- surfacing in Materiali/Flashcards/Riassunti's pickers changes).
alter table materials add column if not exists is_exam_paper boolean;

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
-- Real bug found live (2026-08-26): Task.pageRange (types.ts, "studia pagine
-- X-Y" next to a study-plan-generated task, real user request 2026-08-24)
-- was never in this table -- addTask/updateTask/completeTask's syncUpsert
-- calls didn't send it either, so it existed only in memory until the next
-- hydrateFromRemote pull (which runs on every session refresh, not just
-- first login) silently wiped it, rebuilding the task from remote fields
-- that never included it. Same bug shape as this file's other "column added
-- to the client type, never given its own migration" incidents.
alter table tasks add column if not exists page_range jsonb;

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
-- Explicit ALTERs too, not just in the create-table body above (2026-08-25,
-- same bug class as events.type just below -- see migration_2026-08-25.sql
-- for how this one specifically went unnoticed for days: syncUpsert's
-- fail-open swallowed the PGRST204 until completeTask/applyXp started
-- syncing profiles for the first time).
alter table profiles add column if not exists research_consent boolean not null default true;
alter table profiles add column if not exists research_consent_at timestamptz;
alter table profiles add column if not exists skill_sharing_consent boolean not null default false;
alter table profiles add column if not exists skill_sharing_consent_at timestamptz;

-- Libreria di skill (Librarian) e log eventi/metriche — porta l'architettura
-- della ricerca Cognitive RPG dentro Aria. Vedi src/lib/skills.ts.
create table if not exists skills (
  -- text, not uuid (2026-08-24, real bug found live: "invalid input syntax
  -- for type uuid") -- seed/migrated skills use stable, human-readable ids
  -- ("seed_task_breakdown_first_step", "migrated_material_<uuid>") by
  -- design, so they don't duplicate on re-seed; a uuid column rejects them
  -- outright. See migration_2026-08-24c.sql for the fix on an existing DB.
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  version int not null default 1,
  title text not null,
  domain text not null check (domain in ('chat', 'task_breakdown', 'material_chat', 'study_plan', 'pdf_edit', 'material_knowledge', 'chapters', 'flashcards', 'summary', 'formula_example', 'cheat_study')),
  capability_tags text[] not null default '{}',
  content text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'VERIFIED', 'PERSONAL_NOTE', 'REJECTED', 'ARCHIVED', 'CROSS_USER_CANDIDATE')),
  -- Manual on/off, independent of status (2026-08-26) -- see skills.ts's
  -- routeSkills() and types.ts's Skill.active comment.
  active boolean not null default true,
  confidence real not null default 0,
  uses int not null default 0,
  successes int not null default 0,
  generation_method text not null default 'manual' check (generation_method in ('manual', 'distilled')),
  derived_from text,
  -- Referenced and synced by the app (useAppStore.ts, 5+ call sites) since
  -- material_knowledge existed (2026-08-21) but NEVER actually added here --
  -- found live 2026-08-25 when a real cleanup query hit "column material_id
  -- does not exist". Same bug class as events.type/skills.domain+status/
  -- profiles.research_consent, worse in effect: syncUpsert's fail-open meant
  -- every skill carrying either field silently never round-tripped to
  -- Supabase at all, not just this one column -- material_knowledge skills
  -- likely never synced across devices this whole time. `on delete set
  -- null`, not cascade -- removeMaterial() already ARCHIVES (not deletes)
  -- the matching skills in application code; a DB-level cascade would race
  -- that and could destroy a skill's content before the archive logic runs.
  material_id uuid references materials(id) on delete set null,
  area_of_interest text,
  -- LLM judgment "is this edit-distilled skill actually generic, or tied to
  -- the specific content uploaded" (2026-08-26) -- see classifyForSharing()
  -- in skills.ts. Null = not yet judged (every skill predating this column,
  -- or not distilled from a training edit) -- treated as 'no' there.
  sharing_eligible boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table skills add column if not exists material_id uuid references materials(id) on delete set null;
alter table skills add column if not exists area_of_interest text;
alter table skills add column if not exists sharing_eligible boolean;
-- schema_drift_check.mjs companions for the type change above (2026-08-24c,
-- verified already applied on the real DB -- see migration_2026-08-24c.sql):
-- these are no-ops there, but without them a brand-new project created
-- fresh from this file alone would get id/derived_from as uuid, not text.
alter table skills alter column id type text;
alter table skills alter column derived_from type text;
-- schema_drift_check.mjs companion for the CHECK constraint change above
-- (2026-08-26d, 'CROSS_USER_CANDIDATE' added -- see migration_2026-08-26d.sql):
-- no-op on a fresh install (the create table above already has the new
-- constraint), needed for an existing DB whose constraint predates it.
alter table skills drop constraint if exists skills_status_check;
alter table skills add constraint skills_status_check check (status in ('DRAFT', 'VERIFIED', 'PERSONAL_NOTE', 'REJECTED', 'ARCHIVED', 'CROSS_USER_CANDIDATE'));
alter table skills add column if not exists active boolean not null default true;

create table if not exists skill_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ts timestamptz not null default now(),
  domain text not null,
  config text not null check (config in ('F', 'B')),
  event_type text not null check (event_type in ('CALL', 'OUTCOME')),
  -- text[], not uuid[] -- same reason as skills.id above: an event whose
  -- skill_ids references a seed/migrated skill has non-uuid ids in the array.
  skill_ids text[] not null default '{}',
  ref text not null default '',
  outcome text check (outcome in ('positive', 'negative')),
  -- Exact Gemini model string used for this CALL (2026-08-20) -- so a
  -- silent model change can be spotted by diffing this field over time,
  -- the same confound that hit the Python research's first real run.
  model text,
  -- 'organic' (real usage) vs 'training' (the dedicated skill-training
  -- section, 2026-08-26) -- null means organic, for every event that
  -- predates this column, which was never anything else.
  source text check (source in ('organic', 'training'))
);
alter table skill_events add column if not exists model text;
alter table skill_events add column if not exists source text check (source in ('organic', 'training'));

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
-- Cheat Study image support (2026-08-26): set only for a chapter detected
-- from a photo/scan (Gemini vision transcribed it directly, no real PDF
-- page behind it) -- see types.ts's MaterialChapter.transcribedText.
alter table material_chapters add column if not exists transcribed_text text;

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

-- Cheat Study (2026-08-25): un esercizio (chapter/section di un materiale
-- usato COME traccia d'esame, riusando il rilevamento capitoli esistente
-- invece di un concetto "esame" separato) + la sua soluzione spiegata,
-- generata sul materiale di studio VERO trovato per overlap di tag nella
-- stessa materia -- mai sul solo testo dell'esercizio. Stessa forma di
-- summaries apposta, stesso pattern un-solo-record-per-scope.
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

-- Sibling table (2026-08-26, real user correction: "e ti permette di
-- generare esercizi equivalenti") -- same shape, same scoping triple, a
-- second Cheat Study output shown alongside the solution, not instead of it.
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

-- Third sibling table (2026-08-26, real user request: "ti crea gli esercizi
-- base per arrivare a svolgere l'esercizio proposto... partire dalle piccole
-- cose, adatto a persone con ADHD") -- same shape/scoping triple again,
-- content is markdown text (same "## Esercizio base N" + [LABEL] convention
-- as solutions/exercises), not a separate JSON structure.
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

-- Collega ogni output al vero SkillEvent CALL che l'ha generato (2026-08-26,
-- sezione di addestramento skill) -- senza questo, dare un esito su un
-- esercizio riaperto più tardi (non appena generato) non ha nulla a cui
-- agganciarsi: prima viveva solo in stato React locale, perso al reload.
alter table cheat_study_solutions add column if not exists call_event_id uuid references skill_events(id) on delete set null;
alter table cheat_study_exercises add column if not exists call_event_id uuid references skill_events(id) on delete set null;
alter table cheat_study_prereqs add column if not exists call_event_id uuid references skill_events(id) on delete set null;

-- "Forma estratta" (2026-08-26, sezione di addestramento skill): il file
-- caricato lì non viene mai persistito (né su Storage né come base64) --
-- solo questa rappresentazione strutturata piccola, per economia di storage
-- reale e provenienza minima di ogni skill distillata da quel materiale.
create table if not exists cheat_study_extracted_shapes (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  format text,
  has_multiple_choice boolean not null default false,
  diagram_types text[] not null default '{}',
  detected_pattern text,
  created_at timestamptz not null default now()
);

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
alter table cheat_study_solutions enable row level security;
alter table cheat_study_exercises enable row level security;
alter table cheat_study_prereqs enable row level security;
alter table cheat_study_extracted_shapes enable row level security;

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
create policy "own rows" on cheat_study_solutions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own rows" on cheat_study_exercises;
create policy "own rows" on cheat_study_exercises for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own rows" on cheat_study_prereqs;
create policy "own rows" on cheat_study_prereqs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own rows" on text_edits;
create policy "own rows" on text_edits for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own rows" on cheat_study_extracted_shapes;
create policy "own rows" on cheat_study_extracted_shapes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Conteggio verifiche cross-utente (2026-08-26, sezione di addestramento
-- skill) -- SECURITY DEFINER perché deve vedere skill di ALTRI utenti per
-- contarle, cosa che le policy RLS "own rows" sopra impedirebbero
-- altrimenti a un client normale. Ritorna SOLO numeri aggregati, mai il
-- contenuto delle skill altrui. Corrispondenza v1 deliberatamente semplice
-- (stesso dominio + stesso testo esatto) -- limite noto e dichiarato, non
-- un tentativo di matching semantico spacciato per preciso. Filtra a monte
-- su skill_sharing_consent (mai dopo il confronto).
create or replace function cross_user_verification_count(p_skill_id text)
returns table(verification_count int, distinct_user_count int)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(other.successes), 0)::int as verification_count,
    count(distinct other.user_id)::int as distinct_user_count
  from skills mine
  join skills other
    on other.domain = mine.domain
    and other.content = mine.content
    and other.user_id <> mine.user_id
    and other.status in ('PERSONAL_NOTE', 'CROSS_USER_CANDIDATE', 'VERIFIED')
  join profiles p on p.user_id = other.user_id and p.skill_sharing_consent = true
  where mine.id = p_skill_id;
$$;
grant execute on function cross_user_verification_count(text) to authenticated;

-- Denominatore reale per requiredCrossUserVerifications() (skills.ts,
-- 2026-08-26) -- stesso principio "consenso applicato a monte" della
-- funzione sopra: conta SOLO profili con skill_sharing_consent = true, mai
-- il totale utenti grezzo.
create or replace function active_consenting_user_count()
returns int
language sql
security definer
set search_path = public
as $$
  select count(*)::int from profiles where skill_sharing_consent = true;
$$;
grant execute on function active_consenting_user_count() to authenticated;

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
