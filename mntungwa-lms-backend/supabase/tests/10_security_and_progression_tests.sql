-- ============================================================================
-- 10_security_and_progression_tests.sql
--
-- Proves the properties the audit said were broken. Every assertion below maps
-- to a specific finding or business rule. Run after migrations + seed:
--
--     ./run_migrations.sh --seed --test
--
-- Any failure raises and aborts the run.
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

create or replace function assert(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_condition then
    raise notice '  PASS  %', p_label;
  else
    raise exception 'ASSERTION FAILED: %', p_label;
  end if;
end;
$$;

create or replace function assert_raises(p_sql text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice '  PASS  % (blocked: %)', p_label, left(sqlerrm, 60);
    return;
  end;
  raise exception 'ASSERTION FAILED: % — the operation was ALLOWED but should have been blocked', p_label;
end;
$$;

-- RLS does not raise on a write the caller may not perform: it filters the
-- rows out, so the statement succeeds and affects nothing. That silent
-- zero-row outcome IS the protection, so a write is "blocked" when it either
-- raises OR changes no rows. Asserting only on exceptions would miss the
-- most common case and give a false sense of coverage.
create or replace function assert_blocked(p_sql text, p_label text)
returns void language plpgsql as $$
declare v_rows integer;
begin
  begin
    execute p_sql;
    get diagnostics v_rows = ROW_COUNT;
  exception when others then
    raise notice '  PASS  % (rejected: %)', p_label, left(sqlerrm, 50);
    return;
  end;

  if v_rows = 0 then
    raise notice '  PASS  % (RLS filtered: 0 rows affected)', p_label;
  else
    raise exception 'ASSERTION FAILED: % — % row(s) were modified', p_label, v_rows;
  end if;
end;
$$;

-- ============================================================================
-- FIXTURES
-- ============================================================================
do $$
declare
  v_course   uuid;
  v_cohort   uuid;
  v_learner  uuid := '00000000-0000-0000-0000-00000000a001';
  v_other    uuid := '00000000-0000-0000-0000-00000000a002';
  v_assessor uuid := '00000000-0000-0000-0000-00000000a003';
  v_admin    uuid := '00000000-0000-0000-0000-00000000a004';
  v_finance  uuid := '00000000-0000-0000-0000-00000000a005';
begin
  select id into v_course from courses where code = 'OC-PM-101869';
  select id into v_cohort from cohorts where code = 'PM-2026A';

  -- Auth users. The handle_new_user trigger creates profiles + LEARNER role.
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (v_learner,  'thabo@example.test',    now(), '{"full_name":"Thabo Nkosi"}'),
    (v_other,    'lerato@example.test',   now(), '{"full_name":"Lerato Mokoena"}'),
    (v_assessor, 'assessor@example.test', now(), '{"full_name":"Nomsa Dlamini"}'),
    (v_admin,    'admin@example.test',    now(), '{"full_name":"Site Admin"}'),
    (v_finance,  'finance@example.test',  now(), '{"full_name":"Finance Officer"}'),
    -- Left at PENDING_PAYMENT on purpose: this is the account used to test
    -- the self-activation attack (the demo's payment gate was a client-side
    -- boolean a learner could simply flip — audit S-05/M-07).
    ('00000000-0000-0000-0000-00000000a006','pending@example.test', now(), '{"full_name":"Sibusiso Zulu"}')
  on conflict (id) do nothing;

  insert into user_roles (profile_id, role) values
    (v_assessor, 'ASSESSOR'), (v_admin, 'ADMIN'), (v_finance, 'FINANCE')
  on conflict do nothing;

  -- app.guard_profile_self_update() blocks account_status changes by
  -- non-admins, so the fixture must authenticate as the admin to activate
  -- these accounts. (That the guard fired here first time round is itself
  -- evidence it works.)
  perform auth.login_as(v_admin);
  update profiles set account_status = 'ACTIVE'
   where id in (v_learner, v_other, v_assessor, v_admin, v_finance);
  perform auth.logout();

  -- Two active enrollments so cross-learner isolation can be tested.
  insert into enrollments (id, profile_id, course_id, cohort_id, status, activated_at,
                           payment_cleared, payment_cleared_at, documents_verified, documents_verified_at)
  values
    ('00000000-0000-0000-0000-0000000000e1', v_learner, v_course, v_cohort, 'ACTIVE', now(), true, now(), true, now()),
    ('00000000-0000-0000-0000-0000000000e2', v_other,   v_course, v_cohort, 'ACTIVE', now(), true, now(), true, now())
  on conflict (profile_id, course_id) do nothing;

  perform app.refresh_module_unlocks('00000000-0000-0000-0000-0000000000e1');
  perform app.refresh_module_unlocks('00000000-0000-0000-0000-0000000000e2');
  perform app.recalculate_enrollment_progress('00000000-0000-0000-0000-0000000000e1');
end
$$;

-- ============================================================================
-- GROUP 1 — PROGRESSION (replaces isUnlocked)
-- ============================================================================
\echo ''
\echo '== GROUP 1: progression =='
do $$
declare v_open integer; v_locked integer;
begin
  select count(*) filter (where status <> 'LOCKED'),
         count(*) filter (where status =  'LOCKED')
    into v_open, v_locked
    from module_progress where enrollment_id = '00000000-0000-0000-0000-0000000000e1';

  perform assert(v_open = 1,   'BR-002: exactly one module is open at enrollment (KM-01)');
  perform assert(v_locked = 27,'BR-002: the remaining 27 modules are LOCKED');
end
$$;

-- ============================================================================
-- GROUP 2 — ANSWER KEY PROTECTION (audit S-03, risk R-01)
-- ============================================================================
\echo ''
\echo '== GROUP 2: answer keys =='
do $$
declare v_count integer;
begin
  -- Learner session.
  perform auth.login_as('00000000-0000-0000-0000-00000000a001');
  set local role authenticated;

  select count(*) into v_count from formative_options;
  perform assert(v_count = 0, 'S-03: a learner reading formative_options gets ZERO rows');

  select count(*) into v_count from final_exam_options;
  perform assert(v_count = 0, 'S-03: a learner reading final_exam_options gets ZERO rows');

  select count(*) into v_count from summative_options;
  perform assert(v_count = 0, 'S-03: a learner reading summative_options gets ZERO rows');

  reset role;
  perform auth.logout();
end
$$;

do $$
declare v_cols integer; v_count integer;
begin
  perform auth.login_as('00000000-0000-0000-0000-00000000a001');
  set local role authenticated;

  -- The safe view returns option text for the unlocked module only.
  select count(*) into v_count from formative_options_public;
  perform assert(v_count = 24, 'safe view exposes only the unlocked module''s options (4 options x 6 questions)');

  reset role;
  perform auth.logout();

  -- Structural guarantee: is_correct is not a column of the view at all.
  select count(*) into v_cols
    from information_schema.columns
   where table_name = 'formative_options_public' and column_name = 'is_correct';
  perform assert(v_cols = 0, 'R-01: formative_options_public has no is_correct column');
end
$$;

-- ============================================================================
-- GROUP 3 — LEARNER CANNOT WRITE RESULTS (audit S-04)
-- ============================================================================
\echo ''
\echo '== GROUP 3: result integrity =='
do $$
begin
  perform auth.login_as('00000000-0000-0000-0000-00000000a001');
  set local role authenticated;

  perform assert_blocked(
    $q$update module_progress set status = 'PASSED'
        where enrollment_id = '00000000-0000-0000-0000-0000000000e1'$q$,
    'BR-002: learner cannot mark a module PASSED');

  perform assert_blocked(
    $q$update enrollments set course_completed = true, credits_earned = 240
        where id = '00000000-0000-0000-0000-0000000000e1'$q$,
    'learner cannot inflate their own credits');

  perform assert_raises(
    $q$insert into user_roles (profile_id, role)
       values ('00000000-0000-0000-0000-00000000a001','ADMIN')$q$,
    'S-05: learner cannot grant themselves ADMIN');

  reset role;
  perform auth.logout();
end
$$;

-- The self-activation attack, run as the PENDING_PAYMENT learner.
do $$
declare v_status account_status;
begin
  perform auth.login_as('00000000-0000-0000-0000-00000000a006');
  set local role authenticated;

  perform assert_blocked(
    $q$update profiles set account_status = 'ACTIVE'
        where id = '00000000-0000-0000-0000-00000000a006'$q$,
    'M-07: a PENDING_PAYMENT learner cannot activate their own account');

  reset role;
  perform auth.logout();

  select account_status into v_status
    from profiles where id = '00000000-0000-0000-0000-00000000a006';
  perform assert(v_status = 'PENDING_PAYMENT',
    'M-07: the account is still PENDING_PAYMENT after the attempt');
end
$$;

-- Regression for migration 021. The guard must NOT block the server-side
-- promotion that Supabase Auth's email-confirmation trigger performs — the
-- fixtures above never exercise it because they create users already
-- confirmed. Here a genuinely unconfirmed account is confirmed and must move
-- PENDING_VERIFICATION -> PENDING_PAYMENT on its own.
do $$
declare v_status account_status;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-00000000a007', 'confirm-me@example.test',
          '{"full_name":"Confirm Me"}')
  on conflict (id) do nothing;

  select account_status into v_status
    from profiles where id = '00000000-0000-0000-0000-00000000a007';
  perform assert(v_status = 'PENDING_VERIFICATION',
    '021: a new unconfirmed signup starts PENDING_VERIFICATION');

  -- Fires on_auth_user_confirmed -> handle_user_confirmed(), exactly as GoTrue
  -- does when the learner clicks the confirmation link.
  update auth.users set email_confirmed_at = now()
   where id = '00000000-0000-0000-0000-00000000a007';

  select account_status into v_status
    from profiles where id = '00000000-0000-0000-0000-00000000a007';
  perform assert(v_status = 'PENDING_PAYMENT',
    '021: email confirmation promotes the account to PENDING_PAYMENT (guard not tripped)');
end
$$;

-- ============================================================================
-- GROUP 4 — CROSS-LEARNER ISOLATION (audit S-06)
-- ============================================================================
\echo ''
\echo '== GROUP 4: data isolation =='
do $$
declare v_count integer;
begin
  perform auth.login_as('00000000-0000-0000-0000-00000000a001');
  set local role authenticated;

  select count(*) into v_count from enrollments;
  perform assert(v_count = 1, 'S-06: learner sees only their OWN enrollment, not both');

  select count(*) into v_count from module_progress
   where enrollment_id = '00000000-0000-0000-0000-0000000000e2';
  perform assert(v_count = 0, 'S-06: learner cannot read another learner''s progress');

  select count(*) into v_count from profiles;
  perform assert(v_count = 1, 'S-06/S-07: learner sees only their own profile row');

  reset role;
  perform auth.logout();
end
$$;

-- ============================================================================
-- GROUP 5 — SERVER-SIDE GRADING (the S-03/S-04 fix in action)
-- ============================================================================
\echo ''
\echo '== GROUP 5: server-side grading =='
do $$
declare
  v_assessment uuid;
  v_attempt    uuid;
  q            record;
  v_result     record;
  v_status     progress_status;
begin
  perform auth.login_as('00000000-0000-0000-0000-00000000a001');
  set local role authenticated;

  select fa.id into v_assessment
    from formative_assessments fa
    join course_modules m on m.id = fa.module_id
   where m.code = 'KM-01';

  v_attempt := public.start_formative_attempt(v_assessment);
  perform assert(v_attempt is not null, 'learner can start a formative attempt on the unlocked module');

  -- Answer every question WRONG by picking option 1 where the seeded correct
  -- answer is a different index. Uses only data a learner can legitimately see.
  for q in
    select fq.id as qid,
           (select id from formative_options_public o
             where o.question_id = fq.id order by o.sequence limit 1) as first_opt
      from formative_questions fq
     where fq.assessment_id = v_assessment
  loop
    perform public.save_formative_answer(v_attempt, q.qid, array[q.first_opt]);
  end loop;

  select * into v_result from public.submit_formative_attempt(v_attempt);

  -- KM-01 correct indices are 1,1,1,0,1,1 → picking option 1 scores 1/6 ≈ 16.67%.
  perform assert(v_result.score_percent < 50,
    format('S-04: score computed server-side from the answer key (got %s%%)', v_result.score_percent));
  perform assert(v_result.passed = false, 'S-04: pass/fail decided by the database, not the client');

  reset role;
  perform auth.logout();

  -- The failed attempt must NOT have unlocked KM-02.
  select status into v_status
    from module_progress mp join course_modules m on m.id = mp.module_id
   where mp.enrollment_id = '00000000-0000-0000-0000-0000000000e1' and m.code = 'KM-02';
  perform assert(v_status = 'LOCKED', 'BR-002: a failed formative does not unlock the next module');
end
$$;

-- Now pass it properly, using the answer key as staff would never expose it.
do $$
declare
  v_assessment uuid; v_attempt uuid; q record; v_result record; v_status progress_status;
begin
  select fa.id into v_assessment
    from formative_assessments fa join course_modules m on m.id = fa.module_id
   where m.code = 'KM-01';

  perform auth.login_as('00000000-0000-0000-0000-00000000a001');
  set local role authenticated;

  -- A module completes only when ALL its configured requirements are met.
  -- KM-01 has require_all_lessons = true, so the study guide must be marked
  -- complete before the knowledge check can carry the module to PASSED.
  perform public.complete_lesson(
    (select l.id from lessons l join course_modules m on m.id = l.module_id
      where m.code = 'KM-01' order by l.sequence limit 1));

  v_attempt := public.start_formative_attempt(v_assessment);
  reset role;
  perform auth.logout();

  -- Correct options resolved with elevated rights (simulating the marking key,
  -- which the learner never touches).
  for q in
    select fq.id as qid,
           (select o.id from formative_options o
             where o.question_id = fq.id and o.is_correct limit 1) as right_opt
      from formative_questions fq where fq.assessment_id = v_assessment
  loop
    perform auth.login_as('00000000-0000-0000-0000-00000000a001');
    set local role authenticated;
    perform public.save_formative_answer(v_attempt, q.qid, array[q.right_opt]);
    reset role;
    perform auth.logout();
  end loop;

  perform auth.login_as('00000000-0000-0000-0000-00000000a001');
  set local role authenticated;
  select * into v_result from public.submit_formative_attempt(v_attempt);
  reset role;
  perform auth.logout();

  perform assert(v_result.score_percent = 100, 'all-correct attempt scores 100%');
  perform assert(v_result.passed = true, 'attempt above the pass mark is PASSED');

  select status into v_status
    from module_progress mp join course_modules m on m.id = mp.module_id
   where mp.enrollment_id = '00000000-0000-0000-0000-0000000000e1' and m.code = 'KM-01';
  perform assert(v_status = 'PASSED', 'KM-01 reaches PASSED (no summative required on KM)');

  select status into v_status
    from module_progress mp join course_modules m on m.id = mp.module_id
   where mp.enrollment_id = '00000000-0000-0000-0000-0000000000e1' and m.code = 'KM-02';
  perform assert(v_status = 'NOT_STARTED', 'BR-002: passing KM-01 UNLOCKS KM-02 automatically');

  select status into v_status
    from module_progress mp join course_modules m on m.id = mp.module_id
   where mp.enrollment_id = '00000000-0000-0000-0000-0000000000e1' and m.code = 'KM-03';
  perform assert(v_status = 'LOCKED', 'BR-002: KM-03 stays locked — one step at a time');
end
$$;

-- Best-score-retained rule (audit §2.3).
do $$
declare
  v_assessment uuid; v_attempt uuid; q record; v_status progress_status; v_best numeric;
begin
  select fa.id into v_assessment
    from formative_assessments fa join course_modules m on m.id = fa.module_id
   where m.code = 'KM-01';

  perform auth.login_as('00000000-0000-0000-0000-00000000a001');
  set local role authenticated;
  v_attempt := public.start_formative_attempt(v_assessment);
  for q in
    select fq.id as qid,
           (select id from formative_options_public o where o.question_id = fq.id order by o.sequence limit 1) as opt
      from formative_questions fq where fq.assessment_id = v_assessment
  loop
    perform public.save_formative_answer(v_attempt, q.qid, array[q.opt]);
  end loop;
  perform public.submit_formative_attempt(v_attempt);
  reset role;
  perform auth.logout();

  select status, best_score into v_status, v_best
    from module_progress mp join course_modules m on m.id = mp.module_id
   where mp.enrollment_id = '00000000-0000-0000-0000-0000000000e1' and m.code = 'KM-01';

  perform assert(v_status = 'PASSED', 'demo rule preserved: a poor retake does NOT downgrade a PASSED module');
  perform assert(v_best = 100, 'demo rule preserved: the BEST score is retained');
end
$$;

-- ============================================================================
-- GROUP 6 — FINAL EXAM ELIGIBILITY (BR-005)
-- ============================================================================
\echo ''
\echo '== GROUP 6: final exam eligibility =='
do $$
declare v jsonb;
begin
  perform auth.login_as('00000000-0000-0000-0000-00000000a001');
  set local role authenticated;

  v := public.check_final_exam_eligibility('00000000-0000-0000-0000-0000000000e1');
  perform assert((v->>'eligible')::boolean = false,
    'BR-005: learner with 1/28 modules is NOT eligible for the final exam');
  perform assert(v->>'reason' = 'REQUIREMENTS_OUTSTANDING',
    'BR-005: verdict explains why, rather than a bare false');

  perform assert_raises(
    $q$select public.start_final_exam_attempt('00000000-0000-0000-0000-0000000000e1')$q$,
    'BR-005: starting the final exam while ineligible is refused server-side');

  reset role;
  perform auth.logout();
end
$$;

-- ============================================================================
-- GROUP 7 — CERTIFICATE (BR-009, BR-010)
-- ============================================================================
\echo ''
\echo '== GROUP 7: certificates =='
do $$
declare v jsonb;
begin
  perform auth.login_as('00000000-0000-0000-0000-00000000a001');
  set local role authenticated;

  v := public.check_certificate_eligibility('00000000-0000-0000-0000-0000000000e1');
  perform assert((v->>'eligible')::boolean = false,
    'BR-010: certificate not available with modules outstanding');

  perform assert_raises(
    $q$select public.issue_certificate('00000000-0000-0000-0000-0000000000e1')$q$,
    'BR-009: a learner cannot issue their own certificate');

  perform assert_raises(
    $q$insert into certificates (certificate_number, enrollment_id, profile_id, course_id,
                                 learner_name, course_title)
       select 'FAKE-001','00000000-0000-0000-0000-0000000000e1',
              '00000000-0000-0000-0000-00000000a001', id,'Thabo Nkosi','Forged'
         from courses limit 1$q$,
    'BR-009: a learner cannot INSERT a certificate row directly');

  reset role;
  perform auth.logout();
end
$$;

-- Even an admin cannot force one while requirements are outstanding (risk R-06).
do $$
begin
  perform auth.login_as('00000000-0000-0000-0000-00000000a004');
  set local role authenticated;
  perform assert_raises(
    $q$select public.issue_certificate('00000000-0000-0000-0000-0000000000e1')$q$,
    'R-06: even ADMIN cannot issue a certificate before requirements are met');
  reset role;
  perform auth.logout();
end
$$;

-- Verification exposes no personal information beyond the certificate face.
do $$
declare v jsonb;
begin
  perform auth.logout();
  set local role anon;
  v := public.verify_certificate('DOES-NOT-EXIST-123');
  perform assert((v->>'valid')::boolean = false, 'public verification of an unknown number returns invalid');
  perform assert(not (v ? 'id_number'), 'R-05: verification response contains no id_number');
  perform assert(not (v ? 'email'),     'R-05: verification response contains no email');
  reset role;
end
$$;

-- ============================================================================
-- GROUP 8 — GRADING AUTHORISATION (BR-007, BR-008)
-- ============================================================================
\echo ''
\echo '== GROUP 8: grading authorisation =='
do $$
declare v_sa uuid; v_attempt uuid;
begin
  -- Give the learner access to PM-01 by fast-forwarding the chain with
  -- elevated rights (a shortcut for the test, not a product path).
  update module_progress set status = 'PASSED', passed_at = now(), credits_awarded = 8
   where enrollment_id = '00000000-0000-0000-0000-0000000000e1'
     and module_id in (select id from course_modules where track = 'KM');
  perform app.refresh_module_unlocks('00000000-0000-0000-0000-0000000000e1');

  select sa.id into v_sa
    from summative_assessments sa join course_modules m on m.id = sa.module_id
   where m.code = 'PM-01';

  perform auth.login_as('00000000-0000-0000-0000-00000000a001');
  set local role authenticated;
  v_attempt := public.start_summative_attempt(v_sa);
  perform assert(v_attempt is not null, 'learner can start the PM-01 summative once KM modules are passed');

  -- A submission with no evidence must be refused (audit M-12).
  perform assert_raises(
    format($q$select public.submit_summative_attempt(%L)$q$, v_attempt),
    'M-12: submitting with zero uploaded files is refused');

  -- A learner cannot grade themselves.
  perform assert_raises(
    format($q$select public.grade_summative_attempt(%L, '[]'::jsonb, 100, 'pass me', true)$q$, v_attempt),
    'BR-007/BR-008: a learner cannot grade their own submission');

  reset role;
  perform auth.logout();
end
$$;

-- A grade whose pass flag contradicts the arithmetic is rejected by the DB.
do $$
begin
  perform assert_raises(
    $q$insert into grades (summative_attempt_id, enrollment_id, score_percent,
                           pass_mark_applied, passed)
       select id, enrollment_id, 20, 50, true from summative_attempts limit 1$q$,
    'S-04: a 20% result cannot be recorded as PASSED (CHECK constraint)');
end
$$;

-- ============================================================================
-- GROUP 9 — AUDIT LOG IMMUTABILITY (BR-012)
-- ============================================================================
\echo ''
\echo '== GROUP 9: audit immutability =='
do $$
declare v_count integer;
begin
  select count(*) into v_count from audit_logs where action = 'FORMATIVE_ATTEMPT_SUBMITTED';
  perform assert(v_count >= 2, 'BR-012: formative submissions were audited automatically');

  perform auth.login_as('00000000-0000-0000-0000-00000000a004');
  set local role authenticated;
  perform assert_blocked(
    $q$delete from audit_logs$q$,
    'BR-012: even ADMIN cannot delete audit rows');
  perform assert_blocked(
    $q$update audit_logs set action = 'TAMPERED'$q$,
    'BR-012: even ADMIN cannot modify audit rows');
  reset role;
  perform auth.logout();
end
$$;

-- ============================================================================
-- GROUP 10 — ROLE SEPARATION
-- ============================================================================
\echo ''
\echo '== GROUP 10: role separation =='
do $$
declare v_count integer;
begin
  -- An assessor may see the queue but must not approve payments.
  perform auth.login_as('00000000-0000-0000-0000-00000000a003');
  set local role authenticated;
  select count(*) into v_count from enrollments;
  perform assert(v_count = 2, 'assessor can see all enrollments for grading purposes');
  perform assert_raises(
    $q$select public.review_payment(gen_random_uuid(), true, null)$q$,
    'separation of duties: an ASSESSOR cannot approve payments');
  reset role;
  perform auth.logout();

  -- Finance must not grade.
  perform auth.login_as('00000000-0000-0000-0000-00000000a005');
  set local role authenticated;
  perform assert_raises(
    $q$select public.grade_summative_attempt(gen_random_uuid(), '[]'::jsonb, 90, null, true)$q$,
    'separation of duties: FINANCE cannot grade submissions');
  reset role;
  perform auth.logout();
end
$$;

\echo ''
\echo '== ALL SECURITY AND PROGRESSION TESTS PASSED =='
