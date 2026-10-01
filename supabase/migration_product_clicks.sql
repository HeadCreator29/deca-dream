-- ============================================
-- DECAWEB — product clicks migration
-- Un evento inmutable por clic en un producto
-- (la tabla analytics_visits guarda UNA fila por
-- sesión y el UPDATE de navegación sobrescribe
-- product_id: volver al home lo pone en null y
-- el clic se pierde — por eso el conteo parecía
-- funcionar solo en PC).
-- Run in: Supabase Dashboard → SQL Editor
-- (el USUARIO debe ejecutar este SQL a mano)
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================
--
-- DECISION: una fila por clic, nunca UPDATE.
-- Por qué:
--   1. Cada clic en la grilla principal (móvil,
--      tablet o desktop) queda registrado con su
--      product_id y device_type al momento del clic.
--   2. Volver al home, ver otro producto o el
--      heartbeat de visits jamás borran el evento.
--   3. Sin tracking entre sesiones: visitor_id vive
--      solo en el localStorage del navegador.

create table if not exists public.analytics_product_clicks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  visitor_id uuid not null,
  product_id text not null,
  device_type text not null default 'desktop',
  created_at timestamptz not null default now()
);

create index if not exists analytics_product_clicks_product_idx
  on public.analytics_product_clicks (product_id);

create index if not exists analytics_product_clicks_created_idx
  on public.analytics_product_clicks (created_at);

-- 2. Row Level Security -----------------------------------
alter table public.analytics_product_clicks enable row level security;

-- Visitantes (anon key): SOLO insertar. Sin select/update/delete.
drop policy if exists "anon_insert_clicks" on public.analytics_product_clicks;
create policy "anon_insert_clicks"
  on public.analytics_product_clicks for insert
  to anon, authenticated
  with check (true);

-- Admin (usuarios logueados): lectura y mantenimiento.
-- El Admin usa el Auth existente; jamás service role en frontend.
drop policy if exists "auth_read_clicks" on public.analytics_product_clicks;
create policy "auth_read_clicks"
  on public.analytics_product_clicks for select
  to authenticated
  using (true);

drop policy if exists "auth_delete_clicks" on public.analytics_product_clicks;
create policy "auth_delete_clicks"
  on public.analytics_product_clicks for delete
  to authenticated
  using (true);
