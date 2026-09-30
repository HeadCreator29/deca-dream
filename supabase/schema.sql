-- ============================================
-- DECA DREAM — products backend (Supabase)
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================

-- 1. Table ------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text,
  -- Editorial fields (all nullable for backward compatibility).
  code text,
  price numeric,
  currency text,
  color text,
  description text,
  -- Detected palette from the primary photo (jsonb, nullable for
  -- backward compatibility). See migration_product_colors.sql.
  colors jsonb,
  -- Full gallery, primary image first. image_url stays primary/fallback.
  images text[] not null default '{}',
  -- Explicit variant group. Same non-null value = same model.
  -- Null = independent product. NEVER derived by name matching.
  product_group_id text,
  visible boolean not null default true,
  sort_order integer not null default 1,
  -- Decade chapter start year (e.g. 2025 → "2025—26").
  -- Null = chapter derived from created_at.
  period_start_year integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Existing tables: add the chapter column once.
-- alter table public.products
--   add column if not exists period_start_year integer;

-- Product detail system (gallery + variants + editorial fields).
-- All additive + nullable: old rows keep working, image_url stays primary.
-- alter table public.products
--   add column if not exists code text,
--   add column if not exists price numeric,
--   add column if not exists currency text,
--   add column if not exists color text,
--   add column if not exists description text,
--   add column if not exists images text[] not null default '{}',
--   add column if not exists product_group_id text;
-- Or run supabase/migration_product_detail.sql for the full migration.

-- Keep updated_at fresh on edits.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_touch on public.products;
create trigger products_touch
  before update on public.products
  for each row execute function public.touch_updated_at();

-- 2. Row Level Security -----------------------------------
alter table public.products enable row level security;

-- Public (anon key): read only visible products.
drop policy if exists "public_read_visible" on public.products;
create policy "public_read_visible"
  on public.products for select
  to anon, authenticated
  using (visible = true);

-- Admin: full access for logged-in users.
-- (Only people you create under Authentication → Users can log in,
--  and /admin additionally checks VITE_ADMIN_EMAIL when set.)
drop policy if exists "auth_full_access" on public.products;
create policy "auth_full_access"
  on public.products for all
  to authenticated
  using (true)
  with check (true);

-- 3. Storage bucket for product images -------------------
-- Create once (or via Dashboard → Storage → New bucket, public ON):
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Public: anyone can view images (needed for the home grid).
drop policy if exists "public_read_images" on storage.objects;
create policy "public_read_images"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'product-images');

-- Admin: logged-in users can upload / replace / delete.
drop policy if exists "auth_write_images" on storage.objects;
create policy "auth_write_images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-images');

drop policy if exists "auth_update_images" on storage.objects;
create policy "auth_update_images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-images')
  with check (bucket_id = 'product-images');

drop policy if exists "auth_delete_images" on storage.objects;
create policy "auth_delete_images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-images');

-- 4. (Optional) seed one row to verify the home grid -------
-- insert into public.products (name, image_url, visible, sort_order)
-- values ('PRUEBA ARCHIVO', null, true, 1);
