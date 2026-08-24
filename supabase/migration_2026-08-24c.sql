-- Aria — migrazione mirata 2026-08-24c (id delle skill: uuid -> text, e
-- CHECK di skills.domain allargato a formula_example)
-- Incolla per intero nel SQL Editor di Supabase ed esegui -- idempotente.
--
-- Causa reale del "Sincronizza skill non funziona", trovata nei log console
-- (non ipotizzata): ogni upsert su skills/skill_events per una skill seed o
-- migrata falliva con "invalid input syntax for type uuid" -- id come
-- "seed_task_breakdown_first_step" o "migrated_material_<uuid>" sono
-- stringhe leggibili volute (stabili, per non duplicare al re-seed), non
-- UUID veri, ma le colonne skills.id, skills.derived_from e
-- skill_events.skill_ids erano tipizzate uuid/uuid[]. Nessuna migrazione
-- precedente (comprese quelle sul CHECK di domain/status) tocca questo --
-- è un problema di TIPO della colonna, non di vincolo.

alter table skills alter column id type text;
alter table skills alter column derived_from type text;
alter table skill_events alter column skill_ids type text[];

-- Domain CHECK ancora allargato con "formula_example" (2026-08-24, nuovo
-- dominio per l'esempio numerico sulle formule) -- stesso bug di classe
-- già visto una volta con questo stesso CHECK: un valore nuovo lato codice
-- va nel vincolo nella stessa sessione in cui viene introdotto, non scoperto
-- mesi dopo.
alter table skills drop constraint if exists skills_domain_check;
alter table skills add constraint skills_domain_check
  check (domain in ('chat', 'task_breakdown', 'material_chat', 'study_plan', 'pdf_edit', 'material_knowledge', 'chapters', 'flashcards', 'summary', 'formula_example'));
