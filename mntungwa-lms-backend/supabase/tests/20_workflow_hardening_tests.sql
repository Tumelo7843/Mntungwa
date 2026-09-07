-- ============================================================================
-- 20_workflow_hardening_tests.sql
--
-- Covers migration 022. Runs after 10_security_and_progression_tests.sql, so
-- assert(), assert_raises() and assert_blocked() are already defined and the
-- fixtures from that file (learners a001/a002, admin a004, enrollments e1/e2,
-- and an OPEN PM-01 summative attempt for e1) are in place.
--
-- Storage-policy behaviour (learner_submissions_delete_orphan) is NOT exercised
-- here: the local shim grants no DML on storage.objects, matching the project's
-- standing position that Storage rules are only confirmed on hosted Supabase
-- (docs/WHAT_IS_REAL.md §4).
-- ============================================================================

\set ON_ERROR_STOP on

\echo ''
\echo '== GROUP 11: transactional audit safety-net (migration 022 A) =='
do $$
declare
  v_admin uuid := '00000000-0000-0000-0000-00000000a004';
  v_other uuid := '00000000-0000-0000-0000-00000000a002';
  n integer;
begin
  perform auth.login_as(v_admin);
  set local role authenticated;

  insert into user_roles (profile_id, role) values (v_other, 'SUPPORT');
  delete from user_roles where profile_id = v_other and role = 'SUPPORT';

  reset role;
  perform auth.logout();

  select count(*) into n from audit_logs
   where action = 'ROLE_GRANTED' and resource_type = 'user_role' and resource_id = v_other;
  perform assert(n >= 1, 'BR-012: a role grant writes an audit row via trigger, not best-effort client code');

  select count(*) into n from audit_logs
   where action = 'ROLE_REVOKED' and resource_type = 'user_role' and resource_id = v_other;
  perform assert(n >= 1, 'BR-012: a role revoke writes an audit row via trigger');
end
$$;

do $$
declare
  v_admin uuid := '00000000-0000-0000-0000-00000000a004';
  n integer;
begin
  -- account_status change through a direct admin UPDATE (no explicit audit call)
  perform auth.login_as(v_admin);
  set local role authenticated;
  update profiles set account_status = 'SUSPENDED' where id = '00000000-0000-0000-0000-00000000a002';
  update profiles set account_status = 'ACTIVE'    where id = '00000000-0000-0000-0000-00000000a002';
  reset role;
  perform auth.logout();

  select count(*) into n from audit_logs
   where action = 'ACCOUNT_STATUS_CHANGED' and resource_id = '00000000-0000-0000-0000-00000000a002';
  perform assert(n >= 2, 'BR-012: every account_status change is audited by trigger');
end
$$;

\echo ''
\echo '== GROUP 12: set_enrollment_status — role, transitions, reason (migration 022 B) =='
do $$
declare
  v_support uuid := '00000000-0000-0000-0000-00000000a007';
  v_admin   uuid := '00000000-0000-0000-0000-00000000a004';
  v_learner uuid := '00000000-0000-0000-0000-00000000a001';
  v_e2      uuid := '00000000-0000-0000-0000-0000000000e2';
  v_e1      uuid := '00000000-0000-0000-0000-0000000000e1';
  v_status  enrollment_status;
  v_reason  text;
  n integer;
begin
  -- A SUPPORT user, activated by the admin (guard blocks self-activation).
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (v_support, 'support@example.test', now(), '{"full_name":"Support Officer"}')
  on conflict (id) do nothing;
  insert into user_roles (profile_id, role) values (v_support, 'SUPPORT') on conflict do nothing;
  perform auth.login_as(v_admin);
  update profiles set account_status = 'ACTIVE' where id = v_support;
  perform auth.logout();

  -- SUPPORT may suspend an ACTIVE enrollment when a reason is given.
  perform auth.login_as(v_support);
  perform public.set_enrollment_status(v_e2, 'SUSPENDED', 'Outstanding fees for term 2');
  perform auth.logout();

  select status, status_reason into v_status, v_reason from enrollments where id = v_e2;
  perform assert(v_status = 'SUSPENDED', 'SUPPORT can suspend an enrollment');
  perform assert(v_reason = 'Outstanding fees for term 2', 'the learner-facing reason is recorded');

  select count(*) into n from audit_logs
   where resource_type = 'enrollment' and resource_id = v_e2
     and action in ('ENROLLMENT_STATUS_SET', 'ENROLLMENT_STATUS_CHANGED');
  perform assert(n >= 2, 'the status change is audited by both the RPC and the trigger');

  select count(*) into n from notifications
   where profile_id = '00000000-0000-0000-0000-00000000a002' and event_type = 'ENROLLMENT_SUSPENDED';
  perform assert(n >= 1, 'the learner is notified of the suspension');

  -- SUPPORT may reinstate; no reason required for ACTIVE.
  perform auth.login_as(v_support);
  perform public.set_enrollment_status(v_e2, 'ACTIVE', null);
  perform auth.logout();
  select status into v_status from enrollments where id = v_e2;
  perform assert(v_status = 'ACTIVE', 'SUPPORT can reinstate a suspended enrollment');

  -- A learner cannot call it at all.
  perform auth.login_as(v_learner);
  set local role authenticated;
  perform assert_raises(
    format($q$select public.set_enrollment_status(%L, 'SUSPENDED', 'let me out')$q$, v_e1),
    'a learner cannot change any enrollment status');
  reset role;
  perform auth.logout();

  -- Illegal transition and missing reason are rejected.
  perform auth.login_as(v_support);
  perform assert_raises(
    format($q$select public.set_enrollment_status(%L, 'PENDING', 'x')$q$, v_e1),
    'ACTIVE -> PENDING is rejected as an illegal transition');
  perform assert_raises(
    format($q$select public.set_enrollment_status(%L, 'SUSPENDED', NULL)$q$, v_e1),
    'suspending without a reason is rejected');
  perform auth.logout();

  -- e1 must be untouched by the rejected calls above.
  select status into v_status from enrollments where id = v_e1;
  perform assert(v_status = 'ACTIVE', 'a rejected transition leaves the enrollment unchanged');
end
$$;

\echo ''
\echo '== GROUP 13: finalize_submission_version — atomicity & ownership (migration 022 C) =='
do $$
declare
  v_learner uuid := '00000000-0000-0000-0000-00000000a001';
  v_other   uuid := '00000000-0000-0000-0000-00000000a002';
  v_e1      uuid := '00000000-0000-0000-0000-0000000000e1';
  v_attempt uuid;
  v_assess  uuid;
  v_prefix  text;
  v_res     jsonb;
  v_files   integer;
begin
  select id, assessment_id into v_attempt, v_assess
    from summative_attempts
   where enrollment_id = v_e1 and status = 'OPEN'
   order by created_at desc limit 1;
  perform assert(v_attempt is not null, 'fixture: an OPEN summative attempt from GROUP 8 is available');

  v_prefix := v_e1::text || '/' || v_assess::text || '/';

  perform auth.login_as(v_learner);
  set local role authenticated;

  -- Empty file set is refused before anything is written.
  perform assert_raises(
    format($q$select public.finalize_submission_version(%L, NULL, '[]'::jsonb)$q$, v_attempt),
    'an empty file set is refused');

  -- A path outside the attempt folder is refused.
  perform assert_raises(
    format(
      $q$select public.finalize_submission_version(%L, NULL,
            jsonb_build_array(jsonb_build_object(
              'storage_path','somewhere/else/x.pdf','file_name','x.pdf',
              'mime_type','application/pdf','file_size_bytes',10)))$q$,
      v_attempt),
    'a file written outside the attempt evidence folder is refused');

  -- Happy path: one transaction writes the version and the file row.
  v_res := public.finalize_submission_version(
    v_attempt, 'Portfolio draft',
    jsonb_build_array(
      jsonb_build_object('storage_path', v_prefix || 'stg/aaa-report.pdf',
                         'file_name','report.pdf','mime_type','application/pdf','file_size_bytes', 2048),
      jsonb_build_object('storage_path', v_prefix || 'stg/bbb-annexure.pdf',
                         'file_name','annexure.pdf','mime_type','application/pdf','file_size_bytes', 4096)));
  perform assert((v_res ->> 'file_count')::int = 2, 'both file rows are written');

  select count(*) into v_files
    from submission_files sf
    join submission_versions sv on sv.id = sf.version_id
    join submissions s on s.id = sv.submission_id
   where s.attempt_id = v_attempt;
  perform assert(v_files = 2, 'the version and its files are persisted together');

  reset role;
  perform auth.logout();

  -- Another learner cannot finalise this attempt.
  perform auth.login_as(v_other);
  set local role authenticated;
  perform assert_raises(
    format(
      $q$select public.finalize_submission_version(%L, NULL,
            jsonb_build_array(jsonb_build_object(
              'storage_path', %L, 'file_name','x.pdf','mime_type','application/pdf','file_size_bytes',10)))$q$,
      v_attempt, v_prefix || 'stg/ccc-x.pdf'),
    'a learner cannot upload evidence to another learner''s attempt');
  reset role;
  perform auth.logout();
end
$$;

\echo ''
\echo '== ALL WORKFLOW HARDENING TESTS PASSED =='
