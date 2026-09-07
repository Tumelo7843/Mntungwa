-- ============================================================================
-- 021_fix_profile_guard_system_context.sql
--
-- Fixes a latent bug in app.guard_profile_self_update() (migration 018).
--
-- THE BUG
-- The guard blocks any profiles.account_status / email change unless
-- app.is_admin() is true. But two legitimate SERVER-SIDE paths change
-- account_status without an admin JWT in scope:
--
--   1. app.handle_user_confirmed()  — the AFTER UPDATE trigger on
--      auth.users that promotes PENDING_VERIFICATION -> PENDING_PAYMENT when
--      Supabase Auth sets email_confirmed_at. GoTrue runs this with no
--      request JWT, so app.is_admin() is false and the guard RAISES —
--      which aborts GoTrue's UPDATE, so email_confirmed_at is never stored
--      and EVERY email confirmation silently fails. The learner is then
--      stuck: signInWithPassword() returns "400 email_not_confirmed".
--
--   2. app.review_payment() (migration 017) — a FINANCE user approving a
--      payment promotes PENDING_PAYMENT -> ACTIVE. Finance is not admin, so
--      the guard RAISES there too; approval only worked when done by an ADMIN.
--
-- The test suite never exercised path 1: its fixtures insert auth.users with
-- email_confirmed_at already set, so on_auth_user_confirmed never fires.
--
-- THE FIX
-- Distinguish a direct end-user table write from a trusted server-side one by
-- the effective role. A signed-in user's PostgREST write always runs as
-- `authenticated`; a SECURITY DEFINER business function (owned by `postgres`)
-- runs as `postgres`. The guard only needs to police the former — that is the
-- self-service privilege-escalation surface (audit S-05 / M-07).
--
-- The function therefore becomes SECURITY INVOKER (so it can see the caller's
-- role) and short-circuits for any role other than `authenticated`. The
-- self-activation protection is unchanged: a learner calling
-- `update profiles set account_status = 'ACTIVE'` through the anon key still
-- runs as `authenticated`, is still not an admin, and is still rejected.
-- ============================================================================

create or replace function app.guard_profile_self_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Trusted server-side context: a SECURITY DEFINER business function
  -- (handle_user_confirmed, review_payment, admin RPCs) or a migration. Never
  -- a direct request from a browser holding the anon key — PostgREST runs
  -- those as `authenticated`.
  if current_user <> 'authenticated' then
    return new;
  end if;

  -- An administrator editing a profile through the admin app.
  if app.is_admin() then
    return new;
  end if;

  -- Everything below is a non-admin user writing to a profile row directly.
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

comment on function app.guard_profile_self_update() is
  'Blocks a signed-in (authenticated) non-admin from changing their own account_status or email through a direct profiles UPDATE. Server-side SECURITY DEFINER paths (email-confirmation promotion, payment approval) are trusted and pass through.';
