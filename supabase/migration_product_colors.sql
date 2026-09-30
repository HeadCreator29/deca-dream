-- ============================================
-- DECAWEB — product colors migration
-- Detected palette (colors jsonb) on public.products
-- Run in: Supabase Dashboard → SQL Editor
-- Safe to re-run (ADD COLUMN IF NOT EXISTS).
-- ============================================
--
-- DECISION: one nullable jsonb column holding
--   [{ name, hex, percentage, primary }, ...]
-- instead of a normalized product_colors table.
-- Why:
--   1. Max 5 colors per product — a join table is overkill.
--   2. No new table = no new RLS policies to get wrong.
--   3. Public grid keeps a single-row read (select *).
--   4. Null = old rows without detection; every reader
--      treats null/empty as "no palette", nothing breaks.

alter table public.products
  add column if not exists colors jsonb;

-- RLS: unchanged. The column lives on the same table, so the
-- existing policies (public_read_visible, auth_full_access)
-- keep applying with no changes.
