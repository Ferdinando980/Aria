-- Aria — migrazione mirata 2026-08-24 (consenso condivisione skill, stato
-- PERSONAL_NOTE, e due CHECK constraint su `skills` rimasti indietro rispetto
-- al codice da quando sono stati aggiunti nuovi domini/stati).
-- Incolla per intero nel SQL Editor di Supabase ed esegui -- idempotente.

alter table profiles add column if not exists skill_sharing_consent boolean not null default false;
alter table profiles add column if not exists skill_sharing_consent_at timestamptz;

-- `domain` check era rimasto a ('chat','task_breakdown','material_chat',
-- 'study_plan') da PRIMA che pdf_edit/material_knowledge/chapters/flashcards/
-- summary esistessero (2026-08-21) -- ogni skill in uno di quei 5 domini ha
-- silenziosamente fallito la sync verso Supabase da allora (syncUpsert fallisce
-- "aperto": cattura l'errore, non blocca l'app, ma non sincronizza la riga).
-- Stessa cosa per `status`: 'ARCHIVED' viene letto/scritto sulla stessa tabella
-- (vedi useAppStore.ts, split per status su hydrate) ma non era mai stato
-- nel check; 'PERSONAL_NOTE' è nuovo di oggi (vedi types.ts SkillStatus).
alter table skills drop constraint if exists skills_domain_check;
alter table skills add constraint skills_domain_check
  check (domain in ('chat', 'task_breakdown', 'material_chat', 'study_plan', 'pdf_edit', 'material_knowledge', 'chapters', 'flashcards', 'summary'));

alter table skills drop constraint if exists skills_status_check;
alter table skills add constraint skills_status_check
  check (status in ('DRAFT', 'VERIFIED', 'PERSONAL_NOTE', 'REJECTED', 'ARCHIVED'));
