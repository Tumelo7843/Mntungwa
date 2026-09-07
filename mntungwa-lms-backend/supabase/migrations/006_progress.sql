-- ============================================================================
-- 006_progress.sql
--
-- Replaces the demo's `records: { 'KM-01': {...} }` map (audit §7.2), which
-- could not express attempt history, per-question answers, rubric scores,
-- feedback or resubmission chains.
--
-- Learners may mark a lesson complete. They may NOT write module_progress.status
-- — that is derived by app.recalculate_module_progress() (migration 017) and
-- enforced by RLS (019).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- lesson_progress
-- ----------------------------------------------------------------------------
create table lesson_progress (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references enrollments(id) on delete cascade,
  lesson_id      uuid not null references lessons(id)     on delete cascade,

  status         progress_status not null default 'NOT_STARTED',
  first_opened_at timestamptz,
  completed_at   timestamptz,
  -- Time on page, reported by the client. Advisory only: it never gates
  -- progression, because a client-reported duration is not trustworthy.
  seconds_spent  integer not null default 0,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint lesson_progress_unique unique (enrollment_id, lesson_id),
  constraint lesson_progress_seconds_sane check (seconds_spent >= 0),
  constraint lesson_progress_completed_has_date
    check (status <> 'COMPLETED' or completed_at is not null),
  -- A lesson is only ever NOT_STARTED / IN_PROGRESS / COMPLETED.
  constraint lesson_progress_valid_status
    check (status in ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'))
);

create index lesson_progress_enrollment_idx on lesson_progress (enrollment_id);
create index lesson_progress_lesson_idx     on lesson_progress (lesson_id);

create trigger lesson_progress_set_updated_at
  before update on lesson_progress
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- module_progress
--
-- One row per (enrollment, module). `status` is authoritative and is written
-- only by SECURITY DEFINER functions.
-- ----------------------------------------------------------------------------
create table module_progress (
  id                     uuid primary key default gen_random_uuid(),
  enrollment_id          uuid not null references enrollments(id)      on delete cascade,
  module_id              uuid not null references course_modules(id)   on delete cascade,

  status                 progress_status not null default 'LOCKED',

  -- Component completion, recalculated from the underlying tables.
  lessons_total          integer not null default 0,
  lessons_completed      integer not null default 0,
  formatives_required    integer not null default 0,
  formatives_passed      integer not null default 0,
  summatives_required    integer not null default 0,
  summatives_passed      integer not null default 0,

  best_score             numeric(5,2),
  credits_awarded        integer not null default 0,

  unlocked_at            timestamptz,
  started_at             timestamptz,
  completed_at           timestamptz,
  passed_at              timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint module_progress_unique unique (enrollment_id, module_id),
  constraint module_progress_counts_sane check (
    lessons_completed   between 0 and greatest(lessons_total, 0)      and
    formatives_passed   between 0 and greatest(formatives_required, 0) and
    summatives_passed   between 0 and greatest(summatives_required, 0)
  ),
  constraint module_progress_score_range check (best_score is null or (best_score >= 0 and best_score <= 100)),
  constraint module_progress_credits_sane check (credits_awarded >= 0),
  constraint module_progress_passed_has_date
    check (status <> 'PASSED' or passed_at is not null)
);

create index module_progress_enrollment_idx on module_progress (enrollment_id);
create index module_progress_module_idx     on module_progress (module_id);
create index module_progress_status_idx     on module_progress (enrollment_id, status);

create trigger module_progress_set_updated_at
  before update on module_progress
  for each row execute function app.set_updated_at();

comment on column module_progress.status is
  'Authoritative progression state. Written only by SECURITY DEFINER functions; learners have no UPDATE grant (BR-002).';
comment on column module_progress.credits_awarded is
  'Credits banked when the module reached PASSED. Summed for the enrollment rather than compared against a hard-coded 240 (audit C-06).';
