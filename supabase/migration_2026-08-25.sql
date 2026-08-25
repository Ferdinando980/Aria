-- Aria — migrazione mirata 2026-08-25 (research_consent mai arrivata su
-- profiles, stesso bug di classe di events.type/skill_sharing_consent)
-- Incolla per intero nel SQL Editor di Supabase ed esegui -- idempotente.
--
-- Causa reale, trovata dal vivo (non ipotizzata) verificando la feature del
-- piano diviso per giorno sul calendario: completeTask()/applyXp() non
-- sincronizzavano affatto su Supabase (fix separato in useAppStore.ts),
-- corretto oggi -- ma il primo vero tentativo di sync su profiles ha
-- fallito con PGRST204 "Could not find the 'research_consent' column".
-- Verificato via information_schema.columns: la colonna non esiste
-- davvero, non è una cache PostgREST stantia. `research_consent` è nel
-- corpo del `create table if not exists profiles` di schema.sql dal
-- 2026-08-20, ma quel file non aveva mai avuto l'ALTER esplicito
-- compagno per un progetto dove `profiles` esisteva già -- lo stesso
-- identico bug di `events.type` (che invece l'ALTER esplicito ce l'ha) e
-- di `skill_sharing_consent` (idem, in migration_2026-08-24.sql). Il
-- fail-open di syncUpsert ha nascosto questo per giorni senza errore
-- visibile, fino a che completeTask/applyXp non hanno iniziato a
-- sincronizzare profiles per la prima volta oggi.

alter table profiles add column if not exists research_consent boolean not null default true;
alter table profiles add column if not exists research_consent_at timestamptz;
