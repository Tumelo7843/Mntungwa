-- ============================================================================
-- 005_enrollments.sql
--
-- The enrollment is the spine of the system: it links a learner to a course
-- and is the object every progress row, attempt, submission, invoice and
-- certificate hangs off. RLS uses it as the ownership anchor.
--
-- BR-001: a learner must have an ACTIVE enrollment before accessing
-- restricted learning content.
-- ============================================================================

create table enrollments (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid not null references profiles(id) on delete cascade,
  course_id             uuid not null references courses(id)  on delete restrict,
  cohort_id             uuid references cohorts(id) on delete set null,

  status                enrollment_status not null default 'PENDING',

  -- Administrative gates. Replaces the demo's `compliance` object.
  documents_verified    boolean not null default false,
  documents_verified_at timestamptz,
  documents_verified_by uuid references profiles(id) on delete set null,
  payment_cleared       boolean not null default false,
  payment_cleared_at    timestamptz,

  applied_at            timestamptz not null default now(),
  activated_at          timestamptz,
  expires_at            timestamptz,
  completed_at          timestamptz,
  withdrawn_at          timestamptz,
  withdrawal_reason     text,

  -- Cached rollups, maintained by trigger. Never trusted as authoritative:
  -- the recalculation functions in 017 are the source of truth. These exist
  -- so dashboards do not aggregate 28 modules per learner on every render.
  modules_total         integer not null default 0,
  modules_passed        integer not null default 0,
  credits_earned        integer not null default 0,
  progress_percent      numeric(5,2) not null default 0,
  final_exam_passed     boolean not null default false,
  course_completed      boolean not null default false,

  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint enrollments_unique_per_course unique (profile_id, course_id),
  constraint enrollments_progress_range check (progress_percent >= 0 and progress_percent <= 100),
  constraint enrollments_counts_sane     check (modules_passed >= 0 and modules_total >= 0 and modules_passed <= modules_total),
  constraint enrollments_credits_sane    check (credits_earned >= 0),
  constraint enrollments_active_has_date
    check (status <> 'ACTIVE' or activated_at is not null),
  constraint enrollments_completed_has_date
    check (status <> 'COMPLETED' or completed_at is not null),
  constraint enrollments_withdrawn_has_date
    check (status <> 'WITHDRAWN' or withdrawn_at is not null),
  constraint enrollments_verified_consistent
    check ((documents_verified = false) or (documents_verified_at is not null))
);

create index enrollments_profile_idx  on enrollments (profile_id);
create index enrollments_course_idx   on enrollments (course_id);
create index enrollments_cohort_idx   on enrollments (cohort_id);
create index enrollments_status_idx   on enrollments (status);
create index enrollments_active_idx   on enrollments (profile_id, course_id) where status = 'ACTIVE';

create trigger enrollments_set_updated_at
  before update on enrollments
  for each row execute function app.set_updated_at();

comment on table enrollments is
  'Ownership anchor for RLS. A learner reaches their own data by joining through this table.';
comment on column enrollments.progress_percent is
  'Cached rollup for dashboards. Recalculated by app.recalculate_enrollment_progress(); never written by a client.';

-- ----------------------------------------------------------------------------
-- Stamp the lifecycle timestamps automatically so the CHECK constraints above
-- cannot be tripped by a caller that forgets to set them.
-- ----------------------------------------------------------------------------
create or replace function app.stamp_enrollment_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'ACTIVE'    and new.activated_at is null then new.activated_at := now(); end if;
    if new.status = 'COMPLETED' and new.completed_at is null then new.completed_at := now(); end if;
    if new.status = 'WITHDRAWN' and new.withdrawn_at is null then new.withdrawn_at := now(); end if;
  end if;
  return new;
end;
$$;

create trigger enrollments_stamp_status
  before update on enrollments
  for each row execute function app.stamp_enrollment_status();
