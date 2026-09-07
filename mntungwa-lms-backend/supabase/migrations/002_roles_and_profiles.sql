-- ============================================================================
-- 002_roles_and_profiles.sql
--
-- Identity. `profiles` extends auth.users; `user_roles` grants institution
-- roles. Passwords live in auth.users and are never mirrored here (audit S-01).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles
--
-- PK is auth.users.id, so a profile cannot outlive its auth account and
-- auth.uid() is directly usable as a foreign key everywhere else.
--
-- POPIA note (audit S-07): id_number is a South African ID and therefore
-- personal information under Act 4 of 2013. It is nullable, is never returned
-- by certificate verification, and RLS restricts it to the owner plus ADMIN /
-- SUPPORT. See docs/SECURITY.md.
-- ----------------------------------------------------------------------------
create table profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              citext not null unique,
  full_name          text   not null,
  preferred_name     text,
  phone              text,
  id_number          text,
  date_of_birth      date,
  gender             text,
  nationality        text,
  avatar_path        text,

  account_status     account_status not null default 'PENDING_VERIFICATION',
  suspended_reason   text,
  last_seen_at       timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint profiles_full_name_not_blank check (length(btrim(full_name)) > 0),
  -- RSA ID is 13 digits. Permissive: other nationalities may use a passport.
  constraint profiles_id_number_shape     check (id_number is null or length(btrim(id_number)) between 5 and 32)
);

create index profiles_account_status_idx on profiles (account_status);
create index profiles_full_name_idx      on profiles (lower(full_name));

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function app.set_updated_at();

comment on column profiles.id_number is
  'POPIA-regulated personal information. Never exposed via certificate verification or audit metadata.';

-- ----------------------------------------------------------------------------
-- user_roles
--
-- Many-to-many: one person may be both INSTRUCTOR and ASSESSOR, which the
-- demo could not express (it had a single `role` string).
-- ----------------------------------------------------------------------------
create table user_roles (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  role        app_role not null,
  granted_by  uuid references profiles(id) on delete set null,
  granted_at  timestamptz not null default now(),

  constraint user_roles_unique unique (profile_id, role)
);

create index user_roles_profile_idx on user_roles (profile_id);
create index user_roles_role_idx    on user_roles (role);

comment on table user_roles is
  'Institution role grants. Authorisation is enforced by RLS using these rows; the frontend permission matrix is UX only.';

-- ----------------------------------------------------------------------------
-- cohorts
--
-- Retained from the demo deliberately (audit §8.1). Cohorts are an
-- institutional concept, not multi-tenancy, and min_cohort_size drives a real
-- compliance warning.
-- ----------------------------------------------------------------------------
create table cohorts (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  start_date     date,
  end_date       date,
  is_active      boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint cohorts_name_not_blank check (length(btrim(name)) > 0),
  constraint cohorts_date_order     check (end_date is null or start_date is null or end_date >= start_date)
);

create trigger cohorts_set_updated_at
  before update on cohorts
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- handle_new_user
--
-- Supabase inserts into auth.users on sign-up. This trigger mirrors the row
-- into profiles and grants the LEARNER role, so a profile always exists.
--
-- Self-service sign-up NEVER grants a privileged role: metadata is not
-- trusted. Staff roles are granted by an ADMIN through the admin panel.
-- ----------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into profiles (id, email, full_name, phone, account_status)
  values (
    new.id,
    new.email,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''),
    case when new.email_confirmed_at is not null
         then 'PENDING_PAYMENT'::account_status
         else 'PENDING_VERIFICATION'::account_status
    end
  )
  on conflict (id) do nothing;

  -- Every self-registered account is a LEARNER and nothing else.
  insert into user_roles (profile_id, role)
  values (new.id, 'LEARNER')
  on conflict (profile_id, role) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ----------------------------------------------------------------------------
-- Promote the account once the email is confirmed.
-- ----------------------------------------------------------------------------
create or replace function app.handle_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update profiles
       set account_status = 'PENDING_PAYMENT'
     where id = new.id
       and account_status = 'PENDING_VERIFICATION';
  end if;
  return new;
end;
$$;

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function app.handle_user_confirmed();
