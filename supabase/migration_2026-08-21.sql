-- Aria — migrazione mirata 2026-08-21 (flashcard/riassunti per sotto-sezione)
-- Incolla per intero nel SQL Editor di Supabase ed esegui -- idempotente.

alter table flashcards add column if not exists section_id uuid;
alter table summaries add column if not exists section_id uuid;
