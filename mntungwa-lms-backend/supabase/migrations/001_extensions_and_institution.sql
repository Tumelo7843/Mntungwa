-- ============================================================================
-- 001_extensions_and_institution.sql
-- Mntungwa LMS — Model A (single institution)
--
-- Extensions, shared enum types, the `app` helper schema, and the single
-- institution record. Everything downstream depends on this file.
-- ============================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid(), digest()
create extension if not exists "citext";        -- case-insensitive email

-- ----------------------------------------------------------------------------
-- Helper schema. Holds SECURITY DEFINER helpers used by RLS policies.
-- Kept out of `public` so it is never exposed through PostgREST.
-- ----------------------------------------------------------------------------
create schema if not exists app;

revoke all on schema app from public;
grant usage on schema app to authenticated, anon, service_role;

-- ----------------------------------------------------------------------------
-- Enums
--
-- Enums are used (rather than text + CHECK) so that an invalid status is
-- rejected at the type level and so the generated TypeScript types are unions.
-- ----------------------------------------------------------------------------

-- Six institution roles. No tenant/SaaS roles: this is Model A.
create type app_role as enum (
  'ADMIN',
  'INSTRUCTOR',
  'ASSESSOR',
  'LEARNER',
  'FINANCE',
  'SUPPORT'
);

create type account_status as enum (
  'PENDING_VERIFICATION',  -- registered, email not yet confirmed
  'PENDING_PAYMENT',       -- confirmed, awaiting finance approval
  'ACTIVE',
  'SUSPENDED',
  'WITHDRAWN'
);

create type publication_status as enum (
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED'
);

create type enrollment_status as enum (
  'PENDING',      -- created, not yet paid/approved
  'ACTIVE',
  'SUSPENDED',
  'COMPLETED',
  'WITHDRAWN',
  'EXPIRED'
);

-- Progression states from the brief. LOCKED is derived, never stored as a
-- resting state for an unlocked module.
create type progress_status as enum (
  'LOCKED',
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'SUBMITTED',
  'UNDER_REVIEW',
  'PASSED',
  'FAILED',
  'RESUBMISSION_REQUIRED'
);

create type submission_status as enum (
  'DRAFT',
  'OPEN',
  'SUBMITTED',
  'UNDER_REVIEW',
  'PASSED',
  'FAILED',
  'RESUBMISSION_REQUIRED',
  'CLOSED'
);

create type attempt_status as enum (
  'IN_PROGRESS',
  'SUBMITTED',
  'GRADED',
  'ABANDONED',
  'EXPIRED'
);

create type question_type as enum (
  'MULTIPLE_CHOICE',   -- exactly one correct option
  'TRUE_FALSE',        -- two options, one correct
  'MULTIPLE_SELECT',   -- one or more correct options
  'SHORT_ANSWER',      -- manual marking
  'ESSAY',             -- manual marking
  'FILE_UPLOAD'        -- manual marking, evidence attached
);

create type feedback_policy as enum (
  'NEVER',
  'AFTER_SUBMIT',
  'AFTER_PASS',
  'AFTER_FINAL_ATTEMPT'
);

create type certificate_status as enum (
  'ISSUED',
  'REVOKED',
  'REPLACED'
);

create type invoice_status as enum (
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED'
);

create type payment_status as enum (
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED'
);

create type payment_method as enum (
  'EFT',
  'CASH',
  'CARD',
  'BURSARY',
  'EMPLOYER',
  'OTHER'
);

create type notification_channel as enum (
  'IN_APP',
  'EMAIL'
);

-- ----------------------------------------------------------------------------
-- Shared trigger function: maintain updated_at
-- ----------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- institution
--
-- Exactly one row, enforced by a partial unique index on a constant column.
-- Model A has no tenants; this exists only so branding and registration
-- details are data rather than hard-coded strings.
-- ----------------------------------------------------------------------------
create table institution (
  id                  uuid primary key default gen_random_uuid(),
  singleton           boolean not null default true,
  name                text not null,
  legal_name          text,
  registration_number text,
  accreditation_body  text,
  accreditation_number text,
  email               citext,
  phone               text,
  website             text,
  address_line1       text,
  address_line2       text,
  city                text,
  province            text,
  postal_code         text,
  country             text not null default 'South Africa',
  logo_path           text,
  accent_color        text not null default '#1a396b',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint institution_singleton_true check (singleton is true),
  constraint institution_name_not_blank  check (length(btrim(name)) > 0),
  constraint institution_accent_hex      check (accent_color ~ '^#[0-9a-fA-F]{6}$')
);

-- The row-limit guarantee: only one row may have singleton = true, and the
-- CHECK above forbids any other value.
create unique index institution_only_one_row on institution (singleton);

create trigger institution_set_updated_at
  before update on institution
  for each row execute function app.set_updated_at();

comment on table institution is
  'Single-institution record (Model A). Constrained to exactly one row.';

-- ----------------------------------------------------------------------------
-- institution_settings
--
-- Operational policy that admins may change without a migration: pass marks,
-- cohort minimums, upload limits, certificate numbering.
-- ----------------------------------------------------------------------------
create table institution_settings (
  institution_id            uuid primary key references institution(id) on delete cascade,

  -- Academic policy
  default_pass_mark         numeric(5,2) not null default 50.00,
  min_cohort_size           integer      not null default 15,
  allow_formative_retakes   boolean      not null default true,
  default_formative_attempts integer,              -- null = unlimited
  default_summative_attempts integer     not null default 3,
  final_exam_attempts       integer      not null default 2,

  -- Certificates
  certificate_prefix        text         not null default 'MIS',
  certificate_year_in_number boolean     not null default true,
  certificate_signatory_name text,
  certificate_signatory_title text,

  -- Uploads
  max_resource_bytes        bigint       not null default 52428800,   -- 50 MB
  max_submission_bytes      bigint       not null default 26214400,   -- 25 MB
  allowed_resource_mime     text[]       not null default array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/webp'
  ],
  allowed_submission_mime   text[]       not null default array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'application/zip'
  ],

  -- Finance
  currency                  text         not null default 'ZAR',
  vat_rate                  numeric(5,4) not null default 0.1500,

  created_at                timestamptz  not null default now(),
  updated_at                timestamptz  not null default now(),

  constraint settings_pass_mark_range     check (default_pass_mark >= 0 and default_pass_mark <= 100),
  constraint settings_cohort_min_positive check (min_cohort_size > 0),
  constraint settings_vat_range           check (vat_rate >= 0 and vat_rate < 1),
  constraint settings_formative_attempts  check (default_formative_attempts is null or default_formative_attempts > 0),
  constraint settings_summative_attempts  check (default_summative_attempts > 0),
  constraint settings_final_attempts      check (final_exam_attempts > 0),
  constraint settings_resource_bytes      check (max_resource_bytes > 0),
  constraint settings_submission_bytes    check (max_submission_bytes > 0)
);

create trigger institution_settings_set_updated_at
  before update on institution_settings
  for each row execute function app.set_updated_at();

comment on table institution_settings is
  'Institution-wide policy. Preserves the demo''s 50% pass mark and 15-learner cohort minimum as configuration rather than constants.';

-- ----------------------------------------------------------------------------
-- app.settings() — convenience accessor used by business functions.
-- SECURITY DEFINER so business logic can read policy without granting
-- every role direct SELECT on the settings table.
-- ----------------------------------------------------------------------------
create or replace function app.settings()
returns institution_settings
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from institution_settings limit 1;
$$;
