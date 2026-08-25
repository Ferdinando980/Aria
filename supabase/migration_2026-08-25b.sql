-- Aria — migrazione mirata 2026-08-25b (materials.file_updated_at)
-- Incolla per intero nel SQL Editor di Supabase ed esegui -- idempotente.
--
-- Nuova colonna per il piano "check locale vs remoto prima di riscaricare
-- il PDF" (2026-08-25): bumpata SOLO quando i byte del file cambiano
-- davvero (useAddFileMaterial/useReplaceMaterialFile), mai da un rename,
-- una nota, o un'annotazione -- updateMaterial() è la stessa funzione
-- generica usata anche per quelle, quindi un updated_at generico avrebbe
-- invalidato la cache del blob per una modifica che non tocca affatto il
-- file.

alter table materials add column if not exists file_updated_at timestamptz;
