-- ============================================================================
-- 009_submissions.sql
--
-- Real document submission. Replaces audit M-12, where the demo persisted a
-- filename string and nothing else.
--
--   summative_attempt  1 ── 1  submission  1 ── N  submission_versions
--                                                  └── N submission_files
--
-- Versions are retained for moderation: an assessor can always see what was
-- submitted at each attempt, which the demo could not support.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- assignments
--
-- A named, reusable brief (a PoE task, a practical assignment). Optional:
-- simple summative assessments carry their brief inline in task_brief.
-- ----------------------------------------------------------------------------
create table assignments (
  id                 uuid primary key default gen_random_uuid(),
  module_id          uuid references course_modules(id) on delete cascade,
  summative_assessment_id uuid references summative_assessments(id) on delete cascade,

  code               text,
  title              text not null,
  brief              text,
  deliverables       text[] not null default '{}',
  is_poe             boolean not null default false,

  template_resource_id uuid references learning_resources(id) on delete set null,

  created_by         uuid references profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint assignments_title_not_blank check (length(btrim(title)) > 0),
  constraint assignments_has_owner check (module_id is not null or summative_assessment_id is not null)
);

create index assignments_module_idx     on assignments (module_id) where module_id is not null;
create index assignments_summative_idx  on assignments (summative_assessment_id) where summative_assessment_id is not null;

create trigger assignments_set_updated_at
  before update on assignments
  for each row execute function app.set_updated_at();

comment on column assignments.is_poe is
  'Marks a Portfolio of Evidence task. Certificate eligibility can require all PoE assignments to have passed.';

-- ----------------------------------------------------------------------------
-- submissions
--
-- One per summative attempt.
-- ----------------------------------------------------------------------------
create table submissions (
  id                  uuid primary key default gen_random_uuid(),
  attempt_id          uuid not null references summative_attempts(id) on delete cascade,
  enrollment_id       uuid not null references enrollments(id)        on delete cascade,
  assignment_id       uuid references assignments(id) on delete set null,

  status              submission_status not null default 'DRAFT',
  current_version     integer not null default 0,

  first_submitted_at  timestamptz,
  last_submitted_at   timestamptz,

  learner_note        text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint submissions_unique_per_attempt unique (attempt_id),
  constraint submissions_version_sane check (current_version >= 0),
  constraint submissions_submitted_has_version
    check (status = 'DRAFT' or current_version > 0)
);

create index submissions_enrollment_idx on submissions (enrollment_id);
create index submissions_status_idx     on submissions (status);

create trigger submissions_set_updated_at
  before update on submissions
  for each row execute function app.set_updated_at();

comment on constraint submissions_submitted_has_version on submissions is
  'A submission cannot leave DRAFT without at least one version — prevents the demo''s empty "submitted" state (audit M-12).';

-- ----------------------------------------------------------------------------
-- submission_versions
--
-- Immutable once submitted. A resubmission creates a new version rather than
-- overwriting, so the moderation trail survives.
-- ----------------------------------------------------------------------------
create table submission_versions (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references submissions(id) on delete cascade,

  version_number  integer not null,
  submitted_at    timestamptz not null default now(),
  submitted_by    uuid references profiles(id) on delete set null,
  note            text,
  -- Set when this version was produced in response to RESUBMISSION_REQUIRED.
  supersedes_id   uuid references submission_versions(id) on delete set null,

  created_at      timestamptz not null default now(),

  constraint submission_versions_unique unique (submission_id, version_number),
  constraint submission_versions_number_positive check (version_number > 0),
  constraint submission_versions_no_self_supersede check (supersedes_id is null or supersedes_id <> id)
);

create index submission_versions_submission_idx on submission_versions (submission_id, version_number desc);

-- ----------------------------------------------------------------------------
-- submission_files
--
-- Metadata for evidence in the private `learner-submissions` bucket.
-- ----------------------------------------------------------------------------
create table submission_files (
  id               uuid primary key default gen_random_uuid(),
  version_id       uuid not null references submission_versions(id) on delete cascade,

  storage_bucket   text not null default 'learner-submissions',
  storage_path     text not null,
  file_name        text not null,
  mime_type        text not null,
  file_size_bytes  bigint not null,
  checksum         text,

  uploaded_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),

  constraint submission_files_size_positive check (file_size_bytes > 0),
  constraint submission_files_name_not_blank check (length(btrim(file_name)) > 0),
  constraint submission_files_path_not_blank check (length(btrim(storage_path)) > 0),
  constraint submission_files_unique_path unique (storage_bucket, storage_path)
);

create index submission_files_version_idx on submission_files (version_id);

comment on table submission_files is
  'Evidence metadata. Storage path convention: {enrollment_id}/{assessment_id}/{version_id}/{uuid}-{filename} — generated by one shared helper so Storage RLS can rely on the format (risk R-04).';
