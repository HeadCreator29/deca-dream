-- ============================================
-- DECAWEB — product thumbnails migration
-- Explicit per-photo thumbnails (thumbnails text[]) on public.products
-- Run in: Supabase Dashboard → SQL Editor
-- Safe to re-run (ADD COLUMN IF NOT EXISTS).
-- ============================================
--
-- DECISION: one text[] column parallel to images (same order, same
-- length) instead of deriving thumbs by URL convention at read time.
-- Why:
--   1. Explicit data beats convention: the grid reads thumbnails[0]
--      instead of guessing thumb.webp from product.webp.
--   2. No new table = no new RLS policies to get wrong.
--   3. Public grid keeps a single-row read (select *).
--   4. Default '{}' = old rows without explicit thumbs; every reader
--      falls back to thumbFor(image) or image_url, nothing breaks.
--      Re-saving a product (or manual backfill) fills the column.

alter table public.products
  add column if not exists thumbnails text[] not null default '{}';

-- RLS: unchanged. The column lives on the same table, so the
-- existing policies (public_read_visible, auth_full_access)
-- keep applying with no changes.
