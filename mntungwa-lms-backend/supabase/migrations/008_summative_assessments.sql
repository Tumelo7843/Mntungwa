-- ============================================================================
-- 008_summative_assessments.sql
--
-- Summative assessment: formally measures achievement of learning outcomes.
-- Unlike formative, it may require evidence upload and assessor judgement.
--
-- A summative assessment can carry questions (objective, auto-marked),
-- written/practical work (manual), or both. Document submission lives in
-- 009_submissions.sql; grading and rubrics in 010_gradebook.sql.
-- ============================================================================

create table summative_assessments (
  id                    uuid primary key default gen_random_uuid(),
  module_id             uuid not null references course_modules(id) on delete cascade,

  title                 text not null,
  instructions          text,
  -- Practical brief / PoE task description shown above the upload box.
  task_brief            text,

  pass_mark             numeric(5,2),
  max_attempts          integer not null default 3,
  is_required           boolean not null default true,

  -- What the learner must produce.
  has_questions         boolean not null default false,
  requires_submission   boolean not null default true,
  min_files             integer not null default 1,
  max_files             integer not null default 5,
  allow_resubmission    boolean not null default true,

  -- Weighting between the objective and assessor-marked portions.
  question_weight       numeric(5,2) not null default 0,
  submission_weight     numeric(5,2) not null default 100,

  rubric_id             uuid,          -- FK added in 010 (rubrics not yet created)

  available_from        timestamptz,
  available_until       timestamptz,
  due_at                timestamptz,

  sequence              integer not null default 1,
  publication_status    publication_status not null default 'DRAFT',
  published_at          timestamptz,
  created_by            uuid references profiles(id) on delete set null,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint summative_title_not_blank  check (length(btrim(title)) > 0),
  constraint summative_pass_mark_range  check (pass_mark is null or (pass_mark >= 0 and pass_mark <= 100)),
  constraint summative_attempts_positive check (max_attempts > 0),
  constraint summative_files_sane       check (min_files >= 0 and max_files >= min_files and max_files <= 20),
  constraint summative_weights_sum      check (question_weight + submission_weight = 100),
  constraint summative_weights_range    check (question_weight >= 0 and submission_weight >= 0),
  constraint summative_window_order     check (available_until is null or available_from is null or available_until > available_from),
  constraint summative_published_has_date
    check (publication_status <> 'PUBLISHED' or published_at is not null),
  -- Must ask for something.
  constraint summative_has_work         check (has_questions or requires_submission),
  -- If it carries no questions, all weight sits on the submission.
  constraint summative_weight_consistent
    check ((has_questions and question_weight > 0) or (not has_questions and question_weight = 0))
);

create index summative_module_idx      on summative_assessments (module_id, sequence);
create index summative_publication_idx on summative_assessments (publication_status);

create trigger summative_assessments_set_updated_at
  before update on summative_assessments
  for each row execute function app.set_updated_at();

comment on table summative_assessments is
  'Covers module summative assessments, practical assignments, written assignments and Portfolio of Evidence tasks — distinguished by task_brief and the submission requirements rather than by separate tables.';

-- ----------------------------------------------------------------------------
-- summative_questions
--
-- Permits the full question_type range: objective types auto-mark, the rest
-- route to an assessor.
-- ----------------------------------------------------------------------------
create table summative_questions (
  id             uuid primary key default gen_random_uuid(),
  assessment_id  uuid not null references summative_assessments(id) on delete cascade,

  question_type  question_type not null default 'MULTIPLE_CHOICE',
  prompt         text not null,
  help_text      text,
  explanation    text,
  -- Guidance shown to the assessor when marking a manual question.
  marking_notes  text,

  points         numeric(6,2) not null default 1,
  sequence       integer not null,
  is_active      boolean not null default true,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint summative_q_prompt_not_blank check (length(btrim(prompt)) > 0),
  constraint summative_q_points_positive  check (points > 0),
  constraint summative_q_sequence_positive check (sequence > 0),
  constraint summative_q_unique_sequence unique (assessment_id, sequence) deferrable initially deferred
);

create index summative_q_assessment_idx on summative_questions (assessment_id, sequence);

create trigger summative_questions_set_updated_at
  before update on summative_questions
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- summative_options
-- ----------------------------------------------------------------------------
create table summative_options (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references summative_questions(id) on delete cascade,

  label        text not null,
  is_correct   boolean not null default false,
  feedback     text,
  sequence     integer not null,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint summative_opt_label_not_blank check (length(btrim(label)) > 0),
  constraint summative_opt_sequence_positive check (sequence > 0),
  constraint summative_opt_unique_sequence unique (question_id, sequence) deferrable initially deferred
);

create index summative_opt_question_idx on summative_options (question_id, sequence);

create trigger summative_options_set_updated_at
  before update on summative_options
  for each row execute function app.set_updated_at();

comment on column summative_options.is_correct is
  'Never exposed to a learner (same protection as formative_options.is_correct).';

-- ----------------------------------------------------------------------------
-- summative_attempts
--
-- Status uses submission_status (DRAFT → OPEN → SUBMITTED → UNDER_REVIEW →
-- PASSED / FAILED / RESUBMISSION_REQUIRED → CLOSED) per the brief.
-- ----------------------------------------------------------------------------
create table summative_attempts (
  id                 uuid primary key default gen_random_uuid(),
  enrollment_id      uuid not null references enrollments(id)           on delete cascade,
  assessment_id      uuid not null references summative_assessments(id) on delete cascade,

  attempt_number     integer not null,
  status             submission_status not null default 'DRAFT',

  started_at         timestamptz not null default now(),
  submitted_at       timestamptz,
  review_started_at  timestamptz,
  graded_at          timestamptz,
  closed_at          timestamptz,

  assigned_assessor_id uuid references profiles(id) on delete set null,

  -- Component and final scores, all written by grade_summative_attempt().
  question_score     numeric(5,2),
  submission_score   numeric(5,2),
  final_score        numeric(5,2),
  passed             boolean,

  graded_by          uuid references profiles(id) on delete set null,
  assessor_feedback  text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint summative_att_unique unique (enrollment_id, assessment_id, attempt_number),
  constraint summative_att_number_positive check (attempt_number > 0),
  constraint summative_att_scores_range check (
    (question_score   is null or (question_score   between 0 and 100)) and
    (submission_score is null or (submission_score between 0 and 100)) and
    (final_score      is null or (final_score      between 0 and 100))
  ),
  constraint summative_att_submitted_has_date
    check (status not in ('SUBMITTED','UNDER_REVIEW','PASSED','FAILED','RESUBMISSION_REQUIRED','CLOSED')
           or submitted_at is not null),
  constraint summative_att_decided_has_result
    check (status not in ('PASSED','FAILED') or (final_score is not null and passed is not null))
);

create index summative_att_enrollment_idx on summative_attempts (enrollment_id);
create index summative_att_assessment_idx on summative_attempts (assessment_id);
create index summative_att_assessor_idx   on summative_attempts (assigned_assessor_id)
  where assigned_assessor_id is not null;
-- Drives the assessor grading queue.
create index summative_att_queue_idx      on summative_attempts (status, submitted_at)
  where status in ('SUBMITTED', 'UNDER_REVIEW');

create trigger summative_attempts_set_updated_at
  before update on summative_attempts
  for each row execute function app.set_updated_at();

comment on index summative_att_queue_idx is
  'Partial index backing the assessor grading queue.';

-- ----------------------------------------------------------------------------
-- summative_answers
-- ----------------------------------------------------------------------------
create table summative_answers (
  id                  uuid primary key default gen_random_uuid(),
  attempt_id          uuid not null references summative_attempts(id)  on delete cascade,
  question_id         uuid not null references summative_questions(id) on delete cascade,

  selected_option_ids uuid[] not null default '{}',
  text_answer         text,

  is_correct          boolean,
  points_awarded      numeric(6,2),
  -- Set when an assessor marks a SHORT_ANSWER / ESSAY question by hand.
  marked_by           uuid references profiles(id) on delete set null,
  marker_comment      text,

  answered_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint summative_ans_unique unique (attempt_id, question_id),
  constraint summative_ans_points_sane check (points_awarded is null or points_awarded >= 0)
);

create index summative_ans_attempt_idx on summative_answers (attempt_id);

create trigger summative_answers_set_updated_at
  before update on summative_answers
  for each row execute function app.set_updated_at();
