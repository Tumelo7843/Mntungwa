-- ============================================================================
-- 011_final_exams.sql
--
-- The final examination. Entirely new: the demo had no exam engine and
-- treated "28/28 modules passed" as clearance (audit §7.4, decision D-04).
--
-- BR-005: a learner must satisfy the configured eligibility requirements
--         before starting the final exam.
-- BR-006: a learner must pass the final examination before certificate
--         eligibility.
--
-- Eligibility is evaluated by check_final_exam_eligibility() (migration 017)
-- and re-checked inside start_final_exam_attempt(). The client never decides.
-- ============================================================================

create table final_exams (
  id                      uuid primary key default gen_random_uuid(),
  course_id               uuid not null references courses(id) on delete cascade,

  title                   text not null,
  instructions            text,

  duration_minutes        integer not null default 120,
  pass_mark               numeric(5,2) not null default 50,
  max_attempts            integer not null default 2,
  -- Cooling-off period between attempts.
  retake_wait_hours       integer not null default 24,

  -- Question selection
  questions_per_attempt   integer,          -- null → all active questions
  shuffle_questions       boolean not null default true,
  shuffle_options         boolean not null default true,

  -- Eligibility rules (BR-005). Evaluated server-side.
  require_all_modules     boolean not null default true,
  require_required_modules_only boolean not null default true,
  require_formatives      boolean not null default true,
  require_summatives      boolean not null default true,
  require_poe             boolean not null default true,
  require_payment_cleared boolean not null default true,
  require_documents_verified boolean not null default true,
  min_modules_passed      integer,          -- optional numeric floor
  min_credits_earned      integer,

  -- Manual marking
  requires_manual_marking boolean not null default false,
  release_results_automatically boolean not null default true,

  available_from          timestamptz,
  available_until         timestamptz,

  publication_status      publication_status not null default 'DRAFT',
  published_at            timestamptz,
  created_by              uuid references profiles(id) on delete set null,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint final_exam_title_not_blank  check (length(btrim(title)) > 0),
  constraint final_exam_duration_positive check (duration_minutes > 0 and duration_minutes <= 600),
  constraint final_exam_pass_mark_range  check (pass_mark >= 0 and pass_mark <= 100),
  constraint final_exam_attempts_positive check (max_attempts > 0),
  constraint final_exam_wait_sane        check (retake_wait_hours >= 0),
  constraint final_exam_qpa_positive     check (questions_per_attempt is null or questions_per_attempt > 0),
  constraint final_exam_min_modules_sane check (min_modules_passed is null or min_modules_passed >= 0),
  constraint final_exam_min_credits_sane check (min_credits_earned is null or min_credits_earned >= 0),
  constraint final_exam_window_order     check (available_until is null or available_from is null or available_until > available_from),
  constraint final_exam_published_has_date
    check (publication_status <> 'PUBLISHED' or published_at is not null),
  -- One live exam per course.
  constraint final_exam_one_per_course unique (course_id)
);

create trigger final_exams_set_updated_at
  before update on final_exams
  for each row execute function app.set_updated_at();

comment on table final_exams is
  'High-stakes assessment gating certificate eligibility. In the seeded QCTO curriculum this represents internal EISA readiness, not the external QCTO assessment itself (decision D-04).';

-- ----------------------------------------------------------------------------
-- final_exam_questions — the exam question bank
-- ----------------------------------------------------------------------------
create table final_exam_questions (
  id             uuid primary key default gen_random_uuid(),
  exam_id        uuid not null references final_exams(id) on delete cascade,
  -- Optional provenance: which module this question assesses. Enables
  -- balanced random draws across the curriculum.
  module_id      uuid references course_modules(id) on delete set null,

  question_type  question_type not null default 'MULTIPLE_CHOICE',
  prompt         text not null,
  help_text      text,
  explanation    text,
  marking_notes  text,

  points         numeric(6,2) not null default 1,
  difficulty     smallint,
  sequence       integer not null,
  is_active      boolean not null default true,

  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint final_q_prompt_not_blank  check (length(btrim(prompt)) > 0),
  constraint final_q_points_positive   check (points > 0),
  constraint final_q_sequence_positive check (sequence > 0),
  constraint final_q_difficulty_range  check (difficulty is null or difficulty between 1 and 5),
  constraint final_q_unique_sequence unique (exam_id, sequence) deferrable initially deferred
);

create index final_q_exam_idx   on final_exam_questions (exam_id, sequence);
create index final_q_active_idx on final_exam_questions (exam_id) where is_active = true;
create index final_q_module_idx on final_exam_questions (module_id) where module_id is not null;

create trigger final_exam_questions_set_updated_at
  before update on final_exam_questions
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- final_exam_options
-- ----------------------------------------------------------------------------
create table final_exam_options (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references final_exam_questions(id) on delete cascade,

  label        text not null,
  is_correct   boolean not null default false,
  feedback     text,
  sequence     integer not null,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint final_opt_label_not_blank   check (length(btrim(label)) > 0),
  constraint final_opt_sequence_positive check (sequence > 0),
  constraint final_opt_unique_sequence unique (question_id, sequence) deferrable initially deferred
);

create index final_opt_question_idx on final_exam_options (question_id, sequence);

create trigger final_exam_options_set_updated_at
  before update on final_exam_options
  for each row execute function app.set_updated_at();

comment on column final_exam_options.is_correct is
  'Never exposed to a learner, including during an active attempt (audit S-03).';

-- ----------------------------------------------------------------------------
-- final_exam_attempts
--
-- expires_at is stamped server-side at start. submit_final_exam_attempt()
-- compares against now() so a learner cannot extend their own time by
-- tampering with the client clock.
-- ----------------------------------------------------------------------------
create table final_exam_attempts (
  id                 uuid primary key default gen_random_uuid(),
  enrollment_id      uuid not null references enrollments(id)  on delete cascade,
  exam_id            uuid not null references final_exams(id)  on delete cascade,

  attempt_number     integer not null,
  status             attempt_status not null default 'IN_PROGRESS',

  -- Fixed at start: prevents rerolling a random draw by restarting.
  question_ids       uuid[] not null default '{}',

  started_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  submitted_at       timestamptz,
  graded_at          timestamptz,

  -- Eligibility snapshot, captured at start for the audit trail.
  eligibility_snapshot jsonb,

  points_earned      numeric(8,2),
  points_possible    numeric(8,2),
  score_percent      numeric(5,2),
  passed             boolean,

  requires_manual_marking boolean not null default false,
  marked_by          uuid references profiles(id) on delete set null,
  released_at        timestamptz,

  -- Light-touch integrity signals, advisory only.
  submitted_late     boolean not null default false,
  auto_submitted     boolean not null default false,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint final_att_unique unique (enrollment_id, exam_id, attempt_number),
  constraint final_att_number_positive check (attempt_number > 0),
  constraint final_att_expiry_after_start check (expires_at > started_at),
  constraint final_att_score_range check (score_percent is null or (score_percent >= 0 and score_percent <= 100)),
  constraint final_att_points_sane check (
    points_earned is null or points_possible is null or
    (points_earned >= 0 and points_earned <= points_possible)
  ),
  constraint final_att_submitted_has_date
    check (status not in ('SUBMITTED', 'GRADED') or submitted_at is not null),
  constraint final_att_graded_has_result
    check (status <> 'GRADED' or (score_percent is not null and passed is not null))
);

create index final_att_enrollment_idx on final_exam_attempts (enrollment_id);
create index final_att_exam_idx       on final_exam_attempts (exam_id);
create index final_att_open_idx       on final_exam_attempts (enrollment_id)
  where status = 'IN_PROGRESS';
create index final_att_marking_idx    on final_exam_attempts (status, submitted_at)
  where requires_manual_marking = true and status = 'SUBMITTED';

create trigger final_exam_attempts_set_updated_at
  before update on final_exam_attempts
  for each row execute function app.set_updated_at();

comment on column final_exam_attempts.eligibility_snapshot is
  'What was true at the moment the exam was permitted. Retained so an audit can reconstruct why access was granted.';
comment on column final_exam_attempts.expires_at is
  'Server-stamped deadline. Enforced in submit_final_exam_attempt(); the client clock is irrelevant.';

-- ----------------------------------------------------------------------------
-- final_exam_answers
-- ----------------------------------------------------------------------------
create table final_exam_answers (
  id                  uuid primary key default gen_random_uuid(),
  attempt_id          uuid not null references final_exam_attempts(id)  on delete cascade,
  question_id         uuid not null references final_exam_questions(id) on delete cascade,

  selected_option_ids uuid[] not null default '{}',
  text_answer         text,

  is_correct          boolean,
  points_awarded      numeric(6,2),
  marked_by           uuid references profiles(id) on delete set null,
  marker_comment      text,

  answered_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint final_ans_unique unique (attempt_id, question_id),
  constraint final_ans_points_sane check (points_awarded is null or points_awarded >= 0)
);

create index final_ans_attempt_idx on final_exam_answers (attempt_id);

create trigger final_exam_answers_set_updated_at
  before update on final_exam_answers
  for each row execute function app.set_updated_at();

-- Wire up the FK deferred from migration 010.
alter table grades
  add constraint grades_final_exam_attempt_fk
  foreign key (final_exam_attempt_id) references final_exam_attempts(id) on delete cascade;
