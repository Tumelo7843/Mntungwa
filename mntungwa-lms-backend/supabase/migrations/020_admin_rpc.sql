-- ============================================================================
-- 020_admin_rpc.sql
--
-- PostgREST only exposes functions in the `public` schema. The helpers in
-- `app` are deliberately not reachable from the API, so the admin panel needs
-- thin public wrappers for the three operations it legitimately performs.
--
-- Each wrapper re-checks the caller's role. A wrapper that simply forwarded to
-- an `app.*` helper without a role check would be a privilege-escalation hole,
-- because `app.*` functions are SECURITY DEFINER and bypass RLS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Audit entry for CRUD performed through plain table writes.
--
-- The actor is taken from the session inside app.create_audit_log(), so a
-- caller cannot attribute an action to somebody else. Staff-only: a learner
-- must not be able to write arbitrary rows into the audit trail, which would
-- let them bury a real entry under noise.
-- ----------------------------------------------------------------------------
create or replace function public.create_audit_log_public(
  p_action         text,
  p_resource_type  text,
  p_resource_id    uuid  default null,
  p_resource_label text  default null,
  p_old_values     jsonb default null,
  p_new_values     jsonb default null,
  p_metadata       jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.is_staff() then
    raise exception 'Only institution staff may write audit entries' using errcode = '42501';
  end if;

  return app.create_audit_log(
    p_action, p_resource_type, p_resource_id, p_resource_label,
    p_old_values, p_new_values, coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Open a learner's first module for an enrolment activated by hand
-- (bursary, employer-funded, migrated learner). The payment path calls
-- app.refresh_module_unlocks() automatically; this covers the rest.
-- ----------------------------------------------------------------------------
create or replace function public.refresh_module_unlocks_admin(p_enrollment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_unlocked integer;
begin
  if not app.is_admin() then
    raise exception 'Only an administrator may refresh module unlocks' using errcode = '42501';
  end if;

  v_unlocked := app.refresh_module_unlocks(p_enrollment_id);
  perform app.recalculate_enrollment_progress(p_enrollment_id);

  perform app.create_audit_log(
    'ENROLLMENT_UNLOCKS_REFRESHED', 'enrollment', p_enrollment_id, null,
    null, jsonb_build_object('modules_unlocked', v_unlocked)
  );

  return v_unlocked;
end;
$$;

-- ----------------------------------------------------------------------------
-- Next invoice number from the transactional per-year counter.
-- Finance-only: the counter must not be advanced by anyone else, or the
-- sequence develops gaps that look like deleted invoices during an audit.
-- ----------------------------------------------------------------------------
create or replace function public.next_invoice_number_admin()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.is_finance() then
    raise exception 'Only finance may raise invoices' using errcode = '42501';
  end if;
  return app.next_invoice_number();
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants. The role checks live in the function bodies above, so granting to
-- `authenticated` is safe: a learner calling these gets a 42501.
-- ----------------------------------------------------------------------------
grant execute on function
  public.create_audit_log_public(text, text, uuid, text, jsonb, jsonb, jsonb),
  public.refresh_module_unlocks_admin(uuid),
  public.next_invoice_number_admin()
to authenticated;
