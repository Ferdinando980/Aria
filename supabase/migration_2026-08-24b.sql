-- Aria — migrazione mirata 2026-08-24b (sospendi flashcard)
-- Incolla per intero nel SQL Editor di Supabase ed esegui -- idempotente.

alter table flashcards add column if not exists suspended boolean not null default false;
