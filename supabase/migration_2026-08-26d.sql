-- Aria — migrazione mirata 2026-08-26d (Sezione di addestramento/verifica
-- skill, separata da Cheat Study: collega ogni output generato alla
-- chiamata skill che l'ha prodotto, aggiunge la "forma estratta" per i
-- materiali senza file persistito, il tag organic/training sugli eventi
-- skill, lo stato CROSS_USER_CANDIDATE, e una funzione server-side per
-- contare verifiche cross-utente rispettando il consenso -- vedi
-- src/lib/skills.ts e src/pages/SkillTraining.tsx per il codice che la usa.
-- Incolla per intero nel SQL Editor di Supabase ed esegui -- idempotente.

alter table cheat_study_solutions add column if not exists call_event_id uuid references skill_events(id) on delete set null;
alter table cheat_study_exercises add column if not exists call_event_id uuid references skill_events(id) on delete set null;
alter table cheat_study_prereqs add column if not exists call_event_id uuid references skill_events(id) on delete set null;

-- Organico (uso reale) vs training (sessione di addestramento skill
-- dedicata) -- null = organico, per compatibilità con ogni evento già
-- esistente prima di questa colonna (mai stato altro che uso reale).
alter table skill_events add column if not exists source text check (source in ('organic', 'training'));

-- 'CROSS_USER_CANDIDATE': stato intermedio, mai promosso direttamente a
-- VERIFIED -- vedi requiredCrossUserVerifications() in skills.ts.
alter table skills drop constraint if exists skills_status_check;
alter table skills add constraint skills_status_check check (status in ('DRAFT', 'VERIFIED', 'PERSONAL_NOTE', 'REJECTED', 'ARCHIVED', 'CROSS_USER_CANDIDATE'));

-- Manuale, indipendente dallo status (2026-08-26, "permetti la possibilità
-- di vedere queste skill personali e di attivarle o disattivarle") --
-- default true così ogni skill esistente resta recuperabile senza bisogno
-- di un backfill.
alter table skills add column if not exists active boolean not null default true;

-- Giudizio LLM esplicito "questa distillazione è davvero generica o è
-- legata al contenuto specifico caricato?" -- vedi classifyForSharing() in
-- skills.ts, che altrimenti bloccherebbe ogni skill del training a
-- 'personal' per via di domainClass('cheat_study')==='content'. Null =
-- non ancora giudicato (ogni skill pre-esistente a questa colonna, o non
-- distillata da un edit) -- classifyForSharing() tratta null come 'no'.
alter table skills add column if not exists sharing_eligible boolean;

-- "Forma estratta": non il contenuto/testo originale del file caricato in
-- questa sezione (mai persistito, vedi SkillTraining.tsx), solo una
-- rappresentazione strutturata piccola -- economia di storage reale e
-- provenienza minima per ogni skill distillata da questo materiale.
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
alter table cheat_study_extracted_shapes enable row level security;
drop policy if exists "own rows" on cheat_study_extracted_shapes;
create policy "own rows" on cheat_study_extracted_shapes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Conteggio verifiche cross-utente (2026-08-26) -- SECURITY DEFINER perché
-- deve vedere skill di ALTRI utenti per contarle, cosa che RLS ("own rows",
-- ogni tabella di questo schema) impedirebbe altrimenti a un client
-- normale. Ritorna SOLO numeri aggregati, mai il contenuto delle skill
-- altrui -- lo stesso principio "il contenuto non esce mai" applicato qui
-- lato server invece che sperare che il client filtri onestamente.
-- Corrispondenza v1 deliberatamente semplice ed esplicita (stesso dominio +
-- stesso testo esatto della skill) -- non cattura varianti riformulate
-- diversamente della stessa idea, limite noto e dichiarato, non un
-- tentativo di matching semantico fragile spacciato per preciso.
-- Filtra a monte su skill_sharing_consent (punto 7): un utente senza
-- consenso non entra MAI nel conteggio, non viene scartato dopo.
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

-- Denominatore reale per requiredCrossUserVerifications() (skills.ts) --
-- stesso principio "consenso applicato a monte" della funzione sopra: conta
-- SOLO profili con skill_sharing_consent = true, mai il totale utenti
-- grezzo (un utente senza consenso non deve mai gonfiare la soglia
-- richiesta, altrimenti la soglia scalerebbe su persone che non
-- parteciperanno mai alla verifica cross-utente).
create or replace function active_consenting_user_count()
returns int
language sql
security definer
set search_path = public
as $$
  select count(*)::int from profiles where skill_sharing_consent = true;
$$;
grant execute on function active_consenting_user_count() to authenticated;
