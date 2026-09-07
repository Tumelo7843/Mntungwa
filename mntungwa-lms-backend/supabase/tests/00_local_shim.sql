-- ============================================================================
-- 00_local_shim.sql
--
-- LOCAL VERIFICATION ONLY. NEVER RUN THIS AGAINST A SUPABASE PROJECT.
--
-- Supabase provides `auth.users`, `auth.uid()`, `auth.role()`, `storage.objects`
-- and the `anon` / `authenticated` / `service_role` roles out of the box.
-- Plain PostgreSQL does not. This file creates the minimum stand-ins so the
-- migrations can be executed and tested on a vanilla Postgres 16 instance.
--
-- Supabase's real objects are richer than these; the shim only reproduces the
-- surface the migrations actually depend on.
-- ============================================================================

create schema if not exists auth;
create schema if not exists storage;

-- ---- Roles -----------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth  to anon, authenticated, service_role;

-- ---- auth.users ------------------------------------------------------------
-- Supabase's real table has many more columns; migrations only reference
-- id, email, raw_user_meta_data and email_confirmed_at.
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  encrypted_password  text,
  email_confirmed_at  timestamptz,
  raw_user_meta_data  jsonb default '{}'::jsonb,
  created_at          timestamptz default now()
);

-- ---- Request context -------------------------------------------------------
-- Supabase populates request.jwt.claims per request via PostgREST.
-- The shim reads the same GUCs so auth.uid() behaves identically.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.email', true), '');
$$;

-- ---- storage.objects -------------------------------------------------------
create table if not exists storage.buckets (
  id      text primary key,
  name    text not null,
  public  boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets(id),
  name        text not null,
  owner       uuid,
  metadata    jsonb,
  created_at  timestamptz default now()
);

-- Supabase exposes these helpers for path-segment matching in policies.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/');
$$;

-- ---- Test convenience ------------------------------------------------------
-- Impersonate a user for RLS tests.
create or replace function auth.login_as(p_user uuid, p_role text default 'authenticated')
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
end;
$$;

create or replace function auth.logout()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
end;
$$;
