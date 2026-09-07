-- ============================================================================
-- 017_business_functions.sql
--
-- THE AUTHORITATIVE LAYER.
--
-- Everything the demo computed in the browser now happens here:
--   QuizPage.grade()        → app.submit_formative_attempt()
--   gradeSubmission()       → app.grade_summative_attempt()
--   isUnlocked()            → app.recalculate_module_progress() / unlock chain
--   progressOf()            → app.recalculate_enrollment_progress()
--   certificateUnlocked     → app.check_certificate_eligibility()
--   (did not exist)         → app.start_final_exam_attempt() + eligibility
--
-- Every function is SECURITY DEFINER with a pinned search_path, validates the
-- caller itself, and writes an audit row for anything consequential.
--
-- The client submits ANSWERS and INTENT. It never submits scores, statuses or
-- eligibility flags (brief: "ASSESSMENT DATA INTEGRITY").
-- ============================================================================

-- ============================================================================
-- SECTION 1 — PROGRESSION
-- ============================================================================

-- ----------------------------------------------------------------------------
-- app.recalculate_module_progress(enrollment, module)
--
-- Recomputes one module_progress row from its underlying components and
-- returns the resulting status. Never trusts an existing value.
-- ----------------------------------------------------------------------------
create or replace function app.recalculate_module_progress(
  p_enrollment_id uuid,
  p_module_id     uuid
)
returns progress_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m                 course_modules%rowtype;
  v_lessons_total   integer;
  v_lessons_done    integer;
  v_form_required   integer;
  v_form_passed     integer;
  v_summ_required   integer;
  v_summ_passed     integer;
  v_best            numeric(5,2);
  v_current         progress_status;
  v_new             progress_status;
  v_any_activity    boolean;
  v_any_failed      boolean;
  v_any_pending     boolean;
begin
  select * into m from course_modules where id = p_module_id;
  if not found then
    raise exception 'Module % not found', p_module_id;
  end if;

  select status into v_current
    from module_progress
   where enrollment_id = p_enrollment_id and module_id = p_module_id;

  -- Never re-evaluate a locked module; unlocking is a separate decision made
  -- by app.refresh_module_unlocks().
  if coalesce(v_current, 'LOCKED') = 'LOCKED' then
    return 'LOCKED';
  end if;

  -- ---- Lessons ----
  select count(*) filter (where l.is_required),
         count(*) filter (where l.is_required and lp.status = 'COMPLETED')
    into v_lessons_total, v_lessons_done
    from lessons l
    left join lesson_progress lp
           on lp.lesson_id = l.id and lp.enrollment_id = p_enrollment_id
   where l.module_id = p_module_id
     and l.publication_status = 'PUBLISHED';

  -- ---- Formative ----
  select count(*) filter (where fa.is_required),
         count(*) filter (
           where fa.is_required and exists (
             select 1 from formative_attempts at
              where at.assessment_id = fa.id
                and at.enrollment_id = p_enrollment_id
                and at.passed is true
           )
         )
    into v_form_required, v_form_passed
    from formative_assessments fa
   where fa.module_id = p_module_id
     and fa.publication_status = 'PUBLISHED';

  -- ---- Summative ----
  select count(*) filter (where sa.is_required),
         count(*) filter (
           where sa.is_required and exists (
             select 1 from summative_attempts at
              where at.assessment_id = sa.id
                and at.enrollment_id = p_enrollment_id
                and at.status = 'PASSED'
           )
         )
    into v_summ_required, v_summ_passed
    from summative_assessments sa
   where sa.module_id = p_module_id
     and sa.publication_status = 'PUBLISHED';

  -- ---- Best score across this module's assessments ----
  select max(s) into v_best from (
    select max(at.score_percent) as s
      from formative_attempts at
      join formative_assessments fa on fa.id = at.assessment_id
     where fa.module_id = p_module_id and at.enrollment_id = p_enrollment_id
    union all
    select max(at.final_score)
      from summative_attempts at
      join summative_assessments sa on sa.id = at.assessment_id
     where sa.module_id = p_module_id and at.enrollment_id = p_enrollment_id
  ) x;

  -- ---- Outstanding / failed signals ----
  select
    exists (
      select 1 from summative_attempts at
        join summative_assessments sa on sa.id = at.assessment_id
       where sa.module_id = p_module_id and at.enrollment_id = p_enrollment_id
         and at.status in ('SUBMITTED','UNDER_REVIEW')
    ),
    exists (
      select 1 from summative_attempts at
        join summative_assessments sa on sa.id = at.assessment_id
       where sa.module_id = p_module_id and at.enrollment_id = p_enrollment_id
         and at.status in ('FAILED','RESUBMISSION_REQUIRED')
    )
    into v_any_pending, v_any_failed;

  select exists (
    select 1 from lesson_progress lp
      join lessons l on l.id = lp.lesson_id
     where l.module_id = p_module_id and lp.enrollment_id = p_enrollment_id
       and lp.status <> 'NOT_STARTED'
  ) or exists (
    select 1 from formative_attempts at
      join formative_assessments fa on fa.id = at.assessment_id
     where fa.module_id = p_module_id and at.enrollment_id = p_enrollment_id
  ) into v_any_activity;

  -- ---- Decide ----
  -- All configured requirements met → PASSED.
  if  (not m.require_all_lessons or v_lessons_done >= v_lessons_total)
  and (not m.require_formative    or v_form_passed >= v_form_required)
  and (not m.require_summative    or v_summ_passed >= v_summ_required)
  then
    v_new := 'PASSED';
  elsif v_any_pending then
    v_new := 'UNDER_REVIEW';
  elsif v_any_failed then
    v_new := 'RESUBMISSION_REQUIRED';
  elsif v_any_activity then
    v_new := 'IN_PROGRESS';
  else
    v_new := 'NOT_STARTED';
  end if;

  -- Preserve the demo's rule (audit §2.3): a module that has already PASSED is
  -- never downgraded by a later voluntary attempt.
  if v_current = 'PASSED' then
    v_new := 'PASSED';
  end if;

  update module_progress
     set status              = v_new,
         lessons_total       = v_lessons_total,
         lessons_completed   = v_lessons_done,
         formatives_required = v_form_required,
         formatives_passed   = v_form_passed,
         summatives_required = v_summ_required,
         summatives_passed   = v_summ_passed,
         best_score          = greatest(coalesce(best_score, 0), coalesce(v_best, 0)),
         credits_awarded     = case when v_new = 'PASSED' then m.credits else 0 end,
         started_at          = coalesce(started_at, case when v_any_activity then now() end),
         completed_at        = case when v_new = 'PASSED' then coalesce(completed_at, now()) else completed_at end,
         passed_at           = case when v_new = 'PASSED' then coalesce(passed_at, now()) else passed_at end
   where enrollment_id = p_enrollment_id and module_id = p_module_id;

  return v_new;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.refresh_module_unlocks(enrollment)
--
-- The production replacement for isUnlocked(). Walks the course's modules in
-- sequence and unlocks each one whose prerequisite has PASSED.
--
-- Seeded as a strict linear chain (decision D-02), so behaviour matches the
-- demo exactly — but the chain is data, so the institution can branch it.
-- Returns the number of modules newly unlocked.
-- ----------------------------------------------------------------------------
create or replace function app.refresh_module_unlocks(p_enrollment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e            enrollments%rowtype;
  m            record;
  v_unlocked   integer := 0;
  v_prereq_ok  boolean;
  v_status     progress_status;
begin
  select * into e from enrollments where id = p_enrollment_id;
  if not found then
    raise exception 'Enrollment % not found', p_enrollment_id;
  end if;

  -- BR-001: no content access without an active enrollment.
  if e.status <> 'ACTIVE' then
    return 0;
  end if;

  for m in
    select * from course_modules
     where course_id = e.course_id
       and publication_status = 'PUBLISHED'
     order by sequence
  loop
    -- Ensure a progress row exists.
    insert into module_progress (enrollment_id, module_id, status)
    values (p_enrollment_id, m.id, 'LOCKED')
    on conflict (enrollment_id, module_id) do nothing;

    select status into v_status
      from module_progress
     where enrollment_id = p_enrollment_id and module_id = m.id;

    if v_status <> 'LOCKED' then
      continue;                      -- already open
    end if;

    -- No prerequisite → open immediately.
    if m.prerequisite_module_id is null then
      v_prereq_ok := true;
    else
      select (status = 'PASSED') into v_prereq_ok
        from module_progress
       where enrollment_id = p_enrollment_id
         and module_id     = m.prerequisite_module_id;
      v_prereq_ok := coalesce(v_prereq_ok, false);
    end if;

    if v_prereq_ok then
      update module_progress
         set status      = 'NOT_STARTED',
             unlocked_at = now()
       where enrollment_id = p_enrollment_id and module_id = m.id;
      v_unlocked := v_unlocked + 1;
    end if;
  end loop;

  return v_unlocked;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.recalculate_enrollment_progress(enrollment)
--
-- Replaces progressOf(). Credits are SUMMED from passed modules rather than
-- compared against a hard-coded 240 (fixes audit C-06).
-- ----------------------------------------------------------------------------
create or replace function app.recalculate_enrollment_progress(p_enrollment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e             enrollments%rowtype;
  v_total       integer;
  v_passed      integer;
  v_credits     integer;
  v_pct         numeric(5,2);
  v_final_ok    boolean;
  v_complete    boolean;
begin
  select * into e from enrollments where id = p_enrollment_id;
  if not found then return; end if;

  select count(*) filter (where m.is_required),
         count(*) filter (where m.is_required and mp.status = 'PASSED'),
         coalesce(sum(mp.credits_awarded), 0)
    into v_total, v_passed, v_credits
    from course_modules m
    left join module_progress mp
           on mp.module_id = m.id and mp.enrollment_id = p_enrollment_id
   where m.course_id = e.course_id
     and m.publication_status = 'PUBLISHED';

  v_pct := case when coalesce(v_total, 0) = 0 then 0
                else round((v_passed::numeric / v_total) * 100, 2) end;

  select exists (
    select 1 from final_exam_attempts fea
      join final_exams fe on fe.id = fea.exam_id
     where fea.enrollment_id = p_enrollment_id
       and fea.passed is true
  ) into v_final_ok;

  v_complete := (v_total > 0 and v_passed >= v_total)
                and (not (select require_final_exam from courses where id = e.course_id) or v_final_ok);

  update enrollments
     set modules_total     = coalesce(v_total, 0),
         modules_passed    = coalesce(v_passed, 0),
         credits_earned    = coalesce(v_credits, 0),
         progress_percent  = v_pct,
         final_exam_passed = v_final_ok,
         course_completed  = v_complete,
         status       = case when v_complete and status = 'ACTIVE' then 'COMPLETED'::enrollment_status else status end,
         completed_at = case when v_complete then coalesce(completed_at, now()) else completed_at end
   where id = p_enrollment_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.after_module_result(enrollment, module)
-- Recalculate → unlock downstream → roll up. Called after every result event.
-- ----------------------------------------------------------------------------
create or replace function app.after_module_result(
  p_enrollment_id uuid,
  p_module_id     uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.recalculate_module_progress(p_enrollment_id, p_module_id);
  perform app.refresh_module_unlocks(p_enrollment_id);
  perform app.recalculate_enrollment_progress(p_enrollment_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- Learner-callable: mark a lesson complete.
-- Validates ownership and module access; the client cannot mark a lesson in a
-- locked module or in someone else's enrollment.
-- ----------------------------------------------------------------------------
create or replace function public.complete_lesson(p_lesson_id uuid)
returns progress_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_module_id     uuid;
  v_enrollment_id uuid;
  v_course_id     uuid;
begin
  select l.module_id, m.course_id into v_module_id, v_course_id
    from lessons l join course_modules m on m.id = l.module_id
   where l.id = p_lesson_id and l.publication_status = 'PUBLISHED';

  if v_module_id is null then
    raise exception 'Lesson not found or not published' using errcode = 'P0002';
  end if;

  v_enrollment_id := app.my_active_enrollment(v_course_id);
  if v_enrollment_id is null then
    raise exception 'No active enrollment for this course' using errcode = '42501';
  end if;

  if not app.can_access_module(v_module_id) then
    raise exception 'Module is locked' using errcode = '42501';
  end if;

  insert into lesson_progress (enrollment_id, lesson_id, status, first_opened_at, completed_at)
  values (v_enrollment_id, p_lesson_id, 'COMPLETED', now(), now())
  on conflict (enrollment_id, lesson_id) do update
    set status       = 'COMPLETED',
        completed_at = coalesce(lesson_progress.completed_at, now());

  perform app.after_module_result(v_enrollment_id, v_module_id);

  return (select status from module_progress
           where enrollment_id = v_enrollment_id and module_id = v_module_id);
end;
$$;

-- ============================================================================
-- SECTION 2 — FORMATIVE ASSESSMENT
-- ============================================================================

-- ----------------------------------------------------------------------------
-- public.start_formative_attempt(assessment)
--
-- Enforces access, attempt limits and the availability window, then fixes the
-- question set so a learner cannot reroll a random draw by restarting.
-- ----------------------------------------------------------------------------
create or replace function public.start_formative_attempt(p_assessment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  fa              formative_assessments%rowtype;
  v_course_id     uuid;
  v_enrollment_id uuid;
  v_used          integer;
  v_open          uuid;
  v_qids          uuid[];
  v_attempt_id    uuid;
begin
  select * into fa from formative_assessments where id = p_assessment_id;
  if not found or fa.publication_status <> 'PUBLISHED' then
    raise exception 'Assessment not found or not published' using errcode = 'P0002';
  end if;

  select course_id into v_course_id from course_modules where id = fa.module_id;
  v_enrollment_id := app.my_active_enrollment(v_course_id);
  if v_enrollment_id is null then
    raise exception 'No active enrollment for this course' using errcode = '42501';
  end if;

  if not app.can_access_module(fa.module_id) then
    raise exception 'Module is locked' using errcode = '42501';
  end if;

  if fa.available_from  is not null and now() < fa.available_from then
    raise exception 'This assessment is not yet available' using errcode = '42501';
  end if;
  if fa.available_until is not null and now() > fa.available_until then
    raise exception 'This assessment has closed' using errcode = '42501';
  end if;

  -- Resume an attempt already in progress rather than starting a second one.
  select id into v_open from formative_attempts
   where enrollment_id = v_enrollment_id
     and assessment_id = p_assessment_id
     and status = 'IN_PROGRESS'
   limit 1;
  if v_open is not null then
    return v_open;
  end if;

  select count(*) into v_used from formative_attempts
   where enrollment_id = v_enrollment_id and assessment_id = p_assessment_id;

  if fa.max_attempts is not null and v_used >= fa.max_attempts then
    raise exception 'Attempt limit of % reached for this assessment', fa.max_attempts
      using errcode = '42501';
  end if;

  -- Fix the question set now.
  select coalesce(array_agg(id order by ord), '{}') into v_qids
    from (
      select id,
             case when fa.shuffle_questions then random() else sequence::numeric end as ord
        from formative_questions
       where assessment_id = p_assessment_id and is_active
       order by ord
       limit coalesce(fa.questions_per_attempt, 2147483647)
    ) q;

  if array_length(v_qids, 1) is null then
    raise exception 'This assessment has no active questions' using errcode = 'P0002';
  end if;

  insert into formative_attempts (
    enrollment_id, assessment_id, attempt_number, status, question_ids, expires_at
  )
  values (
    v_enrollment_id, p_assessment_id, v_used + 1, 'IN_PROGRESS', v_qids,
    case when fa.time_limit_minutes is not null
         then now() + make_interval(mins => fa.time_limit_minutes) end
  )
  returning id into v_attempt_id;

  return v_attempt_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- public.save_formative_answer(attempt, question, options, text)
-- ----------------------------------------------------------------------------
create or replace function public.save_formative_answer(
  p_attempt_id  uuid,
  p_question_id uuid,
  p_option_ids  uuid[] default '{}',
  p_text        text   default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  at formative_attempts%rowtype;
begin
  select * into at from formative_attempts where id = p_attempt_id;
  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;
  if not app.owns_enrollment(at.enrollment_id) then
    raise exception 'Not your attempt' using errcode = '42501';
  end if;
  if at.status <> 'IN_PROGRESS' then
    raise exception 'This attempt has already been submitted' using errcode = '42501';
  end if;
  if at.expires_at is not null and now() > at.expires_at then
    raise exception 'Time limit exceeded' using errcode = '42501';
  end if;
  if not (p_question_id = any(at.question_ids)) then
    raise exception 'Question is not part of this attempt' using errcode = '42501';
  end if;

  insert into formative_answers (attempt_id, question_id, selected_option_ids, text_answer)
  values (p_attempt_id, p_question_id, coalesce(p_option_ids, '{}'), p_text)
  on conflict (attempt_id, question_id) do update
    set selected_option_ids = excluded.selected_option_ids,
        text_answer         = excluded.text_answer,
        answered_at         = now();
end;
$$;

-- ----------------------------------------------------------------------------
-- public.submit_formative_attempt(attempt)
--
-- ★ THE FIX FOR AUDIT S-03 AND S-04.
--
-- Grading happens here, comparing against formative_options.is_correct, which
-- no learner can read. The score is computed, not accepted.
-- ----------------------------------------------------------------------------
create or replace function public.submit_formative_attempt(p_attempt_id uuid)
returns table (
  score_percent numeric,
  passed        boolean,
  points_earned numeric,
  points_possible numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  at         formative_attempts%rowtype;
  fa         formative_assessments%rowtype;
  v_module   uuid;
  v_course   uuid;
  q          record;
  v_correct_ids uuid[];
  v_given_ids   uuid[];
  v_is_correct  boolean;
  v_earned   numeric(8,2) := 0;
  v_possible numeric(8,2) := 0;
  v_pct      numeric(5,2);
  v_mark     numeric(5,2);
  v_passed   boolean;
begin
  select * into at from formative_attempts where id = p_attempt_id for update;
  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;
  if not app.owns_enrollment(at.enrollment_id) then
    raise exception 'Not your attempt' using errcode = '42501';
  end if;
  if at.status <> 'IN_PROGRESS' then
    raise exception 'This attempt has already been submitted' using errcode = '42501';
  end if;

  select * into fa from formative_assessments where id = at.assessment_id;
  select cm.id, cm.course_id into v_module, v_course
    from course_modules cm where cm.id = fa.module_id;

  -- Grade every question in the fixed set.
  for q in
    select fq.id, fq.points, fq.question_type
      from formative_questions fq
     where fq.id = any(at.question_ids)
  loop
    v_possible := v_possible + q.points;

    select coalesce(array_agg(id order by id), '{}') into v_correct_ids
      from formative_options where question_id = q.id and is_correct;

    select coalesce(array_agg(x order by x), '{}') into v_given_ids
      from (
        select unnest(selected_option_ids) as x
          from formative_answers
         where attempt_id = p_attempt_id and question_id = q.id
      ) s;

    -- Exact set match. MULTIPLE_SELECT is all-or-nothing: no partial credit,
    -- which matches the demo's per-question scoring and avoids silently
    -- rewarding a guess-everything strategy.
    v_is_correct := (v_given_ids = v_correct_ids) and array_length(v_given_ids, 1) is not null;

    update formative_answers
       set is_correct     = v_is_correct,
           points_awarded = case when v_is_correct then q.points else 0 end
     where attempt_id = p_attempt_id and question_id = q.id;

    -- An unanswered question scores zero rather than being skipped.
    if v_is_correct then
      v_earned := v_earned + q.points;
    end if;
  end loop;

  v_pct  := case when v_possible = 0 then 0 else round((v_earned / v_possible) * 100, 2) end;
  v_mark := app.effective_pass_mark(fa.pass_mark, v_module, v_course);
  v_passed := v_pct >= v_mark;

  update formative_attempts
     set status          = 'GRADED',
         submitted_at    = now(),
         graded_at       = now(),
         points_earned   = v_earned,
         points_possible = v_possible,
         score_percent   = v_pct,
         passed          = v_passed
   where id = p_attempt_id;

  perform app.after_module_result(at.enrollment_id, v_module);

  perform app.create_audit_log(
    'FORMATIVE_ATTEMPT_SUBMITTED', 'formative_attempt', p_attempt_id, fa.title,
    null,
    jsonb_build_object('score_percent', v_pct, 'passed', v_passed, 'attempt_number', at.attempt_number)
  );

  return query select v_pct, v_passed, v_earned, v_possible;
end;
$$;

-- ============================================================================
-- SECTION 3 — SUMMATIVE ASSESSMENT & GRADING
-- ============================================================================

create or replace function public.start_summative_attempt(p_assessment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sa              summative_assessments%rowtype;
  v_course_id     uuid;
  v_enrollment_id uuid;
  v_used          integer;
  v_open          uuid;
  v_attempt_id    uuid;
begin
  select * into sa from summative_assessments where id = p_assessment_id;
  if not found or sa.publication_status <> 'PUBLISHED' then
    raise exception 'Assessment not found or not published' using errcode = 'P0002';
  end if;

  select course_id into v_course_id from course_modules where id = sa.module_id;
  v_enrollment_id := app.my_active_enrollment(v_course_id);
  if v_enrollment_id is null then
    raise exception 'No active enrollment for this course' using errcode = '42501';
  end if;
  if not app.can_access_module(sa.module_id) then
    raise exception 'Module is locked' using errcode = '42501';
  end if;
  if sa.available_until is not null and now() > sa.available_until then
    raise exception 'This assessment has closed' using errcode = '42501';
  end if;

  select id into v_open from summative_attempts
   where enrollment_id = v_enrollment_id
     and assessment_id = p_assessment_id
     and status in ('DRAFT','OPEN','RESUBMISSION_REQUIRED')
   order by attempt_number desc limit 1;
  if v_open is not null then
    return v_open;
  end if;

  select count(*) into v_used from summative_attempts
   where enrollment_id = v_enrollment_id and assessment_id = p_assessment_id;

  if v_used >= sa.max_attempts then
    raise exception 'Attempt limit of % reached', sa.max_attempts using errcode = '42501';
  end if;

  insert into summative_attempts (enrollment_id, assessment_id, attempt_number, status)
  values (v_enrollment_id, p_assessment_id, v_used + 1, 'OPEN')
  returning id into v_attempt_id;

  insert into submissions (attempt_id, enrollment_id, status)
  values (v_attempt_id, v_enrollment_id, 'DRAFT');

  return v_attempt_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- public.submit_summative_attempt(attempt, note)
--
-- Validates that required evidence is actually present before allowing the
-- state to leave DRAFT — preventing the demo's empty "submitted" (audit M-12).
-- ----------------------------------------------------------------------------
create or replace function public.submit_summative_attempt(
  p_attempt_id uuid,
  p_note       text default null
)
returns submission_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  at         summative_attempts%rowtype;
  sa         summative_assessments%rowtype;
  sub        submissions%rowtype;
  v_files    integer := 0;
  v_version  integer;
  v_version_id uuid;
begin
  select * into at from summative_attempts where id = p_attempt_id for update;
  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;
  if not app.owns_enrollment(at.enrollment_id) then
    raise exception 'Not your attempt' using errcode = '42501';
  end if;
  if at.status not in ('DRAFT','OPEN','RESUBMISSION_REQUIRED') then
    raise exception 'This attempt cannot be submitted from status %', at.status using errcode = '42501';
  end if;

  select * into sa  from summative_assessments where id = at.assessment_id;
  select * into sub from submissions where attempt_id = p_attempt_id;

  if sa.requires_submission then
    -- Count files staged against the highest existing version.
    select count(*) into v_files
      from submission_files sf
      join submission_versions sv on sv.id = sf.version_id
     where sv.submission_id = sub.id
       and sv.version_number = (
         select max(version_number) from submission_versions where submission_id = sub.id
       );

    if coalesce(v_files, 0) < sa.min_files then
      raise exception 'At least % file(s) must be uploaded before submitting (found %)',
        sa.min_files, coalesce(v_files, 0) using errcode = '23514';
    end if;
  end if;

  select coalesce(max(version_number), 0) into v_version
    from submission_versions where submission_id = sub.id;

  update submissions
     set status             = 'SUBMITTED',
         current_version    = greatest(v_version, 1),
         first_submitted_at = coalesce(first_submitted_at, now()),
         last_submitted_at  = now(),
         learner_note       = coalesce(p_note, learner_note)
   where id = sub.id;

  update summative_attempts
     set status       = 'SUBMITTED',
         submitted_at = now()
   where id = p_attempt_id;

  perform app.after_module_result(at.enrollment_id, sa.module_id);

  perform app.create_audit_log(
    'SUBMISSION_CREATED', 'summative_attempt', p_attempt_id, sa.title,
    null, jsonb_build_object('attempt_number', at.attempt_number, 'files', v_files)
  );

  -- Notify assessors that the queue has grown.
  perform app.notify(
    ur.profile_id, 'SUBMISSION_RECEIVED', 'New submission awaiting assessment',
    sa.title, '/admin/submissions/' || p_attempt_id::text, 'summative_attempt', p_attempt_id
  )
  from user_roles ur where ur.role in ('ASSESSOR','ADMIN');

  return 'SUBMITTED';
end;
$$;

-- ----------------------------------------------------------------------------
-- public.grade_summative_attempt(...)
--
-- BR-007: assessor-only. BR-008: learners cannot reach this.
-- Replaces gradeSubmission(). The pass/fail decision is arithmetic against the
-- effective pass mark, not a value supplied by the caller.
-- ----------------------------------------------------------------------------
create or replace function public.grade_summative_attempt(
  p_attempt_id      uuid,
  p_criteria_scores jsonb   default '[]'::jsonb,   -- [{"criterion_id":"...","points":8,"comment":"..."}]
  p_raw_score       numeric default null,          -- used when no rubric applies
  p_feedback        text    default null,
  p_release         boolean default true
)
returns table (final_score numeric, passed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  at            summative_attempts%rowtype;
  sa            summative_assessments%rowtype;
  v_course      uuid;
  v_mark        numeric(5,2);
  v_rubric_max  numeric(8,2);
  v_rubric_got  numeric(8,2) := 0;
  v_sub_score   numeric(5,2);
  v_q_earned    numeric(8,2) := 0;
  v_q_possible  numeric(8,2) := 0;
  v_q_score     numeric(5,2) := 0;
  v_final       numeric(5,2);
  v_passed      boolean;
  v_grade_id    uuid;
  v_prev        uuid;
  item          jsonb;
  v_learner     uuid;
begin
  if not app.is_assessor() then
    raise exception 'Only an assessor may grade submissions' using errcode = '42501';
  end if;

  select * into at from summative_attempts where id = p_attempt_id for update;
  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;
  if at.status not in ('SUBMITTED','UNDER_REVIEW') then
    raise exception 'Attempt is not awaiting assessment (status %)', at.status using errcode = '42501';
  end if;

  select * into sa from summative_assessments where id = at.assessment_id;
  select course_id into v_course from course_modules where id = sa.module_id;
  v_mark := app.effective_pass_mark(sa.pass_mark, sa.module_id, v_course);

  -- ---- Objective portion ----
  if sa.has_questions then
    select coalesce(sum(sq.points), 0),
           coalesce(sum(sans.points_awarded), 0)
      into v_q_possible, v_q_earned
      from summative_questions sq
      left join summative_answers sans
             on sans.question_id = sq.id and sans.attempt_id = p_attempt_id
     where sq.assessment_id = sa.id and sq.is_active;

    v_q_score := case when v_q_possible = 0 then 0
                      else round((v_q_earned / v_q_possible) * 100, 2) end;
  end if;

  -- ---- Assessor portion ----
  if sa.rubric_id is not null and jsonb_array_length(p_criteria_scores) > 0 then
    select coalesce(sum(max_points * weight), 0) into v_rubric_max
      from rubric_criteria where rubric_id = sa.rubric_id;

    if coalesce(v_rubric_max, 0) = 0 then
      raise exception 'Rubric % has no criteria', sa.rubric_id using errcode = '23514';
    end if;

    for item in select * from jsonb_array_elements(p_criteria_scores)
    loop
      v_rubric_got := v_rubric_got + (
        (item ->> 'points')::numeric *
        coalesce((select weight from rubric_criteria where id = (item ->> 'criterion_id')::uuid), 1)
      );
    end loop;

    v_sub_score := round((v_rubric_got / v_rubric_max) * 100, 2);
  elsif p_raw_score is not null then
    if p_raw_score < 0 or p_raw_score > 100 then
      raise exception 'Score must be between 0 and 100' using errcode = '23514';
    end if;
    v_sub_score := round(p_raw_score, 2);
  elsif sa.requires_submission then
    raise exception 'A rubric result or a raw score is required' using errcode = '23514';
  else
    v_sub_score := 0;
  end if;

  -- ---- Weighted final ----
  v_final  := round(((v_q_score * sa.question_weight) + (v_sub_score * sa.submission_weight)) / 100, 2);
  v_passed := v_final >= v_mark;

  -- Supersede any previous grade rather than overwriting it (fixes audit M-20).
  select id into v_prev from grades
   where summative_attempt_id = p_attempt_id and is_superseded = false limit 1;
  if v_prev is not null then
    update grades set is_superseded = true where id = v_prev;
  end if;

  insert into grades (
    summative_attempt_id, enrollment_id, rubric_id,
    points_earned, points_possible, score_percent, pass_mark_applied, passed,
    graded_by, released_at, released_by, supersedes_id
  )
  values (
    p_attempt_id, at.enrollment_id, sa.rubric_id,
    v_rubric_got, v_rubric_max, v_final, v_mark, v_passed,
    auth.uid(),
    case when p_release then now() end,
    case when p_release then auth.uid() end,
    v_prev
  )
  returning id into v_grade_id;

  for item in select * from jsonb_array_elements(p_criteria_scores)
  loop
    insert into grade_criteria_scores (grade_id, criterion_id, points, comment)
    values (v_grade_id, (item ->> 'criterion_id')::uuid, (item ->> 'points')::numeric, item ->> 'comment');
  end loop;

  if p_feedback is not null and length(btrim(p_feedback)) > 0 then
    insert into feedback (submission_id, summative_attempt_id, grade_id, enrollment_id, author_id, body)
    select s.id, p_attempt_id, v_grade_id, at.enrollment_id, auth.uid(), p_feedback
      from submissions s where s.attempt_id = p_attempt_id;
  end if;

  update summative_attempts
     set status = case
                    when v_passed then 'PASSED'::submission_status
                    when sa.allow_resubmission and at.attempt_number < sa.max_attempts
                      then 'RESUBMISSION_REQUIRED'::submission_status
                    else 'FAILED'::submission_status
                  end,
         question_score    = v_q_score,
         submission_score  = v_sub_score,
         final_score       = v_final,
         passed            = v_passed,
         graded_at         = now(),
         graded_by         = auth.uid(),
         assessor_feedback = coalesce(p_feedback, assessor_feedback)
   where id = p_attempt_id;

  update submissions
     set status = (select status from summative_attempts where id = p_attempt_id)
   where attempt_id = p_attempt_id;

  -- Progression: this is where the next module unlocks.
  perform app.after_module_result(at.enrollment_id, sa.module_id);

  perform app.create_audit_log(
    'SUBMISSION_GRADED', 'summative_attempt', p_attempt_id, sa.title,
    case when v_prev is not null then jsonb_build_object('superseded_grade', v_prev) end,
    jsonb_build_object('final_score', v_final, 'passed', v_passed, 'pass_mark', v_mark)
  );

  if p_release then
    select profile_id into v_learner from enrollments where id = at.enrollment_id;
    perform app.notify(
      v_learner, 'ASSESSMENT_GRADED',
      case when v_passed then 'Assessment passed' else 'Assessment result available' end,
      sa.title, '/app/results', 'summative_attempt', p_attempt_id
    );
  end if;

  return query select v_final, v_passed;
end;
$$;

-- ============================================================================
-- SECTION 4 — FINAL EXAM
-- ============================================================================

-- ----------------------------------------------------------------------------
-- public.check_final_exam_eligibility(enrollment)
--
-- BR-005. Returns a structured verdict so the UI can explain *why* the exam is
-- unavailable rather than showing a dead button. The same function is re-run
-- inside start_final_exam_attempt(), so a stale client verdict is harmless.
-- ----------------------------------------------------------------------------
create or replace function public.check_final_exam_eligibility(p_enrollment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e            enrollments%rowtype;
  fe           final_exams%rowtype;
  v_checks     jsonb := '[]'::jsonb;
  v_eligible   boolean := true;
  v_total      integer;
  v_passed     integer;
  v_form_out   integer;
  v_summ_out   integer;
  v_poe_out    integer;
  v_attempts   integer;
  v_last       timestamptz;
begin
  select * into e from enrollments where id = p_enrollment_id;
  if not found then
    raise exception 'Enrollment not found' using errcode = 'P0002';
  end if;

  if not (app.owns_enrollment(p_enrollment_id) or app.is_staff()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into fe from final_exams
   where course_id = e.course_id and publication_status = 'PUBLISHED';

  if not found then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'NO_EXAM_PUBLISHED',
      'checks', jsonb_build_array(jsonb_build_object(
        'key','exam_published','label','Final examination published','passed',false))
    );
  end if;

  -- ---- enrollment active ----
  v_checks := v_checks || jsonb_build_object(
    'key','enrollment_active','label','Enrollment is active',
    'passed', e.status in ('ACTIVE','COMPLETED'));
  if e.status not in ('ACTIVE','COMPLETED') then v_eligible := false; end if;

  -- ---- modules ----
  select count(*) filter (where m.is_required or not fe.require_required_modules_only),
         count(*) filter (where (m.is_required or not fe.require_required_modules_only)
                            and mp.status = 'PASSED')
    into v_total, v_passed
    from course_modules m
    left join module_progress mp on mp.module_id = m.id and mp.enrollment_id = p_enrollment_id
   where m.course_id = e.course_id and m.publication_status = 'PUBLISHED';

  if fe.require_all_modules then
    v_checks := v_checks || jsonb_build_object(
      'key','modules_complete','label','All required modules passed',
      'passed', coalesce(v_passed,0) >= coalesce(v_total,0) and coalesce(v_total,0) > 0,
      'detail', format('%s of %s', coalesce(v_passed,0), coalesce(v_total,0)));
    if not (coalesce(v_passed,0) >= coalesce(v_total,0) and coalesce(v_total,0) > 0) then
      v_eligible := false;
    end if;
  end if;

  -- ---- formative ----
  if fe.require_formatives then
    select count(*) into v_form_out
      from formative_assessments fa
      join course_modules m on m.id = fa.module_id
     where m.course_id = e.course_id
       and fa.is_required and fa.publication_status = 'PUBLISHED'
       and not exists (
         select 1 from formative_attempts at
          where at.assessment_id = fa.id and at.enrollment_id = p_enrollment_id and at.passed is true);

    v_checks := v_checks || jsonb_build_object(
      'key','formatives_complete','label','Required formative assessments completed',
      'passed', coalesce(v_form_out,0) = 0,
      'detail', format('%s outstanding', coalesce(v_form_out,0)));
    if coalesce(v_form_out,0) > 0 then v_eligible := false; end if;
  end if;

  -- ---- summative ----
  if fe.require_summatives then
    select count(*) into v_summ_out
      from summative_assessments sa
      join course_modules m on m.id = sa.module_id
     where m.course_id = e.course_id
       and sa.is_required and sa.publication_status = 'PUBLISHED'
       and not exists (
         select 1 from summative_attempts at
          where at.assessment_id = sa.id and at.enrollment_id = p_enrollment_id and at.status = 'PASSED');

    v_checks := v_checks || jsonb_build_object(
      'key','summatives_passed','label','Required summative assessments passed',
      'passed', coalesce(v_summ_out,0) = 0,
      'detail', format('%s outstanding', coalesce(v_summ_out,0)));
    if coalesce(v_summ_out,0) > 0 then v_eligible := false; end if;
  end if;

  -- ---- PoE ----
  if fe.require_poe then
    select count(*) into v_poe_out
      from assignments a
      join summative_assessments sa on sa.id = a.summative_assessment_id
      join course_modules m on m.id = sa.module_id
     where a.is_poe and m.course_id = e.course_id
       and not exists (
         select 1 from summative_attempts at
          where at.assessment_id = sa.id and at.enrollment_id = p_enrollment_id and at.status = 'PASSED');

    v_checks := v_checks || jsonb_build_object(
      'key','poe_passed','label','Portfolio of Evidence passed',
      'passed', coalesce(v_poe_out,0) = 0,
      'detail', format('%s outstanding', coalesce(v_poe_out,0)));
    if coalesce(v_poe_out,0) > 0 then v_eligible := false; end if;
  end if;

  -- ---- administrative ----
  if fe.require_payment_cleared then
    v_checks := v_checks || jsonb_build_object(
      'key','payment_cleared','label','Fees cleared','passed', e.payment_cleared);
    if not e.payment_cleared then v_eligible := false; end if;
  end if;

  if fe.require_documents_verified then
    v_checks := v_checks || jsonb_build_object(
      'key','documents_verified','label','Supporting documents verified','passed', e.documents_verified);
    if not e.documents_verified then v_eligible := false; end if;
  end if;

  if fe.min_credits_earned is not null then
    v_checks := v_checks || jsonb_build_object(
      'key','min_credits','label', format('At least %s credits earned', fe.min_credits_earned),
      'passed', e.credits_earned >= fe.min_credits_earned,
      'detail', format('%s earned', e.credits_earned));
    if e.credits_earned < fe.min_credits_earned then v_eligible := false; end if;
  end if;

  -- ---- attempts & cooling-off ----
  select count(*), max(submitted_at) into v_attempts, v_last
    from final_exam_attempts
   where enrollment_id = p_enrollment_id and exam_id = fe.id
     and status in ('SUBMITTED','GRADED','EXPIRED');

  v_checks := v_checks || jsonb_build_object(
    'key','attempts_remaining','label','Attempts remaining',
    'passed', coalesce(v_attempts,0) < fe.max_attempts,
    'detail', format('%s of %s used', coalesce(v_attempts,0), fe.max_attempts));
  if coalesce(v_attempts,0) >= fe.max_attempts then v_eligible := false; end if;

  if v_last is not null and fe.retake_wait_hours > 0
     and now() < v_last + make_interval(hours => fe.retake_wait_hours) then
    v_checks := v_checks || jsonb_build_object(
      'key','cooling_off','label','Retake waiting period elapsed','passed', false,
      'detail', format('Available from %s', to_char(v_last + make_interval(hours => fe.retake_wait_hours), 'YYYY-MM-DD HH24:MI')));
    v_eligible := false;
  end if;

  -- Already passed → no further attempt needed.
  if exists (select 1 from final_exam_attempts
              where enrollment_id = p_enrollment_id and exam_id = fe.id and passed is true) then
    return jsonb_build_object('eligible', false, 'reason', 'ALREADY_PASSED',
                              'exam_id', fe.id, 'checks', v_checks);
  end if;

  return jsonb_build_object(
    'eligible', v_eligible,
    'exam_id',  fe.id,
    'reason',   case when v_eligible then 'ELIGIBLE' else 'REQUIREMENTS_OUTSTANDING' end,
    'checks',   v_checks
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- public.start_final_exam_attempt(enrollment)
-- Re-checks eligibility server-side, stamps the deadline, fixes the questions.
-- ----------------------------------------------------------------------------
create or replace function public.start_final_exam_attempt(p_enrollment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_verdict jsonb;
  fe        final_exams%rowtype;
  v_open    uuid;
  v_used    integer;
  v_qids    uuid[];
  v_id      uuid;
begin
  if not app.owns_enrollment(p_enrollment_id) then
    raise exception 'Not your enrollment' using errcode = '42501';
  end if;

  -- Resume an in-flight attempt.
  select id into v_open from final_exam_attempts
   where enrollment_id = p_enrollment_id and status = 'IN_PROGRESS' limit 1;
  if v_open is not null then
    return v_open;
  end if;

  v_verdict := public.check_final_exam_eligibility(p_enrollment_id);
  if not (v_verdict ->> 'eligible')::boolean then
    raise exception 'Not eligible for the final examination: %', v_verdict ->> 'reason'
      using errcode = '42501';
  end if;

  select * into fe from final_exams where id = (v_verdict ->> 'exam_id')::uuid;

  select count(*) into v_used from final_exam_attempts
   where enrollment_id = p_enrollment_id and exam_id = fe.id;

  select coalesce(array_agg(id order by ord), '{}') into v_qids
    from (
      select id, case when fe.shuffle_questions then random() else sequence::numeric end as ord
        from final_exam_questions
       where exam_id = fe.id and is_active
       order by ord
       limit coalesce(fe.questions_per_attempt, 2147483647)
    ) q;

  if array_length(v_qids, 1) is null then
    raise exception 'The final examination has no active questions' using errcode = 'P0002';
  end if;

  insert into final_exam_attempts (
    enrollment_id, exam_id, attempt_number, status, question_ids,
    started_at, expires_at, eligibility_snapshot, requires_manual_marking
  )
  values (
    p_enrollment_id, fe.id, v_used + 1, 'IN_PROGRESS', v_qids,
    now(), now() + make_interval(mins => fe.duration_minutes),
    v_verdict, fe.requires_manual_marking
  )
  returning id into v_id;

  perform app.create_audit_log(
    'FINAL_EXAM_STARTED', 'final_exam_attempt', v_id, fe.title,
    null, jsonb_build_object('attempt_number', v_used + 1, 'questions', array_length(v_qids,1))
  );

  return v_id;
end;
$$;

create or replace function public.save_final_exam_answer(
  p_attempt_id  uuid,
  p_question_id uuid,
  p_option_ids  uuid[] default '{}',
  p_text        text   default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  at final_exam_attempts%rowtype;
begin
  select * into at from final_exam_attempts where id = p_attempt_id;
  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;
  if not app.owns_enrollment(at.enrollment_id) then
    raise exception 'Not your attempt' using errcode = '42501';
  end if;
  if at.status <> 'IN_PROGRESS' then
    raise exception 'This examination has already been submitted' using errcode = '42501';
  end if;
  -- Server-side clock. The client cannot extend its own time.
  if now() > at.expires_at then
    raise exception 'The examination time limit has elapsed' using errcode = '42501';
  end if;
  if not (p_question_id = any(at.question_ids)) then
    raise exception 'Question is not part of this attempt' using errcode = '42501';
  end if;

  insert into final_exam_answers (attempt_id, question_id, selected_option_ids, text_answer)
  values (p_attempt_id, p_question_id, coalesce(p_option_ids,'{}'), p_text)
  on conflict (attempt_id, question_id) do update
    set selected_option_ids = excluded.selected_option_ids,
        text_answer         = excluded.text_answer,
        answered_at         = now();
end;
$$;

-- ----------------------------------------------------------------------------
-- public.submit_final_exam_attempt(attempt)
-- Auto-grades objective questions. Routes to an assessor when manual marking
-- is configured or any non-objective question carries marks.
-- ----------------------------------------------------------------------------
create or replace function public.submit_final_exam_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  at          final_exam_attempts%rowtype;
  fe          final_exams%rowtype;
  q           record;
  v_correct   uuid[];
  v_given     uuid[];
  v_ok        boolean;
  v_earned    numeric(8,2) := 0;
  v_possible  numeric(8,2) := 0;
  v_manual    numeric(8,2) := 0;
  v_pct       numeric(5,2);
  v_passed    boolean;
  v_late      boolean;
  v_needs_marking boolean;
  v_learner   uuid;
begin
  select * into at from final_exam_attempts where id = p_attempt_id for update;
  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;
  if not (app.owns_enrollment(at.enrollment_id) or app.is_staff()) then
    raise exception 'Not your attempt' using errcode = '42501';
  end if;
  if at.status <> 'IN_PROGRESS' then
    raise exception 'This examination has already been submitted' using errcode = '42501';
  end if;

  select * into fe from final_exams where id = at.exam_id;
  v_late := now() > at.expires_at;

  for q in
    select id, points, question_type from final_exam_questions where id = any(at.question_ids)
  loop
    v_possible := v_possible + q.points;

    if q.question_type in ('MULTIPLE_CHOICE','TRUE_FALSE','MULTIPLE_SELECT') then
      select coalesce(array_agg(id order by id), '{}') into v_correct
        from final_exam_options where question_id = q.id and is_correct;

      select coalesce(array_agg(x order by x), '{}') into v_given
        from (select unnest(selected_option_ids) as x
                from final_exam_answers
               where attempt_id = p_attempt_id and question_id = q.id) s;

      v_ok := (v_given = v_correct) and array_length(v_given,1) is not null;

      update final_exam_answers
         set is_correct = v_ok, points_awarded = case when v_ok then q.points else 0 end
       where attempt_id = p_attempt_id and question_id = q.id;

      if v_ok then v_earned := v_earned + q.points; end if;
    else
      -- Manual: leave points_awarded null for the assessor.
      v_manual := v_manual + q.points;
    end if;
  end loop;

  v_needs_marking := fe.requires_manual_marking or v_manual > 0;

  if v_needs_marking then
    update final_exam_attempts
       set status = 'SUBMITTED', submitted_at = now(),
           points_earned = v_earned, points_possible = v_possible,
           submitted_late = v_late, requires_manual_marking = true
     where id = p_attempt_id;

    perform app.create_audit_log('FINAL_EXAM_SUBMITTED', 'final_exam_attempt', p_attempt_id, fe.title,
      null, jsonb_build_object('awaiting_manual_marking', true, 'late', v_late));

    perform app.notify(ur.profile_id, 'FINAL_EXAM_MARKING_REQUIRED',
      'Final examination awaiting marking', fe.title,
      '/admin/final-exams/' || p_attempt_id::text, 'final_exam_attempt', p_attempt_id)
      from user_roles ur where ur.role in ('ASSESSOR','ADMIN');

    return jsonb_build_object('status','SUBMITTED','awaiting_marking',true);
  end if;

  v_pct    := case when v_possible = 0 then 0 else round((v_earned / v_possible) * 100, 2) end;
  v_passed := v_pct >= fe.pass_mark;

  update final_exam_attempts
     set status = 'GRADED', submitted_at = now(), graded_at = now(),
         points_earned = v_earned, points_possible = v_possible,
         score_percent = v_pct, passed = v_passed,
         submitted_late = v_late,
         released_at = case when fe.release_results_automatically then now() end
   where id = p_attempt_id;

  insert into grades (final_exam_attempt_id, enrollment_id, points_earned, points_possible,
                      score_percent, pass_mark_applied, passed, graded_by, released_at)
  values (p_attempt_id, at.enrollment_id, v_earned, v_possible,
          v_pct, fe.pass_mark, v_passed, null,
          case when fe.release_results_automatically then now() end);

  perform app.recalculate_enrollment_progress(at.enrollment_id);

  perform app.create_audit_log('FINAL_EXAM_GRADED', 'final_exam_attempt', p_attempt_id, fe.title,
    null, jsonb_build_object('score_percent', v_pct, 'passed', v_passed, 'late', v_late));

  select profile_id into v_learner from enrollments where id = at.enrollment_id;
  perform app.notify(v_learner, 'FINAL_EXAM_RESULT',
    case when v_passed then 'Final examination passed' else 'Final examination result available' end,
    fe.title, '/app/results', 'final_exam_attempt', p_attempt_id);

  return jsonb_build_object('status','GRADED','score_percent',v_pct,'passed',v_passed);
end;
$$;

-- ============================================================================
-- SECTION 5 — CERTIFICATE
-- ============================================================================

-- ----------------------------------------------------------------------------
-- public.check_certificate_eligibility(enrollment)
--
-- BR-010. Structured verdict, same shape as the exam eligibility check.
-- ----------------------------------------------------------------------------
create or replace function public.check_certificate_eligibility(p_enrollment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e          enrollments%rowtype;
  c          courses%rowtype;
  v_checks   jsonb := '[]'::jsonb;
  v_ok       boolean := true;
  v_total    integer;
  v_passed   integer;
  v_form_out integer;
  v_summ_out integer;
  v_poe_out  integer;
  v_final_ok boolean;
  v_score    numeric(5,2);
begin
  select * into e from enrollments where id = p_enrollment_id;
  if not found then
    raise exception 'Enrollment not found' using errcode = 'P0002';
  end if;
  if not (app.owns_enrollment(p_enrollment_id) or app.is_staff()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into c from courses where id = e.course_id;

  -- 1. enrollment
  v_checks := v_checks || jsonb_build_object('key','enrollment','label','Active enrollment',
    'passed', e.status in ('ACTIVE','COMPLETED'));
  if e.status not in ('ACTIVE','COMPLETED') then v_ok := false; end if;

  -- 2. modules
  select count(*) filter (where m.is_required),
         count(*) filter (where m.is_required and mp.status = 'PASSED')
    into v_total, v_passed
    from course_modules m
    left join module_progress mp on mp.module_id = m.id and mp.enrollment_id = p_enrollment_id
   where m.course_id = e.course_id and m.publication_status = 'PUBLISHED';

  v_checks := v_checks || jsonb_build_object('key','modules','label','All required modules passed',
    'passed', coalesce(v_total,0) > 0 and coalesce(v_passed,0) >= v_total,
    'detail', format('%s of %s', coalesce(v_passed,0), coalesce(v_total,0)));
  if not (coalesce(v_total,0) > 0 and coalesce(v_passed,0) >= v_total) then v_ok := false; end if;

  -- 3. formative
  select count(*) into v_form_out
    from formative_assessments fa join course_modules m on m.id = fa.module_id
   where m.course_id = e.course_id and fa.is_required and fa.publication_status = 'PUBLISHED'
     and not exists (select 1 from formative_attempts at
                      where at.assessment_id = fa.id and at.enrollment_id = p_enrollment_id and at.passed is true);
  v_checks := v_checks || jsonb_build_object('key','formative','label','Required formative assessments completed',
    'passed', coalesce(v_form_out,0) = 0, 'detail', format('%s outstanding', coalesce(v_form_out,0)));
  if coalesce(v_form_out,0) > 0 then v_ok := false; end if;

  -- 4. summative
  select count(*) into v_summ_out
    from summative_assessments sa join course_modules m on m.id = sa.module_id
   where m.course_id = e.course_id and sa.is_required and sa.publication_status = 'PUBLISHED'
     and not exists (select 1 from summative_attempts at
                      where at.assessment_id = sa.id and at.enrollment_id = p_enrollment_id and at.status = 'PASSED');
  v_checks := v_checks || jsonb_build_object('key','summative','label','Required summative assessments passed',
    'passed', coalesce(v_summ_out,0) = 0, 'detail', format('%s outstanding', coalesce(v_summ_out,0)));
  if coalesce(v_summ_out,0) > 0 then v_ok := false; end if;

  -- 5. PoE
  select count(*) into v_poe_out
    from assignments a
    join summative_assessments sa on sa.id = a.summative_assessment_id
    join course_modules m on m.id = sa.module_id
   where a.is_poe and m.course_id = e.course_id
     and not exists (select 1 from summative_attempts at
                      where at.assessment_id = sa.id and at.enrollment_id = p_enrollment_id and at.status = 'PASSED');
  v_checks := v_checks || jsonb_build_object('key','poe','label','Portfolio of Evidence passed',
    'passed', coalesce(v_poe_out,0) = 0, 'detail', format('%s outstanding', coalesce(v_poe_out,0)));
  if coalesce(v_poe_out,0) > 0 then v_ok := false; end if;

  -- 6. final exam
  select exists (select 1 from final_exam_attempts
                  where enrollment_id = p_enrollment_id and passed is true),
         max(score_percent)
    into v_final_ok, v_score
    from final_exam_attempts where enrollment_id = p_enrollment_id;

  if c.require_final_exam then
    v_checks := v_checks || jsonb_build_object('key','final_exam','label','Final examination passed',
      'passed', coalesce(v_final_ok,false),
      'detail', case when v_score is not null then format('best %s%%', v_score) end);
    if not coalesce(v_final_ok,false) then v_ok := false; end if;
  end if;

  -- 7. administrative
  v_checks := v_checks || jsonb_build_object('key','payment','label','Fees cleared','passed', e.payment_cleared);
  if not e.payment_cleared then v_ok := false; end if;

  v_checks := v_checks || jsonb_build_object('key','documents','label','Supporting documents verified',
    'passed', e.documents_verified);
  if not e.documents_verified then v_ok := false; end if;

  -- 8. not already issued
  if exists (select 1 from certificates where enrollment_id = p_enrollment_id and status = 'ISSUED') then
    return jsonb_build_object('eligible', false, 'reason','ALREADY_ISSUED','checks', v_checks);
  end if;

  return jsonb_build_object(
    'eligible', v_ok,
    'reason', case when v_ok then 'ELIGIBLE' else 'REQUIREMENTS_OUTSTANDING' end,
    'credits_earned', e.credits_earned,
    'final_score', v_score,
    'checks', v_checks
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- app.next_certificate_number()
-- Transactional per-year counter (fixes audit M-14/S-13).
-- ----------------------------------------------------------------------------
create or replace function app.next_certificate_number(p_qualification_id text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year   integer := extract(year from now())::integer;
  v_next   integer;
  v_prefix text;
begin
  select certificate_prefix into v_prefix from institution_settings limit 1;
  v_prefix := coalesce(v_prefix, 'MIS');

  insert into certificate_sequences (year, last_number)
  values (v_year, 1)
  on conflict (year) do update set last_number = certificate_sequences.last_number + 1
  returning last_number into v_next;

  return concat_ws('-',
    v_prefix,
    nullif(p_qualification_id, ''),
    v_year::text,
    lpad(v_next::text, 5, '0')
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- public.issue_certificate(enrollment)
--
-- BR-009/BR-010, risk R-06. Re-runs every eligibility check inside the same
-- transaction. Staff-only: there is no learner path to this function.
-- ----------------------------------------------------------------------------
create or replace function public.issue_certificate(p_enrollment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_verdict jsonb;
  e         enrollments%rowtype;
  c         courses%rowtype;
  p         profiles%rowtype;
  v_number  text;
  v_id      uuid;
  v_score   numeric(5,2);
  v_snapshot jsonb;
begin
  if not app.is_admin() then
    raise exception 'Only an administrator may issue certificates' using errcode = '42501';
  end if;

  -- Re-check, do not trust anything the caller believes.
  v_verdict := public.check_certificate_eligibility(p_enrollment_id);
  if not (v_verdict ->> 'eligible')::boolean then
    raise exception 'Certificate requirements not satisfied: %', v_verdict ->> 'reason'
      using errcode = '42501';
  end if;

  select * into e from enrollments where id = p_enrollment_id;
  select * into c from courses  where id = e.course_id;
  select * into p from profiles where id = e.profile_id;

  select max(score_percent) into v_score
    from final_exam_attempts where enrollment_id = p_enrollment_id and passed is true;

  -- Evidence trail.
  select jsonb_build_object(
    'verdict', v_verdict,
    'credits_earned', e.credits_earned,
    'modules', coalesce(jsonb_agg(jsonb_build_object(
        'code', m.code, 'title', m.title, 'credits', mp.credits_awarded,
        'best_score', mp.best_score, 'passed_at', mp.passed_at
      ) order by m.sequence), '[]'::jsonb)
  ) into v_snapshot
  from course_modules m
  join module_progress mp on mp.module_id = m.id and mp.enrollment_id = p_enrollment_id
  where m.course_id = e.course_id and mp.status = 'PASSED';

  v_number := app.next_certificate_number(c.qualification_id);

  insert into certificates (
    certificate_number, enrollment_id, profile_id, course_id,
    learner_name, course_title, qualification_id, nqf_level, credits_awarded,
    status, issued_by, completion_date, results_snapshot, final_score
  )
  values (
    v_number, p_enrollment_id, e.profile_id, e.course_id,
    p.full_name, c.title, c.qualification_id, c.nqf_level, e.credits_earned,
    'ISSUED', auth.uid(), coalesce(e.completed_at::date, current_date), v_snapshot, v_score
  )
  returning id into v_id;

  update enrollments
     set status = 'COMPLETED', completed_at = coalesce(completed_at, now()), course_completed = true
   where id = p_enrollment_id;

  perform app.create_audit_log('CERTIFICATE_ISSUED', 'certificate', v_id, v_number,
    null, jsonb_build_object('enrollment_id', p_enrollment_id, 'final_score', v_score));

  perform app.notify(e.profile_id, 'CERTIFICATE_ISSUED', 'Your certificate has been issued',
    c.title, '/app/certificate', 'certificate', v_id);

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- public.verify_certificate(number, token)
--
-- PUBLIC endpoint. Returns the minimum needed to confirm authenticity.
-- Deliberately omits id_number, email, enrollment id and the results snapshot
-- (brief: "Do not expose unnecessary personal information"; risk R-05).
-- ----------------------------------------------------------------------------
create or replace function public.verify_certificate(
  p_certificate_number text,
  p_token              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c certificates%rowtype;
begin
  if p_certificate_number is null or length(btrim(p_certificate_number)) < 6 then
    return jsonb_build_object('valid', false, 'reason', 'NOT_FOUND');
  end if;

  select * into c from certificates
   where upper(certificate_number) = upper(btrim(p_certificate_number));

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'NOT_FOUND');
  end if;

  -- When a token is supplied it must match. Constant-time-ish comparison.
  if p_token is not null and c.verification_token <> p_token then
    return jsonb_build_object('valid', false, 'reason', 'NOT_FOUND');
  end if;

  if c.status = 'REVOKED' then
    return jsonb_build_object(
      'valid', false, 'reason', 'REVOKED',
      'certificate_number', c.certificate_number,
      'revoked_at', c.revoked_at);
  end if;

  return jsonb_build_object(
    'valid',              c.status = 'ISSUED',
    'reason',             case when c.status = 'ISSUED' then 'VALID' else 'REPLACED' end,
    'certificate_number', c.certificate_number,
    'learner_name',       c.learner_name,
    'course_title',       c.course_title,
    'qualification_id',   c.qualification_id,
    'nqf_level',          c.nqf_level,
    'credits',            c.credits_awarded,
    'issued_at',          c.issued_at,
    'completion_date',    c.completion_date
  );
end;
$$;

create or replace function public.revoke_certificate(p_certificate_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.is_admin() then
    raise exception 'Only an administrator may revoke certificates' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A revocation reason is required' using errcode = '23514';
  end if;

  update certificates
     set status = 'REVOKED', revoked_at = now(), revoked_by = auth.uid(), revocation_reason = p_reason
   where id = p_certificate_id and status = 'ISSUED';

  if not found then
    raise exception 'No issued certificate with id %', p_certificate_id using errcode = 'P0002';
  end if;

  perform app.create_audit_log('CERTIFICATE_REVOKED', 'certificate', p_certificate_id, null,
    null, jsonb_build_object('reason', p_reason));
end;
$$;

-- ============================================================================
-- SECTION 6 — PAYMENTS
-- ============================================================================

create or replace function app.next_invoice_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := extract(year from now())::integer;
  v_next integer;
begin
  insert into invoice_sequences (year, last_number)
  values (v_year, 1)
  on conflict (year) do update set last_number = invoice_sequences.last_number + 1
  returning last_number into v_next;

  return format('INV-%s-%s', v_year, lpad(v_next::text, 5, '0'));
end;
$$;

-- ----------------------------------------------------------------------------
-- public.review_payment(payment, approve, reason)
--
-- Finance-only. Replaces the demo's one-click approvePayment() (audit M-07),
-- and updates the invoice, the enrollment and the ledger atomically.
-- ----------------------------------------------------------------------------
create or replace function public.review_payment(
  p_payment_id uuid,
  p_approve    boolean,
  p_reason     text default null
)
returns payment_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pay      payments%rowtype;
  inv      invoices%rowtype;
  v_paid   numeric(12,2);
  v_status payment_status;
  v_inv_status invoice_status;
begin
  if not app.is_finance() then
    raise exception 'Only finance may review payments' using errcode = '42501';
  end if;

  select * into pay from payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  if pay.status in ('APPROVED','REJECTED') then
    raise exception 'This payment has already been reviewed' using errcode = '42501';
  end if;

  if not p_approve and (p_reason is null or length(btrim(p_reason)) = 0) then
    raise exception 'A rejection reason is required' using errcode = '23514';
  end if;

  v_status := case when p_approve then 'APPROVED' else 'REJECTED' end::payment_status;

  update payments
     set status = v_status, reviewed_at = now(), reviewed_by = auth.uid(),
         rejection_reason = case when p_approve then null else p_reason end
   where id = p_payment_id;

  insert into payment_events (payment_id, invoice_id, event_type, from_status, to_status, amount, actor_id,
                              metadata)
  values (p_payment_id, pay.invoice_id,
          case when p_approve then 'PAYMENT_APPROVED' else 'PAYMENT_REJECTED' end,
          pay.status::text, v_status::text, pay.amount, auth.uid(),
          jsonb_build_object('reason', p_reason));

  if p_approve then
    select * into inv from invoices where id = pay.invoice_id for update;

    select coalesce(sum(amount), 0) into v_paid
      from payments where invoice_id = pay.invoice_id and status = 'APPROVED';

    v_inv_status := case
      when v_paid >= inv.total then 'PAID'
      when v_paid > 0          then 'PARTIALLY_PAID'
      else inv.status end;

    update invoices
       set amount_paid = v_paid,
           status      = v_inv_status,
           paid_at     = case when v_inv_status = 'PAID' then coalesce(paid_at, now()) end
     where id = inv.id;

    -- Activate the enrollment once anything has been cleared.
    if inv.enrollment_id is not null then
      update enrollments
         set payment_cleared    = true,
             payment_cleared_at = coalesce(payment_cleared_at, now()),
             status = case when status = 'PENDING' then 'ACTIVE'::enrollment_status else status end,
             activated_at = case when status = 'PENDING' then now() else activated_at end
       where id = inv.enrollment_id;

      -- Opens module 1.
      perform app.refresh_module_unlocks(inv.enrollment_id);
      perform app.recalculate_enrollment_progress(inv.enrollment_id);
    end if;

    update profiles
       set account_status = 'ACTIVE'
     where id = pay.profile_id and account_status = 'PENDING_PAYMENT';
  end if;

  perform app.create_audit_log(
    case when p_approve then 'PAYMENT_APPROVED' else 'PAYMENT_REJECTED' end,
    'payment', p_payment_id, null, null,
    jsonb_build_object('amount', pay.amount, 'reason', p_reason));

  perform app.notify(pay.profile_id,
    case when p_approve then 'PAYMENT_APPROVED' else 'PAYMENT_REJECTED' end,
    case when p_approve then 'Payment approved' else 'Payment could not be verified' end,
    coalesce(p_reason, 'Your enrollment has been activated.'),
    '/app/profile', 'payment', p_payment_id);

  return v_status;
end;
$$;

-- ============================================================================
-- SECTION 7 — GRANTS
--
-- Learner-callable functions are granted to `authenticated`; the function
-- bodies themselves enforce role and ownership. Privileged operations are
-- reachable only because the body checks app.is_admin() / is_assessor() /
-- is_finance() and raises otherwise.
-- ============================================================================
-- Deny by default, then grant deliberately below.
revoke execute on all functions in schema public from public;

-- ...but pgcrypto and citext install their functions into `public` too, and
-- the blanket revoke above strips them as well. gen_random_uuid() backs the
-- DEFAULT on almost every primary key in this schema, so without this
-- re-grant every INSERT by a non-superuser fails with
-- "permission denied for function gen_random_uuid".
-- Re-grant execute on extension-owned functions only.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_depend d on d.objid = p.oid and d.deptype = 'e'
     where n.nspname = 'public'
  loop
    execute format('grant execute on function %s to public', r.sig);
  end loop;
end
$$;

grant execute on function
  public.complete_lesson(uuid),
  public.start_formative_attempt(uuid),
  public.save_formative_answer(uuid, uuid, uuid[], text),
  public.submit_formative_attempt(uuid),
  public.start_summative_attempt(uuid),
  public.submit_summative_attempt(uuid, text),
  public.check_final_exam_eligibility(uuid),
  public.start_final_exam_attempt(uuid),
  public.save_final_exam_answer(uuid, uuid, uuid[], text),
  public.submit_final_exam_attempt(uuid),
  public.check_certificate_eligibility(uuid)
to authenticated;

grant execute on function
  public.grade_summative_attempt(uuid, jsonb, numeric, text, boolean),
  public.issue_certificate(uuid),
  public.revoke_certificate(uuid, text),
  public.review_payment(uuid, boolean, text)
to authenticated;

-- Certificate verification is genuinely public.
grant execute on function public.verify_certificate(text, text) to anon, authenticated;
