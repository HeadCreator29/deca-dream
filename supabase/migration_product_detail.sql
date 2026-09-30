-- ============================================
-- DECAWEB — product detail migration
-- Gallery (images) + explicit variant groups + editorial fields
-- Run in: Supabase Dashboard → SQL Editor
-- Safe to re-run (all ADD COLUMN IF NOT EXISTS).
-- ============================================
--
-- DECISION: additive nullable columns on public.products
-- (images text[] + product_group_id text + editorial fields)
-- instead of a normalized product_images table.
-- Why:
--   1. Max 5 photos per product — a join table is overkill.
--   2. No new table = no new RLS policies to get wrong.
--   3. Public grid keeps a single-row read (select *).
--   4. image_url stays as primary/fallback so old clients,
--      old rows, and the local seed keep working untouched.
--   5. Variants stay real products (own row, own images/price/
--      concept/code/period) linked ONLY by product_group_id.
--      Name matching is never used.

alter table public.products
  add column if not exists code text,
  add column if not exists price numeric,
  add column if not exists currency text,
  add column if not exists color text,
  add column if not exists description text,
  add column if not exists images text[] not null default '{}',
  add column if not exists product_group_id text;

-- Backfill: rows created before the gallery column get a
-- gallery derived from their single image_url (if any).
update public.products
set images = array[image_url]
where image_url is not null
  and (images is null or coalesce(array_length(images, 1), 0) = 0);

-- Optional index for variant lookups (same group = same model).
create index if not exists products_group_idx
  on public.products (product_group_id);

-- RLS: unchanged. New columns live on the same table, so the
-- existing policies (public_read_visible, auth_full_access)
-- and storage policies keep applying with no changes.
