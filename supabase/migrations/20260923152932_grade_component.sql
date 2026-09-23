-- Phase 8, Grades tab: the grading-scheme component a mark counts toward.
-- Null means Runway guesses it from the mark's label or linked item; Dylan's
-- pick in the Grades tab overrides the guess.

alter table public.grades add column component text;
