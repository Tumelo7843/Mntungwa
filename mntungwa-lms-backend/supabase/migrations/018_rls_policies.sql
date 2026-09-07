-- ============================================================================
-- 018_rls_policies.sql
--
-- THE AUTHORISATION LAYER. Replaces audit S-05 and S-06, where the only
-- access control was a client-side <Navigate> and all data for all users sat
-- in one localStorage object.
--
-- Rules observed throughout:
--   * RLS is ENABLED and FORCED on every table.
--   * No `USING (true)` on any sensitive table.
--   * Learners read their own rows by joining through `enrollments`.
--   * Answer keys (*_options.is_correct) are unreachable by learners; safe
--     views expose the option text without it.
--   * Grades are visible only once released_at is set.
--   * audit_logs and payment_events are append-only for everyone.
--
-- Note on FORCE: it makes policies apply to the table owner too, so a mistake
-- in a SECURITY DEFINER function cannot silently bypass them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enable + force on everything.
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'institution','institution_settings','profiles','user_roles','cohorts',
    'courses','course_modules','lessons','learning_resources',
    'enrollments','lesson_progress','module_progress',
    'formative_assessments','formative_questions','formative_options',
    'formative_attempts','formative_answers',
    'summative_assessments','summative_questions','summative_options',
    'summative_attempts','summative_answers',
    'assignments','submissions','submission_versions','submission_files',
    'rubrics','rubric_criteria','grades','grade_criteria_scores','feedback',
    'final_exams','final_exam_questions','final_exam_options',
    'final_exam_attempts','final_exam_answers',
    'certificates','certificate_sequences',
    'invoices','invoice_sequences','payments','payment_proofs','payment_events',
    'notifications','announcements','audit_logs','contact_messages'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
  end loop;
end
$$;

-- ============================================================================
-- INSTITUTION
-- ============================================================================
create policy institution_read_all on institution
  for select to anon, authenticated using (true);       -- public branding only
create policy institution_admin_write on institution
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy settings_read_auth on institution_settings
  for select to authenticated using (app.is_authenticated());
create policy settings_admin_write on institution_settings
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- ============================================================================
-- PROFILES & ROLES
-- ============================================================================
create policy profiles_read_own on profiles
  for select to authenticated using (id = auth.uid());

-- Staff may read learner profiles for administration.
create policy profiles_read_staff on profiles
  for select to authenticated using (app.is_staff());

-- A user may edit their own profile but NOT their account_status
-- (that would let a learner self-activate). Enforced by trigger below.
create policy profiles_update_own on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_admin_all on profiles
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- Block privilege escalation through a self-update.
create or replace function app.guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if app.is_admin() then
    return new;
  end if;
  if new.account_status is distinct from old.account_status then
    raise exception 'account_status may only be changed by an administrator'
      using errcode = '42501';
  end if;
  if new.email is distinct from old.email then
    raise exception 'Change your email through account settings, not the profile record'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_self_update
  before update on profiles
  for each row execute function app.guard_profile_self_update();

-- Roles: readable by self and staff; writable ONLY by admin.
-- This is the single most important policy in the file: it is what stopped
-- the demo's "edit localStorage, set role: admin" escalation (audit S-05).
create policy user_roles_read_own on user_roles
  for select to authenticated using (profile_id = auth.uid());
create policy user_roles_read_staff on user_roles
  for select to authenticated using (app.is_staff());
create policy user_roles_admin_write on user_roles
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy cohorts_read_auth on cohorts
  for select to authenticated using (app.is_authenticated());
create policy cohorts_admin_write on cohorts
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- ============================================================================
-- CATALOGUE
-- ============================================================================
-- Published courses are the public catalogue.
create policy courses_read_published on courses
  for select to anon, authenticated using (publication_status = 'PUBLISHED');
create policy courses_read_staff on courses
  for select to authenticated using (app.is_staff());
create policy courses_academic_write on courses
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

-- Modules: enrolled learners see published modules of their course.
-- Visibility (the module exists) is separate from access (it is unlocked);
-- a learner must be able to see the locked roadmap ahead of them.
create policy modules_read_enrolled on course_modules
  for select to authenticated using (
    publication_status = 'PUBLISHED' and app.has_active_enrollment(course_id)
  );
create policy modules_read_staff on course_modules
  for select to authenticated using (app.is_staff());
create policy modules_academic_write on course_modules
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

-- Lessons: require the module to be UNLOCKED, not merely enrolled.
create policy lessons_read_unlocked on lessons
  for select to authenticated using (
    publication_status = 'PUBLISHED' and app.can_access_module(module_id)
  );
create policy lessons_read_staff on lessons
  for select to authenticated using (app.is_staff());
create policy lessons_academic_write on lessons
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

-- Resources: preserves the demo's "resources unlock with their module" rule.
create policy resources_read_authorised on learning_resources
  for select to authenticated using (app.can_access_resource(id));
create policy resources_academic_write on learning_resources
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

-- ============================================================================
-- ENROLLMENTS & PROGRESS
-- ============================================================================
create policy enrollments_read_own on enrollments
  for select to authenticated using (profile_id = auth.uid());
create policy enrollments_read_staff on enrollments
  for select to authenticated using (app.is_staff());
-- A learner may apply for a course but cannot set their own status/flags:
-- the WITH CHECK pins every privileged column to its safe default.
create policy enrollments_apply_own on enrollments
  for insert to authenticated with check (
    profile_id = auth.uid()
    and status  = 'PENDING'
    and payment_cleared    = false
    and documents_verified = false
    and course_completed   = false
    and final_exam_passed  = false
    and modules_passed     = 0
    and credits_earned     = 0
  );
create policy enrollments_admin_write on enrollments
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- Lesson progress: a learner may create/update their own rows, but
-- complete_lesson() is the intended path (it also triggers recalculation).
create policy lesson_progress_own on lesson_progress
  for select to authenticated using (app.owns_enrollment(enrollment_id));
create policy lesson_progress_write_own on lesson_progress
  for insert to authenticated with check (
    app.owns_enrollment(enrollment_id) and app.can_access_lesson(lesson_id)
  );
create policy lesson_progress_update_own on lesson_progress
  for update to authenticated
  using (app.owns_enrollment(enrollment_id) and app.can_access_lesson(lesson_id))
  with check (app.owns_enrollment(enrollment_id));
create policy lesson_progress_staff on lesson_progress
  for select to authenticated using (app.is_staff());
create policy lesson_progress_admin on lesson_progress
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- Module progress: READ ONLY for learners. BR-002 — a learner cannot unlock
-- a module. There is deliberately no learner INSERT/UPDATE/DELETE policy.
create policy module_progress_read_own on module_progress
  for select to authenticated using (app.owns_enrollment(enrollment_id));
create policy module_progress_read_staff on module_progress
  for select to authenticated using (app.is_staff());
create policy module_progress_admin on module_progress
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- ============================================================================
-- FORMATIVE
-- ============================================================================
create policy formative_read_unlocked on formative_assessments
  for select to authenticated using (
    publication_status = 'PUBLISHED' and app.can_access_module(module_id)
  );
create policy formative_read_staff on formative_assessments
  for select to authenticated using (app.is_staff());
create policy formative_academic_write on formative_assessments
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

create policy formative_q_read on formative_questions
  for select to authenticated using (
    exists (select 1 from formative_assessments fa
             where fa.id = assessment_id
               and fa.publication_status = 'PUBLISHED'
               and app.can_access_module(fa.module_id))
  );
create policy formative_q_staff on formative_questions
  for select to authenticated using (app.is_staff());
create policy formative_q_academic_write on formative_questions
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

-- ★ ANSWER KEY PROTECTION (audit S-03, risk R-01)
-- Learners get NO select policy on this table at all. The only learner-facing
-- route to option text is the formative_options_public view below.
create policy formative_opt_staff_read on formative_options
  for select to authenticated using (app.is_staff());
create policy formative_opt_academic_write on formative_options
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

-- Safe view: option text without is_correct.
create or replace view formative_options_public
with (security_invoker = false) as
  select o.id, o.question_id, o.label, o.sequence
    from formative_options o
    join formative_questions q  on q.id = o.question_id
    join formative_assessments fa on fa.id = q.assessment_id
   where fa.publication_status = 'PUBLISHED'
     and app.can_access_module(fa.module_id);

grant select on formative_options_public to authenticated;

comment on view formative_options_public is
  'Learner-facing option list. security_invoker=false so it runs as owner and bypasses the deliberate absence of a learner SELECT policy on formative_options — while structurally omitting is_correct.';

-- Attempts: own rows readable; INSERT/UPDATE go through the functions.
create policy formative_att_read_own on formative_attempts
  for select to authenticated using (app.owns_enrollment(enrollment_id));
create policy formative_att_read_staff on formative_attempts
  for select to authenticated using (app.is_staff());
create policy formative_att_admin on formative_attempts
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy formative_ans_read_own on formative_answers
  for select to authenticated using (
    exists (select 1 from formative_attempts at
             where at.id = attempt_id and app.owns_enrollment(at.enrollment_id))
  );
create policy formative_ans_read_staff on formative_answers
  for select to authenticated using (app.is_staff());
create policy formative_ans_admin on formative_answers
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- ============================================================================
-- SUMMATIVE
-- ============================================================================
create policy summative_read_unlocked on summative_assessments
  for select to authenticated using (
    publication_status = 'PUBLISHED' and app.can_access_module(module_id)
  );
create policy summative_read_staff on summative_assessments
  for select to authenticated using (app.is_staff());
create policy summative_academic_write on summative_assessments
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

create policy summative_q_read on summative_questions
  for select to authenticated using (
    exists (select 1 from summative_assessments sa
             where sa.id = assessment_id
               and sa.publication_status = 'PUBLISHED'
               and app.can_access_module(sa.module_id))
  );
create policy summative_q_staff on summative_questions
  for select to authenticated using (app.is_staff());
create policy summative_q_academic_write on summative_questions
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

-- Same answer-key protection as formative.
create policy summative_opt_staff_read on summative_options
  for select to authenticated using (app.is_staff());
create policy summative_opt_academic_write on summative_options
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

create or replace view summative_options_public
with (security_invoker = false) as
  select o.id, o.question_id, o.label, o.sequence
    from summative_options o
    join summative_questions q  on q.id = o.question_id
    join summative_assessments sa on sa.id = q.assessment_id
   where sa.publication_status = 'PUBLISHED'
     and app.can_access_module(sa.module_id);

grant select on summative_options_public to authenticated;

create policy summative_att_read_own on summative_attempts
  for select to authenticated using (app.owns_enrollment(enrollment_id));
create policy summative_att_read_staff on summative_attempts
  for select to authenticated using (app.is_staff());
-- Assessors may take ownership of a queued attempt.
create policy summative_att_assessor_update on summative_attempts
  for update to authenticated
  using (app.is_assessor() and status in ('SUBMITTED','UNDER_REVIEW'))
  with check (app.is_assessor());
create policy summative_att_admin on summative_attempts
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy summative_ans_read_own on summative_answers
  for select to authenticated using (
    exists (select 1 from summative_attempts at
             where at.id = attempt_id and app.owns_enrollment(at.enrollment_id))
  );
-- A learner may write answers only while the attempt is still open
-- (brief: "modify assessment answers after submission" must be impossible).
create policy summative_ans_write_own on summative_answers
  for insert to authenticated with check (
    exists (select 1 from summative_attempts at
             where at.id = attempt_id
               and app.owns_enrollment(at.enrollment_id)
               and at.status in ('DRAFT','OPEN','RESUBMISSION_REQUIRED'))
  );
create policy summative_ans_update_own on summative_answers
  for update to authenticated
  using (
    exists (select 1 from summative_attempts at
             where at.id = attempt_id
               and app.owns_enrollment(at.enrollment_id)
               and at.status in ('DRAFT','OPEN','RESUBMISSION_REQUIRED'))
  )
  with check (
    exists (select 1 from summative_attempts at
             where at.id = attempt_id and app.owns_enrollment(at.enrollment_id))
  );
create policy summative_ans_read_staff on summative_answers
  for select to authenticated using (app.is_staff());
create policy summative_ans_assessor_mark on summative_answers
  for update to authenticated using (app.is_assessor()) with check (app.is_assessor());

-- ============================================================================
-- SUBMISSIONS
-- ============================================================================
create policy assignments_read on assignments
  for select to authenticated using (
    app.is_staff()
    or (module_id is not null and app.can_access_module(module_id))
    or (summative_assessment_id is not null and exists (
          select 1 from summative_assessments sa
           where sa.id = summative_assessment_id and app.can_access_module(sa.module_id)))
  );
create policy assignments_academic_write on assignments
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

create policy submissions_read_own on submissions
  for select to authenticated using (app.owns_enrollment(enrollment_id));
create policy submissions_read_staff on submissions
  for select to authenticated using (app.is_staff());
create policy submissions_update_own on submissions
  for update to authenticated
  using (app.owns_enrollment(enrollment_id) and status in ('DRAFT','RESUBMISSION_REQUIRED'))
  with check (app.owns_enrollment(enrollment_id));
create policy submissions_assessor on submissions
  for update to authenticated using (app.is_assessor()) with check (app.is_assessor());
create policy submissions_admin on submissions
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy submission_versions_read_own on submission_versions
  for select to authenticated using (
    exists (select 1 from submissions s where s.id = submission_id and app.owns_enrollment(s.enrollment_id))
  );
create policy submission_versions_read_staff on submission_versions
  for select to authenticated using (app.is_staff());
create policy submission_versions_insert_own on submission_versions
  for insert to authenticated with check (
    exists (select 1 from submissions s
             where s.id = submission_id
               and app.owns_enrollment(s.enrollment_id)
               and s.status in ('DRAFT','RESUBMISSION_REQUIRED'))
  );
-- No UPDATE/DELETE for anyone: versions are immutable evidence.
create policy submission_versions_admin_read on submission_versions
  for select to authenticated using (app.is_admin());

create policy submission_files_read_own on submission_files
  for select to authenticated using (
    exists (select 1 from submission_versions sv
              join submissions s on s.id = sv.submission_id
             where sv.id = version_id and app.owns_enrollment(s.enrollment_id))
  );
create policy submission_files_read_staff on submission_files
  for select to authenticated using (app.is_staff());
create policy submission_files_insert_own on submission_files
  for insert to authenticated with check (
    exists (select 1 from submission_versions sv
              join submissions s on s.id = sv.submission_id
             where sv.id = version_id
               and app.owns_enrollment(s.enrollment_id)
               and s.status in ('DRAFT','RESUBMISSION_REQUIRED'))
  );

-- ============================================================================
-- GRADEBOOK
-- ============================================================================
create policy rubrics_read on rubrics
  for select to authenticated using (app.is_authenticated());
create policy rubrics_academic_write on rubrics
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

create policy rubric_criteria_read on rubric_criteria
  for select to authenticated using (app.is_authenticated());
create policy rubric_criteria_academic_write on rubric_criteria
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

-- BR-008: learners read their own grades, and ONLY after release.
-- There is no learner INSERT/UPDATE/DELETE policy on grades at all.
create policy grades_read_own_released on grades
  for select to authenticated using (
    app.owns_enrollment(enrollment_id) and released_at is not null
  );
create policy grades_read_staff on grades
  for select to authenticated using (app.is_staff());
create policy grades_assessor_write on grades
  for insert to authenticated with check (app.is_assessor());
create policy grades_admin on grades
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy grade_criteria_read_own on grade_criteria_scores
  for select to authenticated using (
    exists (select 1 from grades g
             where g.id = grade_id
               and app.owns_enrollment(g.enrollment_id)
               and g.released_at is not null)
  );
create policy grade_criteria_read_staff on grade_criteria_scores
  for select to authenticated using (app.is_staff());
create policy grade_criteria_assessor_write on grade_criteria_scores
  for insert to authenticated with check (app.is_assessor());

-- Feedback: internal notes stay staff-only.
create policy feedback_read_own on feedback
  for select to authenticated using (
    app.owns_enrollment(enrollment_id) and is_internal = false
  );
create policy feedback_read_staff on feedback
  for select to authenticated using (app.is_staff());
create policy feedback_learner_reply on feedback
  for insert to authenticated with check (
    app.owns_enrollment(enrollment_id) and is_internal = false and author_id = auth.uid()
  );
create policy feedback_staff_write on feedback
  for insert to authenticated with check (app.is_staff() and author_id = auth.uid());
create policy feedback_admin on feedback
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- ============================================================================
-- FINAL EXAM
-- ============================================================================
-- A learner may see that the exam exists and its rules, but not its questions
-- until an attempt is in progress.
create policy final_exams_read_enrolled on final_exams
  for select to authenticated using (
    publication_status = 'PUBLISHED' and app.has_active_enrollment(course_id)
  );
create policy final_exams_read_staff on final_exams
  for select to authenticated using (app.is_staff());
create policy final_exams_academic_write on final_exams
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

-- Questions are visible ONLY if they are in the learner's live attempt.
create policy final_q_read_during_attempt on final_exam_questions
  for select to authenticated using (
    exists (select 1 from final_exam_attempts at
             where at.exam_id = exam_id
               and app.owns_enrollment(at.enrollment_id)
               and at.status = 'IN_PROGRESS'
               and final_exam_questions.id = any(at.question_ids))
  );
create policy final_q_read_staff on final_exam_questions
  for select to authenticated using (app.is_staff());
create policy final_q_academic_write on final_exam_questions
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

-- Answer keys: staff only, always.
create policy final_opt_staff_read on final_exam_options
  for select to authenticated using (app.is_staff());
create policy final_opt_academic_write on final_exam_options
  for all to authenticated using (app.is_academic()) with check (app.is_academic());

create or replace view final_exam_options_public
with (security_invoker = false) as
  select o.id, o.question_id, o.label, o.sequence
    from final_exam_options o
   where exists (
     select 1 from final_exam_attempts at
      where app.owns_enrollment(at.enrollment_id)
        and at.status = 'IN_PROGRESS'
        and o.question_id = any(at.question_ids)
   );

grant select on final_exam_options_public to authenticated;

comment on view final_exam_options_public is
  'Exam options for the caller''s live attempt only. Omits is_correct and disappears the moment the attempt is submitted.';

create policy final_att_read_own on final_exam_attempts
  for select to authenticated using (app.owns_enrollment(enrollment_id));
create policy final_att_read_staff on final_exam_attempts
  for select to authenticated using (app.is_staff());
create policy final_att_assessor_mark on final_exam_attempts
  for update to authenticated using (app.is_assessor()) with check (app.is_assessor());
create policy final_att_admin on final_exam_attempts
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy final_ans_read_own on final_exam_answers
  for select to authenticated using (
    exists (select 1 from final_exam_attempts at
             where at.id = attempt_id and app.owns_enrollment(at.enrollment_id))
  );
create policy final_ans_read_staff on final_exam_answers
  for select to authenticated using (app.is_staff());
create policy final_ans_assessor_mark on final_exam_answers
  for update to authenticated using (app.is_assessor()) with check (app.is_assessor());

-- ============================================================================
-- CERTIFICATES
-- ============================================================================
-- BR-009: no learner INSERT/UPDATE/DELETE. Issuance is issue_certificate() only.
create policy certificates_read_own on certificates
  for select to authenticated using (profile_id = auth.uid());
create policy certificates_read_staff on certificates
  for select to authenticated using (app.is_staff());
create policy certificates_admin on certificates
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- Counters are internal: no policy grants access, so only SECURITY DEFINER
-- functions can touch them.
create policy certificate_sequences_admin on certificate_sequences
  for select to authenticated using (app.is_admin());
create policy invoice_sequences_admin on invoice_sequences
  for select to authenticated using (app.is_admin());

-- ============================================================================
-- PAYMENTS
-- ============================================================================
create policy invoices_read_own on invoices
  for select to authenticated using (profile_id = auth.uid());
create policy invoices_read_finance on invoices
  for select to authenticated using (app.is_finance() or app.is_staff());
create policy invoices_finance_write on invoices
  for all to authenticated using (app.is_finance()) with check (app.is_finance());

create policy payments_read_own on payments
  for select to authenticated using (profile_id = auth.uid());
create policy payments_read_finance on payments
  for select to authenticated using (app.is_finance() or app.is_staff());
-- A learner may declare a payment, but only as SUBMITTED and unreviewed.
-- They cannot mark it APPROVED (audit M-07).
create policy payments_declare_own on payments
  for insert to authenticated with check (
    profile_id = auth.uid()
    and status = 'SUBMITTED'
    and reviewed_at is null
    and reviewed_by is null
  );
create policy payments_finance_write on payments
  for all to authenticated using (app.is_finance()) with check (app.is_finance());

create policy payment_proofs_read_own on payment_proofs
  for select to authenticated using (
    exists (select 1 from payments p where p.id = payment_id and p.profile_id = auth.uid())
  );
create policy payment_proofs_read_finance on payment_proofs
  for select to authenticated using (app.is_finance());
create policy payment_proofs_upload_own on payment_proofs
  for insert to authenticated with check (
    exists (select 1 from payments p
             where p.id = payment_id
               and p.profile_id = auth.uid()
               and p.status in ('SUBMITTED','UNDER_REVIEW'))
  );

-- Append-only ledger: SELECT only, no write policy for anyone.
create policy payment_events_read_own on payment_events
  for select to authenticated using (
    exists (select 1 from payments p where p.id = payment_id and p.profile_id = auth.uid())
  );
create policy payment_events_read_finance on payment_events
  for select to authenticated using (app.is_finance());

-- ============================================================================
-- NOTIFICATIONS & ANNOUNCEMENTS
-- ============================================================================
create policy notifications_read_own on notifications
  for select to authenticated using (profile_id = auth.uid());
-- Mark-as-read only; the WITH CHECK keeps the row pinned to the same owner.
create policy notifications_update_own on notifications
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
create policy notifications_admin on notifications
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy announcements_read_live on announcements
  for select to authenticated using (
    publication_status = 'PUBLISHED'
    and publish_at <= now()
    and (expires_at is null or expires_at > now())
    and (
      cardinality(audience_roles) = 0
      or app.has_any_role(audience_roles)
    )
    and (course_id is null or app.has_active_enrollment(course_id))
  );
create policy announcements_read_staff on announcements
  for select to authenticated using (app.is_staff());
create policy announcements_admin_write on announcements
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- ============================================================================
-- AUDIT & CONTACT
-- ============================================================================
-- BR-012. Read-only for admin; NO insert/update/delete policy for any role.
-- Rows arrive exclusively through app.create_audit_log() (SECURITY DEFINER).
create policy audit_logs_admin_read on audit_logs
  for select to authenticated using (app.is_admin());

comment on table audit_logs is
  'Append-only. Deliberately has no INSERT, UPDATE or DELETE policy — not even for ADMIN. Writes happen only through app.create_audit_log().';

-- Anyone may submit the public contact form; only staff may read it.
create policy contact_insert_public on contact_messages
  for insert to anon, authenticated with check (
    status = 'NEW' and assigned_to is null and handled_at is null
  );
create policy contact_read_staff on contact_messages
  for select to authenticated using (app.is_staff());
create policy contact_staff_write on contact_messages
  for update to authenticated using (app.is_staff()) with check (app.is_staff());

-- ============================================================================
-- TABLE GRANTS
--
-- RLS filters rows; grants decide which verbs are reachable at all. Both are
-- required — RLS on a table with no grant is unreachable, and a grant with no
-- policy returns nothing.
-- ============================================================================
grant usage on schema public to anon, authenticated;

grant select on
  institution, courses
to anon;

grant insert on contact_messages to anon;

grant select on all tables in schema public to authenticated;

grant insert, update on
  profiles, lesson_progress, notifications
to authenticated;

grant insert on
  enrollments, summative_answers, submission_versions, submission_files,
  payments, payment_proofs, feedback, contact_messages
to authenticated;

grant update on
  summative_answers, summative_attempts, submissions,
  final_exam_attempts, final_exam_answers, contact_messages,
  courses, course_modules, lessons, learning_resources,
  formative_assessments, formative_questions, formative_options,
  summative_assessments, summative_questions, summative_options,
  final_exams, final_exam_questions, final_exam_options,
  rubrics, rubric_criteria, assignments, announcements,
  invoices, institution, institution_settings, cohorts,
  enrollments, module_progress, user_roles, grades, certificates
to authenticated;

grant insert, delete on
  courses, course_modules, lessons, learning_resources,
  formative_assessments, formative_questions, formative_options,
  summative_assessments, summative_questions, summative_options,
  final_exams, final_exam_questions, final_exam_options,
  rubrics, rubric_criteria, assignments, announcements,
  cohorts, user_roles, invoices, grades, grade_criteria_scores, certificates
to authenticated;

-- Never grant write on the append-only tables.
revoke insert, update, delete on audit_logs    from authenticated, anon;
revoke update, delete on payment_events        from authenticated, anon;
revoke update, delete on submission_versions   from authenticated, anon;
revoke insert, update, delete on certificate_sequences, invoice_sequences from authenticated, anon;
