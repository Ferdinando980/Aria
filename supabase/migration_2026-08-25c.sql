-- Aria — migrazione mirata 2026-08-25c (skills.material_id/area_of_interest
-- mai arrivate su Supabase, quarta occorrenza dello stesso bug oggi)
-- Incolla per intero nel SQL Editor di Supabase ed esegui -- idempotente.
--
-- Trovato dal vivo: una query di pulizia reale ha fallito con "column
-- material_id does not exist". Sia material_id che area_of_interest sono
-- referenziate e sincronizzate dal codice (useAppStore.ts, 5+ punti) fin da
-- quando material_knowledge esiste (2026-08-21), ma non erano mai state
-- aggiunte allo schema reale -- ne' nel corpo della CREATE TABLE ne' in
-- nessuna migrazione precedente. Effetto peggiore delle altre tre occorrenze
-- di oggi: il fail-open di syncUpsert significa che OGNI skill che portava
-- uno di questi due campi non si e' mai sincronizzata affatto, non solo
-- quel campo -- le skill material_knowledge probabilmente non hanno mai
-- fatto un vero giro tra dispositivi.

alter table skills add column if not exists material_id uuid references materials(id) on delete set null;
alter table skills add column if not exists area_of_interest text;
