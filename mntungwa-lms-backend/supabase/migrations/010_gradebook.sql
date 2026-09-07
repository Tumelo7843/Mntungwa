-- ============================================================================
-- 010_gradebook.sql
--
-- Rubrics, criterion-level scoring, grade records and feedback threads.
--
-- The demo let an admin type a single percentage into a box (audit M-20) and
-- overwrote it on regrade, leaving no history. Here every grade is a row, a
-- regrade is a new row, and the previous grade is retained as superseded.
--
-- BR-007: only authorised personnel may grade summative submissions.
-- BR-008: learners cannot modify grades.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- rubrics
-- ----------------------------------------------------------------------------
create table rubrics (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  title         text not null,
  description   text,
  -- Total is derived from the criteria; stored for display and validated by trigger.
  total_points  numeric(8,2) not null default 0,
  is_active     boolean not null default true,

  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint rubrics_title_not_blank check (length(btrim(title)) > 0),
  constraint rubrics_total_sane      check (total_points >= 0)
);

create trigger rubrics_set_updated_at
  before update on rubrics
  for each row execute function app.set_updated_at();

-- Now that rubrics exists, wire up the FK deferred from migration 008.
alter table summative_assessments
  add constraint summative_rubric_fk
  foreign key (rubric_id) references rubrics(id) on delete set null;

-- ----------------------------------------------------------------------------
-- rubric_criteria
-- ----------------------------------------------------------------------------
create table rubric_criteria (
  id            uuid primary key default gen_random_uuid(),
  rubric_id     uuid not null references rubrics(id) on delete cascade,

  title         text not null,
  description   text,
  max_points    numeric(6,2) not null,
  weight        numeric(5,2) not null default 1,
  sequence      integer not null,
  -- Optional descriptors per band, e.g. {"4":"Excellent","3":"Competent"}.
  level_descriptors jsonb,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint rubric_criteria_title_not_blank check (length(btrim(title)) > 0),
  constraint rubric_criteria_points_positive check (max_points > 0),
  constraint rubric_criteria_weight_positive check (weight > 0),
  constraint rubric_criteria_sequence_positive check (sequence > 0),
  constraint rubric_criteria_unique_sequence unique (rubric_id, sequence) deferrable initially deferred
);

create index rubric_criteria_rubric_idx on rubric_criteria (rubric_id, sequence);

create trigger rubric_criteria_set_updated_at
  before update on rubric_criteria
  for each row execute function app.set_updated_at();

-- Keep rubrics.total_points in step with its criteria.
create or replace function app.sync_rubric_total()
returns trigger
language plpgsql
as $$
declare
  v_rubric uuid := coalesce(new.rubric_id, old.rubric_id);
begin
  update rubrics
     set total_points = coalesce((
           select sum(max_points * weight) from rubric_criteria where rubric_id = v_rubric
         ), 0)
   where id = v_rubric;
  return coalesce(new, old);
end;
$$;

create trigger rubric_criteria_sync_total
  after insert or update or delete on rubric_criteria
  for each row execute function app.sync_rubric_total();

-- ----------------------------------------------------------------------------
-- grades
--
-- A grade record per marking event. Regrades insert a new row and mark the
-- previous one superseded, preserving history (fixes audit M-20).
-- ----------------------------------------------------------------------------
create table grades (
  id                  uuid primary key default gen_random_uuid(),

  -- Exactly one target.
  summative_attempt_id uuid references summative_attempts(id) on delete cascade,
  final_exam_attempt_id uuid,        -- FK added in 011

  enrollment_id       uuid not null references enrollments(id) on delete cascade,
  rubric_id           uuid references rubrics(id) on delete set null,

  points_earned       numeric(8,2),
  points_possible     numeric(8,2),
  score_percent       numeric(5,2) not null,
  pass_mark_applied   numeric(5,2) not null,
  passed              boolean not null,

  graded_by           uuid references profiles(id) on delete set null,
  graded_at           timestamptz not null default now(),
  -- Results are withheld from the learner until released.
  released_at         timestamptz,
  released_by         uuid references profiles(id) on delete set null,

  -- Regrade chain.
  supersedes_id       uuid references grades(id) on delete set null,
  is_superseded       boolean not null default false,
  regrade_reason      text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint grades_score_range     check (score_percent >= 0 and score_percent <= 100),
  constraint grades_pass_mark_range check (pass_mark_applied >= 0 and pass_mark_applied <= 100),
  constraint grades_points_sane     check (
    points_earned is null or points_possible is null or
    (points_earned >= 0 and points_earned <= points_possible)
  ),
  constraint grades_no_self_supersede check (supersedes_id is null or supersedes_id <> id),
  constraint grades_single_target check (
    (summative_attempt_id is not null)::int + (final_exam_attempt_id is not null)::int = 1
  ),
  -- passed must agree with the arithmetic; a grader cannot pass a 20%.
  constraint grades_passed_matches_score
    check (passed = (score_percent >= pass_mark_applied))
);

create index grades_enrollment_idx on grades (enrollment_id);
create index grades_summative_idx  on grades (summative_attempt_id) where summative_attempt_id is not null;
create index grades_current_idx    on grades (enrollment_id) where is_superseded = false;

create trigger grades_set_updated_at
  before update on grades
  for each row execute function app.set_updated_at();

comment on constraint grades_passed_matches_score on grades is
  'The pass/fail flag is arithmetic, not opinion. Prevents a grade of 20% being recorded as PASSED (audit S-04).';
comment on column grades.released_at is
  'Learners see a result only after release. RLS filters unreleased grades.';

-- ----------------------------------------------------------------------------
-- grade_criteria_scores
-- ----------------------------------------------------------------------------
create table grade_criteria_scores (
  id            uuid primary key default gen_random_uuid(),
  grade_id      uuid not null references grades(id)          on delete cascade,
  criterion_id  uuid not null references rubric_criteria(id) on delete restrict,

  points        numeric(6,2) not null,
  comment       text,

  created_at    timestamptz not null default now(),

  constraint grade_criteria_unique unique (grade_id, criterion_id),
  constraint grade_criteria_points_sane check (points >= 0)
);

create index grade_criteria_grade_idx on grade_criteria_scores (grade_id);

-- A criterion score may not exceed that criterion's maximum.
create or replace function app.validate_criterion_score()
returns trigger
language plpgsql
as $$
declare
  v_max numeric(6,2);
begin
  select max_points into v_max from rubric_criteria where id = new.criterion_id;
  if v_max is null then
    raise exception 'Rubric criterion % does not exist', new.criterion_id;
  end if;
  if new.points > v_max then
    raise exception 'Score % exceeds the maximum % for this criterion', new.points, v_max;
  end if;
  return new;
end;
$$;

create trigger grade_criteria_validate
  before insert or update on grade_criteria_scores
  for each row execute function app.validate_criterion_score();

-- ----------------------------------------------------------------------------
-- feedback
--
-- Threaded comments against a submission or an attempt. Assessor feedback is
-- visible to the learner; internal notes are staff-only (enforced by RLS).
-- ----------------------------------------------------------------------------
create table feedback (
  id                   uuid primary key default gen_random_uuid(),

  submission_id        uuid references submissions(id)        on delete cascade,
  summative_attempt_id uuid references summative_attempts(id) on delete cascade,
  grade_id             uuid references grades(id)             on delete cascade,

  enrollment_id        uuid not null references enrollments(id) on delete cascade,
  author_id            uuid references profiles(id) on delete set null,

  body                 text not null,
  is_internal          boolean not null default false,
  parent_id            uuid references feedback(id) on delete cascade,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint feedback_body_not_blank check (length(btrim(body)) > 0),
  constraint feedback_no_self_parent check (parent_id is null or parent_id <> id),
  constraint feedback_has_target check (
    submission_id is not null or summative_attempt_id is not null or grade_id is not null
  )
);

create index feedback_enrollment_idx on feedback (enrollment_id);
create index feedback_submission_idx on feedback (submission_id) where submission_id is not null;
create index feedback_learner_visible_idx on feedback (enrollment_id) where is_internal = false;

create trigger feedback_set_updated_at
  before update on feedback
  for each row execute function app.set_updated_at();

comment on column feedback.is_internal is
  'Internal moderation notes between staff. RLS hides these from learners.';
