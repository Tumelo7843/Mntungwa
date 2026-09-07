-- ============================================================================
-- 007_formative_assessments.sql
--
-- Formative assessment: checks understanding *during* learning. Retryable,
-- auto-graded, feedback-bearing.
--
-- SECURITY (audit S-03, S-04). The demo shipped 20 answer keys in its
-- JavaScript bundle and graded in the browser. Here:
--   * formative_options.is_correct is never selectable by a learner (RLS, 019)
--   * learners submit ANSWERS, never a score
--   * grading happens inside submit_formative_attempt() (017), server-side
--   * formative_attempts.score_percent has no learner UPDATE grant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- formative_assessments
--
-- Attaches to a module, optionally narrowed to one lesson (a knowledge check
-- at the end of a specific lesson).
-- ----------------------------------------------------------------------------
create table formative_assessments (
  id                  uuid primary key default gen_random_uuid(),
  module_id           uuid not null references course_modules(id) on delete cascade,
  lesson_id           uuid references lessons(id) on delete cascade,

  title               text not null,
  instructions        text,

  pass_mark           numeric(5,2),        -- null → module, then course, then institution
  max_attempts        integer,             -- null → unlimited
  is_required         boolean not null default true,

  -- Presentation
  shuffle_questions   boolean not null default false,
  shuffle_options     boolean not null default false,
  -- Draw N questions at random from the attached pool. Null → use all.
  questions_per_attempt integer,
  time_limit_minutes  integer,

  feedback_policy     feedback_policy not null default 'AFTER_SUBMIT',
  show_correct_answers boolean not null default true,

  available_from      timestamptz,
  available_until     timestamptz,

  sequence            integer not null default 1,
  publication_status  publication_status not null default 'DRAFT',
  published_at        timestamptz,
  created_by          uuid references profiles(id) on delete set null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint formative_title_not_blank  check (length(btrim(title)) > 0),
  constraint formative_pass_mark_range  check (pass_mark is null or (pass_mark >= 0 and pass_mark <= 100)),
  constraint formative_attempts_positive check (max_attempts is null or max_attempts > 0),
  constraint formative_qpa_positive     check (questions_per_attempt is null or questions_per_attempt > 0),
  constraint formative_time_positive    check (time_limit_minutes is null or time_limit_minutes > 0),
  constraint formative_window_order     check (available_until is null or available_from is null or available_until > available_from),
  constraint formative_published_has_date
    check (publication_status <> 'PUBLISHED' or published_at is not null)
);

create index formative_module_idx      on formative_assessments (module_id, sequence);
create index formative_lesson_idx      on formative_assessments (lesson_id) where lesson_id is not null;
create index formative_publication_idx on formative_assessments (publication_status);

create trigger formative_assessments_set_updated_at
  before update on formative_assessments
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- formative_questions
-- ----------------------------------------------------------------------------
create table formative_questions (
  id             uuid primary key default gen_random_uuid(),
  assessment_id  uuid not null references formative_assessments(id) on delete cascade,

  question_type  question_type not null default 'MULTIPLE_CHOICE',
  prompt         text not null,
  help_text      text,
  -- Shown after submission when the feedback policy allows it.
  explanation    text,

  points         numeric(6,2) not null default 1,
  sequence       integer not null,
  is_active      boolean not null default true,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint formative_q_prompt_not_blank check (length(btrim(prompt)) > 0),
  constraint formative_q_points_positive  check (points > 0),
  constraint formative_q_sequence_positive check (sequence > 0),
  -- Formative assessment is auto-graded, so only objective types are allowed.
  constraint formative_q_objective_only
    check (question_type in ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'MULTIPLE_SELECT')),
  constraint formative_q_unique_sequence unique (assessment_id, sequence) deferrable initially deferred
);

create index formative_q_assessment_idx on formative_questions (assessment_id, sequence);

create trigger formative_questions_set_updated_at
  before update on formative_questions
  for each row execute function app.set_updated_at();

comment on constraint formative_q_objective_only on formative_questions is
  'Formative assessments grade automatically, so SHORT_ANSWER/ESSAY/FILE_UPLOAD belong on summative assessments instead.';

-- ----------------------------------------------------------------------------
-- formative_options
--
-- ★ is_correct is the secret this whole design protects.
-- ----------------------------------------------------------------------------
create table formative_options (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references formative_questions(id) on delete cascade,

  label        text not null,
  is_correct   boolean not null default false,
  feedback     text,
  sequence     integer not null,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint formative_opt_label_not_blank check (length(btrim(label)) > 0),
  constraint formative_opt_sequence_positive check (sequence > 0),
  constraint formative_opt_unique_sequence unique (question_id, sequence) deferrable initially deferred
);

create index formative_opt_question_idx on formative_options (question_id, sequence);

create trigger formative_options_set_updated_at
  before update on formative_options
  for each row execute function app.set_updated_at();

comment on column formative_options.is_correct is
  'NEVER exposed to a learner. RLS grants learners no SELECT on this table; the safe view formative_options_public omits it (audit S-03, risk R-01).';

-- Validate the option set matches the question type. Deferred so a builder
-- can insert a question and its options in one transaction.
create or replace function app.validate_formative_options()
returns trigger
language plpgsql
as $$
declare
  v_type      question_type;
  v_total     integer;
  v_correct   integer;
  v_qid       uuid;
begin
  v_qid := coalesce(new.question_id, old.question_id);

  select question_type into v_type from formative_questions where id = v_qid;
  if v_type is null then
    return coalesce(new, old);   -- question deleted; cascade will clean up
  end if;

  select count(*), count(*) filter (where is_correct)
    into v_total, v_correct
    from formative_options where question_id = v_qid;

  if v_total = 0 then
    return coalesce(new, old);   -- mid-build
  end if;

  if v_type = 'TRUE_FALSE' and v_total <> 2 then
    raise exception 'TRUE_FALSE question % must have exactly 2 options (has %)', v_qid, v_total;
  end if;

  if v_type in ('MULTIPLE_CHOICE', 'TRUE_FALSE') and v_correct <> 1 then
    raise exception 'Question % (%) must have exactly 1 correct option (has %)', v_qid, v_type, v_correct;
  end if;

  if v_type = 'MULTIPLE_SELECT' and v_correct < 1 then
    raise exception 'MULTIPLE_SELECT question % must have at least 1 correct option', v_qid;
  end if;

  if v_total < 2 then
    raise exception 'Question % must have at least 2 options', v_qid;
  end if;

  return coalesce(new, old);
end;
$$;

create constraint trigger formative_options_validate
  after insert or update or delete on formative_options
  deferrable initially deferred
  for each row execute function app.validate_formative_options();

-- ----------------------------------------------------------------------------
-- formative_attempts
-- ----------------------------------------------------------------------------
create table formative_attempts (
  id              uuid primary key default gen_random_uuid(),
  enrollment_id   uuid not null references enrollments(id)           on delete cascade,
  assessment_id   uuid not null references formative_assessments(id) on delete cascade,

  attempt_number  integer not null,
  status          attempt_status not null default 'IN_PROGRESS',

  -- Question set for this attempt, fixed at start time so a learner cannot
  -- reroll a random draw by refreshing.
  question_ids    uuid[] not null default '{}',

  started_at      timestamptz not null default now(),
  expires_at      timestamptz,
  submitted_at    timestamptz,
  graded_at       timestamptz,

  -- Written by submit_formative_attempt() only.
  points_earned   numeric(8,2),
  points_possible numeric(8,2),
  score_percent   numeric(5,2),
  passed          boolean,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint formative_att_unique unique (enrollment_id, assessment_id, attempt_number),
  constraint formative_att_number_positive check (attempt_number > 0),
  constraint formative_att_score_range check (score_percent is null or (score_percent >= 0 and score_percent <= 100)),
  constraint formative_att_points_sane  check (
    points_earned is null or points_possible is null or
    (points_earned >= 0 and points_earned <= points_possible)
  ),
  constraint formative_att_submitted_has_date
    check (status not in ('SUBMITTED', 'GRADED') or submitted_at is not null),
  constraint formative_att_graded_has_result
    check (status <> 'GRADED' or (score_percent is not null and passed is not null))
);

create index formative_att_enrollment_idx on formative_attempts (enrollment_id);
create index formative_att_assessment_idx on formative_attempts (assessment_id);
create index formative_att_open_idx       on formative_attempts (enrollment_id, assessment_id)
  where status = 'IN_PROGRESS';

create trigger formative_attempts_set_updated_at
  before update on formative_attempts
  for each row execute function app.set_updated_at();

comment on column formative_attempts.score_percent is
  'Calculated server-side by submit_formative_attempt(). Learners have no UPDATE grant on this table (audit S-04).';

-- ----------------------------------------------------------------------------
-- formative_answers
--
-- The learner writes selected_option_ids. is_correct and points_awarded are
-- written by the grading function.
-- ----------------------------------------------------------------------------
create table formative_answers (
  id                  uuid primary key default gen_random_uuid(),
  attempt_id          uuid not null references formative_attempts(id)  on delete cascade,
  question_id         uuid not null references formative_questions(id) on delete cascade,

  selected_option_ids uuid[] not null default '{}',
  text_answer         text,

  -- Grading output.
  is_correct          boolean,
  points_awarded      numeric(6,2),

  answered_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint formative_ans_unique unique (attempt_id, question_id),
  constraint formative_ans_points_sane check (points_awarded is null or points_awarded >= 0)
);

create index formative_ans_attempt_idx on formative_answers (attempt_id);

create trigger formative_answers_set_updated_at
  before update on formative_answers
  for each row execute function app.set_updated_at();
