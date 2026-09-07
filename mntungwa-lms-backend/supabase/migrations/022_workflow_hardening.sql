-- ============================================================================
-- 022_workflow_hardening.sql
--
-- Four workflow-reliability fixes that need a database change:
--
--   A. Transactional audit safety-net.
--      The admin app writes audit entries as a best-effort second statement
--      after a mutation (services/admin.ts writeAudit). If that call is
--      skipped or fails, the mutation still persisted with no auditable
--      record — contrary to BR-012. This adds AFTER triggers on the three
--      highest-value staff mutations (role grant/revoke, account-status
--      change, enrollment-status change) so an audit row is written in the
--      SAME transaction as the change and cannot be lost.
--
--   B. Enrollment status transitions for SUPPORT, with a recorded reason.
--      enrollments_admin_write (migration 018) is ADMIN-only, so a SUPPORT
--      user's status change is silently filtered to zero rows. The brief
--      requires support to "manage appropriate learner/enrollment tasks" and
--      requires status changes to carry a reason the learner can act on.
--      set_enrollment_status() adds a narrow, audited, notifying RPC for
--      ADMIN *or* SUPPORT without widening the table policy.
--
--   C. Atomic multi-file evidence upload.
--      services/lms.ts uploadSubmissionFiles() created a submission_versions
--      row, then uploaded files one by one, then inserted submission_files
--      rows. A failure part-way left an orphaned version row (which is
--      immutable and cannot be cleaned up) plus partial metadata and Storage
--      objects. finalize_submission_version() takes the whole file set and
--      writes the version + every file row in one transaction, so a failure
--      writes nothing. The client uploads to a staging path first and, on any
--      failure, removes its own orphaned objects via a narrow new Storage
--      policy.
--
--   D. Narrow Storage cleanup policy for the above.
--
-- No existing constraint is weakened. submission_versions remains
-- append-only; no table gains an UPDATE/DELETE grant.
-- ============================================================================

-- ============================================================================
-- A. TRANSACTIONAL AUDIT SAFETY-NET
-- ============================================================================

-- ---- user_roles: every grant and revoke ------------------------------------
create or replace function app.audit_user_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform app.create_audit_log(
      'ROLE_GRANTED', 'user_role', new.profile_id, null,
      null, jsonb_build_object('role', new.role), '{}'::jsonb);
    return new;
  else
    perform app.create_audit_log(
      'ROLE_REVOKED', 'user_role', old.profile_id, null,
      jsonb_build_object('role', old.role), null, '{}'::jsonb);
    return old;
  end if;
end;
$$;

drop trigger if exists user_roles_audit on user_roles;
create trigger user_roles_audit
  after insert or delete on user_roles
  for each row execute function app.audit_user_role_change();

comment on function app.audit_user_role_change() is
  'BR-012: guarantees an audit row for every role grant/revoke in the same transaction, independent of the client.';

-- ---- profiles.account_status --------------------------------------------------
create or replace function app.audit_profile_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.account_status is distinct from old.account_status then
    perform app.create_audit_log(
      'ACCOUNT_STATUS_CHANGED', 'profile', new.id, new.full_name,
      jsonb_build_object('account_status', old.account_status),
      jsonb_build_object('account_status', new.account_status), '{}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_status_audit on profiles;
create trigger profiles_status_audit
  after update of account_status on profiles
  for each row execute function app.audit_profile_status_change();

-- (enrollments.status is audited in section B, after status_reason exists.)

-- ============================================================================
-- B. ENROLLMENT STATUS TRANSITIONS (ADMIN or SUPPORT), WITH A REASON
-- ============================================================================

alter table enrollments
  add column if not exists status_reason     text,
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid references profiles(id) on delete set null;

comment on column enrollments.status_reason is
  'Human-readable reason for the current status, shown to the learner. Required for SUSPENDED/WITHDRAWN/EXPIRED. Set by set_enrollment_status().';

create or replace function app.audit_enrollment_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    perform app.create_audit_log(
      'ENROLLMENT_STATUS_CHANGED', 'enrollment', new.id, null,
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status, 'reason', new.status_reason), '{}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists enrollments_status_audit on enrollments;
create trigger enrollments_status_audit
  after update of status on enrollments
  for each row execute function app.audit_enrollment_status_change();

create or replace function public.set_enrollment_status(
  p_enrollment_id uuid,
  p_status        text,
  p_reason        text default null
)
returns enrollment_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e        enrollments%rowtype;
  v_actor  uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_status enrollment_status;
begin
  if not (app.is_admin() or app.has_role('SUPPORT')) then
    raise exception 'Only an administrator or support staff may change an enrollment status'
      using errcode = '42501';
  end if;

  begin
    v_status := upper(btrim(p_status))::enrollment_status;
  exception when invalid_text_representation then
    raise exception 'Unknown enrollment status "%"', p_status using errcode = '22P02';
  end;

  select * into e from enrollments where id = p_enrollment_id for update;
  if not found then
    raise exception 'Enrollment not found' using errcode = 'P0002';
  end if;

  if v_status = e.status then
    return e.status;  -- idempotent no-op
  end if;

  -- COMPLETED is owned by the progression engine, never set by hand.
  if v_status = 'COMPLETED' or e.status = 'COMPLETED' then
    raise exception 'Completion status is managed by the system' using errcode = '42501';
  end if;

  -- Allowed transitions.
  if e.status in ('WITHDRAWN', 'EXPIRED') then
    raise exception 'A % enrollment is final. Create a new enrollment instead.',
      lower(e.status::text) using errcode = '42501';
  elsif e.status = 'PENDING'   and v_status not in ('ACTIVE', 'WITHDRAWN') then
    raise exception 'A pending enrollment can only be activated or withdrawn' using errcode = '42501';
  elsif e.status = 'ACTIVE'    and v_status not in ('SUSPENDED', 'WITHDRAWN', 'EXPIRED') then
    raise exception 'An active enrollment can only be suspended, withdrawn or expired' using errcode = '42501';
  elsif e.status = 'SUSPENDED' and v_status not in ('ACTIVE', 'WITHDRAWN', 'EXPIRED') then
    raise exception 'A suspended enrollment can only be reinstated, withdrawn or expired' using errcode = '42501';
  end if;

  if v_status in ('SUSPENDED', 'WITHDRAWN', 'EXPIRED') and v_reason is null then
    raise exception 'A reason is required when suspending, withdrawing or expiring an enrollment'
      using errcode = '23514';
  end if;

  update enrollments
     set status            = v_status,
         status_reason     = v_reason,
         status_changed_at = now(),
         status_changed_by = v_actor,
         withdrawal_reason = case when v_status = 'WITHDRAWN' then v_reason else withdrawal_reason end,
         activated_at      = case when v_status = 'ACTIVE' then coalesce(activated_at, now()) else activated_at end
   where id = p_enrollment_id;

  -- Reactivation: make sure the first module is open again.
  if v_status = 'ACTIVE' then
    perform app.refresh_module_unlocks(p_enrollment_id);
    perform app.recalculate_enrollment_progress(p_enrollment_id);
  end if;

  -- Explicit audit in addition to the AFTER trigger, so the reason and actor
  -- intent are captured on one row.
  perform app.create_audit_log(
    'ENROLLMENT_STATUS_SET', 'enrollment', p_enrollment_id, null,
    jsonb_build_object('status', e.status),
    jsonb_build_object('status', v_status, 'reason', v_reason));

  perform app.notify(
    e.profile_id,
    'ENROLLMENT_' || v_status::text,
    case v_status
      when 'ACTIVE'    then 'Your enrollment is now active'
      when 'SUSPENDED' then 'Your enrollment has been suspended'
      when 'WITHDRAWN' then 'Your enrollment has been withdrawn'
      when 'EXPIRED'   then 'Your enrollment has expired'
      else 'Your enrollment status has changed'
    end,
    coalesce(v_reason, 'Contact the institution if you have any questions.'),
    '/app/profile', 'enrollment', p_enrollment_id);

  return v_status;
end;
$$;

comment on function public.set_enrollment_status(uuid, text, text) is
  'ADMIN or SUPPORT only. Validates the transition, records a learner-facing reason, audits and notifies. Does not widen enrollments_admin_write.';

grant execute on function public.set_enrollment_status(uuid, text, text) to authenticated;

-- ============================================================================
-- C. ATOMIC MULTI-FILE EVIDENCE UPLOAD
-- ============================================================================

create or replace function public.finalize_submission_version(
  p_attempt_id uuid,
  p_note       text,
  p_files      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  at           summative_attempts%rowtype;
  sub          submissions%rowtype;
  v_prefix     text;
  v_next       integer;
  v_version_id uuid;
  v_count      integer;
  f            jsonb;
begin
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'At least one uploaded file is required' using errcode = '23514';
  end if;

  select * into at from summative_attempts where id = p_attempt_id for update;
  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;
  if not app.owns_enrollment(at.enrollment_id) then
    raise exception 'Not your attempt' using errcode = '42501';
  end if;
  if at.status not in ('DRAFT', 'OPEN', 'RESUBMISSION_REQUIRED') then
    raise exception 'Evidence cannot be added once the attempt is %', at.status using errcode = '42501';
  end if;

  select * into sub from submissions where attempt_id = p_attempt_id for update;
  if not found then
    raise exception 'Submission record is missing. Reopen the assessment.' using errcode = 'P0002';
  end if;
  if sub.status not in ('DRAFT', 'RESUBMISSION_REQUIRED') then
    raise exception 'This submission is locked (status %)', sub.status using errcode = '42501';
  end if;

  -- Storage path convention (docs/STORAGE.md): the first two segments are the
  -- ownership anchor and the assessment. Reject anything written elsewhere.
  v_prefix := at.enrollment_id::text || '/' || at.assessment_id::text || '/';

  for f in select * from jsonb_array_elements(p_files)
  loop
    if coalesce(btrim(f ->> 'storage_path'), '') = '' then
      raise exception 'A file is missing its storage path' using errcode = '23514';
    end if;
    if left(f ->> 'storage_path', length(v_prefix)) <> v_prefix then
      raise exception 'File "%" is outside this attempt''s evidence folder',
        coalesce(f ->> 'file_name', '?') using errcode = '42501';
    end if;
    if coalesce((f ->> 'file_size_bytes')::bigint, 0) <= 0 then
      raise exception 'File "%" has no content', coalesce(f ->> 'file_name', '?') using errcode = '23514';
    end if;
  end loop;

  select coalesce(max(version_number), 0) + 1 into v_next
    from submission_versions where submission_id = sub.id;

  insert into submission_versions (submission_id, version_number, note, submitted_by)
  values (sub.id, v_next, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_version_id;

  insert into submission_files (version_id, storage_bucket, storage_path, file_name, mime_type, file_size_bytes)
  select v_version_id,
         'learner-submissions',
         f ->> 'storage_path',
         coalesce(nullif(btrim(f ->> 'file_name'), ''), 'evidence'),
         coalesce(nullif(f ->> 'mime_type', ''), 'application/octet-stream'),
         (f ->> 'file_size_bytes')::bigint
    from jsonb_array_elements(p_files) f;
  get diagnostics v_count = ROW_COUNT;

  perform app.create_audit_log(
    'SUBMISSION_EVIDENCE_UPLOADED', 'summative_attempt', p_attempt_id, null,
    null, jsonb_build_object('version', v_next, 'files', v_count));

  return jsonb_build_object('version_id', v_version_id, 'version_number', v_next, 'file_count', v_count);
end;
$$;

comment on function public.finalize_submission_version(uuid, text, jsonb) is
  'Writes a submission version and all of its file rows in one transaction. A partial failure writes nothing, so no orphaned version/metadata rows can be left behind.';

grant execute on function public.finalize_submission_version(uuid, text, jsonb) to authenticated;

-- ============================================================================
-- D. NARROW STORAGE CLEANUP POLICY
--
-- A learner may delete an object in their OWN enrollment folder only while no
-- submission_files row references it — i.e. an object left behind by a failed
-- upload, never attached evidence. Once finalize_submission_version() records
-- the file, this policy no longer matches it.
-- ============================================================================
drop policy if exists learner_submissions_delete_orphan on storage.objects;
create policy learner_submissions_delete_orphan on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'learner-submissions'
    and app.owns_enrollment((storage.foldername(name))[1]::uuid)
    and not exists (
      select 1 from submission_files sf
       where sf.storage_bucket = 'learner-submissions'
         and sf.storage_path   = storage.objects.name
    )
  );

comment on policy learner_submissions_delete_orphan on storage.objects is
  'Failed-upload cleanup only: the learner''s own enrollment folder, and only objects not referenced by any submission_files row. Attached evidence stays immutable (admin-delete only).';
