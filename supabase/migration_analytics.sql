-- ============================================
-- DECAWEB — analytics migration
-- Tabla propia de visitas (sin Google Analytics ni externos)
-- Run in: Supabase Dashboard → SQL Editor
-- (el USUARIO debe ejecutar este SQL a mano)
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================
--
-- DECISION: una fila por sesión (session_id), no por pageview.
-- Por qué:
--   1. Heartbeat y cambios de página hacen UPDATE de la misma
--      fila (last_seen_at/path/product_id): nunca infla visitas.
--   2. Segunda pestaña = mismo visitor_id, distinto session_id:
--      no infla visitantes únicos.
--   3. Sin tracking entre sesiones: visitor_id vive solo en el
--      localStorage del navegador, sin cookies de terceros.
--
-- DECISION: realtime NO incluido aquí.
-- Por qué: supabase/schema.sql nunca agrega tablas a la
-- publicación supabase_realtime, así que no hay evidencia de que
-- hacerlo con ALTER PUBLICATION sea seguro en este proyecto.
-- El Admin usa suscripción realtime con fallback a polling 45s;
-- si querés realtime, habilitalo desde Dashboard → Database →
-- Replication cuando lo necesites.

create table if not exists public.analytics_visits (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  visitor_id uuid not null,
  path text not null,
  product_id text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  device_type text not null default 'desktop',
  country text default null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists analytics_visits_last_seen_idx
  on public.analytics_visits (last_seen_at);

create index if not exists analytics_visits_created_idx
  on public.analytics_visits (created_at);

create index if not exists analytics_visits_product_idx
  on public.analytics_visits (product_id);

-- 2. Row Level Security -----------------------------------
alter table public.analytics_visits enable row level security;

-- Visitantes (anon key): SOLO insertar + heartbeat. Sin select/delete.
drop policy if exists "anon_insert_visits" on public.analytics_visits;
create policy "anon_insert_visits"
  on public.analytics_visits for insert
  to anon, authenticated
  with check (true);

-- Heartbeat anónimo: el tracker actualiza last_seen_at/path/product_id
-- de SU propia sesión (UUID imposible de adivinar). El trigger de abajo
-- impide modificar cualquier otra columna, así nadie puede alterar
-- sesiones arbitrariamente aunque conozca el endpoint.
drop policy if exists "anon_heartbeat_visits" on public.analytics_visits;
create policy "anon_heartbeat_visits"
  on public.analytics_visits for update
  to anon
  using (true)
  with check (true);

-- Guarda del heartbeat: congela todo salvo last_seen_at/path/product_id.
create or replace function public.analytics_heartbeat_guard()
returns trigger
language plpgsql
as $$
begin
  new.id := old.id;
  new.session_id := old.session_id;
  new.visitor_id := old.visitor_id;
  new.referrer := old.referrer;
  new.utm_source := old.utm_source;
  new.utm_medium := old.utm_medium;
  new.utm_campaign := old.utm_campaign;
  new.device_type := old.device_type;
  new.country := old.country;
  new.created_at := old.created_at;
  if new.last_seen_at is null then
    new.last_seen_at := old.last_seen_at;
  end if;
  return new;
end;
$$;

drop trigger if exists analytics_heartbeat_guard on public.analytics_visits;
create trigger analytics_heartbeat_guard
  before update on public.analytics_visits
  for each row execute function public.analytics_heartbeat_guard();

-- Admin (usuarios logueados): lectura y mantenimiento.
-- El Admin usa el Auth existente; jamás service role en frontend.
drop policy if exists "auth_read_visits" on public.analytics_visits;
create policy "auth_read_visits"
  on public.analytics_visits for select
  to authenticated
  using (true);

drop policy if exists "auth_update_visits" on public.analytics_visits;
create policy "auth_update_visits"
  on public.analytics_visits for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "auth_delete_visits" on public.analytics_visits;
create policy "auth_delete_visits"
  on public.analytics_visits for delete
  to authenticated
  using (true);

-- NOTA: anon jamás lee ni borra analytics (sin policy select/delete
-- para anon). El trigger garantiza que el UPDATE anónimo solo mueve
-- last_seen_at/path/product_id de la sesión que el navegador conoce.
