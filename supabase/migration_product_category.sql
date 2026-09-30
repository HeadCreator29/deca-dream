-- ============================================
-- DECAWEB — product category migration
-- Category (category text) on public.products: 'deca' vs 'jj'
-- Run in: Supabase Dashboard → SQL Editor
-- Safe to re-run (ADD COLUMN IF NOT EXISTS).
-- ============================================
--
-- DECISION: one text column with default 'deca' instead of a
-- separate jj table.
-- Why:
--   1. JJ products are created exactly like DECA ones
--      (same Admin form, same gallery/variant columns).
--   2. No new table = no new RLS policies to get wrong.
--   3. Public grid keeps a single-row read (select *).
--   4. Default 'deca' = old rows stay DECA with no backfill;
--      every reader treats missing/other values as 'deca',
--      so the Archive never breaks.
-- Values: 'deca' (default, DECA products) or 'jj'
-- (friend's sneakers, always shown in their own section).

alter table public.products
  add column if not exists category text not null default 'deca';

-- RLS: unchanged. The column lives on the same table, so the
-- existing policies (public_read_visible, auth_full_access)
-- keep applying with no changes.
