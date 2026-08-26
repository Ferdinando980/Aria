-- Aria — migrazione mirata 2026-08-26b (Cheat Study: le tracce d'esame
-- devono essere distinte dal materiale di studio vero, non solo filtrate
-- lato client -- vedi types.ts's Material.isExamPaper)
-- Incolla per intero nel SQL Editor di Supabase ed esegui -- idempotente.
alter table materials add column if not exists is_exam_paper boolean;
