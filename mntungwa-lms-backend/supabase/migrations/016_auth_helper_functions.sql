-- ============================================================================
-- 016_auth_helper_functions.sql
--
-- Helpers used by every RLS policy in 019.
--
-- RECURSION (risk R-02). A policy on `profiles` that checks the caller's role
-- by selecting from `user_roles` would trigger `user_roles`' own policy, which
-- may in turn read `profiles`. These helpers are SECURITY DEFINER, so they
-- bypass RLS entirely and the cycle never forms. Every one of them pins
-- search_path, so a caller cannot shadow a table name to hijack the function.
--
-- All are STABLE, so PostgreSQL caches the result within a statement rather
-- than re-running the lookup once per row.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Identity
-- ----------------------------------------------------------------------------
create or replace function app.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid();
$$;

create or replace function app.is_authenticated()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null;
$$;

-- ----------------------------------------------------------------------------
-- Role checks
-- ----------------------------------------------------------------------------
create or replace function app.has_role(p_role app_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from user_roles
     where profile_id = auth.uid()
       and role = p_role
  );
$$;

create or replace function app.has_any_role(p_roles app_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from user_roles
     where profile_id = auth.uid()
       and role = any(p_roles)
  );
$$;

create or replace function app.my_roles()
returns app_role[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(role order by role), '{}')
    from user_roles where profile_id = auth.uid();
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.has_role('ADMIN');
$$;

-- Anyone who works for the institution. Deliberately excludes LEARNER.
create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.has_any_role(array['ADMIN','INSTRUCTOR','ASSESSOR','FINANCE','SUPPORT']::app_role[]);
$$;

-- Can author or modify academic content.
create or replace function app.is_academic()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.has_any_role(array['ADMIN','INSTRUCTOR']::app_role[]);
$$;

-- Can grade submissions (BR-007).
create or replace function app.is_assessor()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.has_any_role(array['ADMIN','ASSESSOR','INSTRUCTOR']::app_role[]);
$$;

create or replace function app.is_finance()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.has_any_role(array['ADMIN','FINANCE']::app_role[]);
$$;

-- ----------------------------------------------------------------------------
-- Ownership
-- ----------------------------------------------------------------------------
create or replace function app.owns_enrollment(p_enrollment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from enrollments
     where id = p_enrollment_id
       and profile_id = auth.uid()
  );
$$;

-- BR-001: an ACTIVE enrollment is required before restricted content opens.
create or replace function app.has_active_enrollment(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from enrollments
     where profile_id = auth.uid()
       and course_id  = p_course_id
       and status     = 'ACTIVE'
  );
$$;

create or replace function app.my_active_enrollment(p_course_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from enrollments
   where profile_id = auth.uid()
     and course_id  = p_course_id
     and status     = 'ACTIVE'
   limit 1;
$$;

-- ----------------------------------------------------------------------------
-- Content access
--
-- app.can_access_module(): the production replacement for the demo's
-- isUnlocked() (AppContext.jsx:26). Same semantics, but evaluated in the
-- database where the learner cannot reach it.
--
-- A learner may open a module when it is PUBLISHED, they hold an ACTIVE
-- enrollment on its course, and their module_progress row is not LOCKED.
-- Staff always have access.
-- ----------------------------------------------------------------------------
create or replace function app.can_access_module(p_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    app.is_staff()
    or exists (
      select 1
        from course_modules m
        join enrollments    e on e.course_id = m.course_id
        left join module_progress mp
               on mp.enrollment_id = e.id
              and mp.module_id     = m.id
       where m.id = p_module_id
         and m.publication_status = 'PUBLISHED'
         and e.profile_id = auth.uid()
         and e.status     = 'ACTIVE'
         and coalesce(mp.status, 'LOCKED') <> 'LOCKED'
    );
$$;

create or replace function app.can_access_lesson(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from lessons l
     where l.id = p_lesson_id
       and (app.is_staff() or (l.publication_status = 'PUBLISHED' and app.can_access_module(l.module_id)))
  );
$$;

-- Resource gating. Preserves the demo's "resources unlock with their module"
-- rule (audit §2.3) and extends it to lesson- and course-level resources.
create or replace function app.can_access_resource(p_resource_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from learning_resources r
      left join lessons l on l.id = r.lesson_id
     where r.id = p_resource_id
       and (
         app.is_staff()
         or (
           r.is_archived = false
           and (
             -- lesson-scoped
             (r.lesson_id is not null and app.can_access_module(l.module_id))
             -- module-scoped
             or (r.module_id is not null and app.can_access_module(r.module_id))
             -- course-scoped: any active enrollment on that course
             or (r.course_id is not null and app.has_active_enrollment(r.course_id))
           )
         )
       )
  );
$$;

-- Is this staff member the assigned assessor for a summative attempt?
create or replace function app.is_assigned_assessor(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from summative_attempts
     where id = p_attempt_id
       and (assigned_assessor_id = auth.uid() or app.is_admin())
  );
$$;

-- ----------------------------------------------------------------------------
-- Effective pass mark: assessment → module → course → institution default.
-- ----------------------------------------------------------------------------
create or replace function app.effective_pass_mark(
  p_assessment_mark numeric,
  p_module_id       uuid default null,
  p_course_id       uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    p_assessment_mark,
    (select pass_mark from course_modules where id = p_module_id),
    (select pass_mark from courses
      where id = coalesce(p_course_id, (select course_id from course_modules where id = p_module_id))),
    (select default_pass_mark from institution_settings limit 1),
    50.00
  );
$$;

-- ----------------------------------------------------------------------------
-- Audit writer. SECURITY DEFINER so the actor is taken from the session and
-- cannot be forged by the caller.
-- ----------------------------------------------------------------------------
create or replace function app.create_audit_log(
  p_action        text,
  p_resource_type text,
  p_resource_id   uuid    default null,
  p_resource_label text   default null,
  p_old_values    jsonb   default null,
  p_new_values    jsonb   default null,
  p_metadata      jsonb   default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     bigint;
  v_actor  uuid := auth.uid();
  v_email  text;
  v_roles  app_role[];
begin
  select email into v_email from profiles where id = v_actor;
  select coalesce(array_agg(role order by role), '{}') into v_roles
    from user_roles where profile_id = v_actor;

  insert into audit_logs (
    actor_id, actor_email, actor_roles,
    action, resource_type, resource_id, resource_label,
    old_values, new_values, metadata
  )
  values (
    v_actor, v_email, coalesce(v_roles, '{}'),
    p_action, p_resource_type, p_resource_id, p_resource_label,
    p_old_values, p_new_values, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Notification writer.
-- ----------------------------------------------------------------------------
create or replace function app.notify(
  p_profile_id    uuid,
  p_event_type    text,
  p_title         text,
  p_body          text default null,
  p_link_path     text default null,
  p_resource_type text default null,
  p_resource_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into notifications (profile_id, event_type, title, body, link_path, resource_type, resource_id)
  values (p_profile_id, p_event_type, p_title, p_body, p_link_path, p_resource_type, p_resource_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Execute grants. Helpers are readable by any signed-in user; they only ever
-- report on the caller's own session.
-- ----------------------------------------------------------------------------
grant execute on function
  app.current_profile_id(), app.is_authenticated(),
  app.has_role(app_role), app.has_any_role(app_role[]), app.my_roles(),
  app.is_admin(), app.is_staff(), app.is_academic(), app.is_assessor(), app.is_finance(),
  app.owns_enrollment(uuid), app.has_active_enrollment(uuid), app.my_active_enrollment(uuid),
  app.can_access_module(uuid), app.can_access_lesson(uuid), app.can_access_resource(uuid),
  app.is_assigned_assessor(uuid), app.effective_pass_mark(numeric, uuid, uuid)
to authenticated;

-- Audit and notification writers are for internal use by business functions
-- and staff tooling, not for direct learner invocation.
revoke execute on function app.create_audit_log(text, text, uuid, text, jsonb, jsonb, jsonb) from public;
revoke execute on function app.notify(uuid, text, text, text, text, text, uuid) from public;
grant  execute on function app.create_audit_log(text, text, uuid, text, jsonb, jsonb, jsonb) to authenticated;
