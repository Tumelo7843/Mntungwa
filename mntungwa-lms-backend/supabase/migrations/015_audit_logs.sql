-- ============================================================================
-- 015_audit_logs.sql
--
-- BR-012: all sensitive administrative actions must be auditable.
--
-- Append-only. No role holds UPDATE or DELETE (enforced in 019). Written
-- through app.create_audit_log(), which is SECURITY DEFINER so callers cannot
-- forge the actor.
-- ============================================================================

create table audit_logs (
  id             bigint generated always as identity primary key,

  actor_id       uuid references profiles(id) on delete set null,
  -- Retained even if the profile is later deleted, so the trail survives.
  actor_email    text,
  actor_roles    app_role[] not null default '{}',

  action         text not null,
  resource_type  text not null,
  resource_id    uuid,
  -- Human-readable label, e.g. "KM-01 Project Management Principles".
  resource_label text,

  -- Before/after for value changes such as a regrade.
  old_values     jsonb,
  new_values     jsonb,
  metadata       jsonb not null default '{}'::jsonb,

  ip_address     inet,
  user_agent     text,

  created_at     timestamptz not null default now(),

  constraint audit_action_not_blank   check (length(btrim(action)) > 0),
  constraint audit_resource_not_blank check (length(btrim(resource_type)) > 0)
);

create index audit_logs_created_idx  on audit_logs (created_at desc);
create index audit_logs_actor_idx    on audit_logs (actor_id, created_at desc);
create index audit_logs_action_idx   on audit_logs (action, created_at desc);
create index audit_logs_resource_idx on audit_logs (resource_type, resource_id);

comment on table audit_logs is
  'Append-only audit trail. No UPDATE or DELETE grant exists for any role including ADMIN (BR-012).';
comment on column audit_logs.metadata is
  'Must never contain POPIA-regulated personal information such as id_number (audit S-07, risk R-05).';

-- ----------------------------------------------------------------------------
-- contact_messages — the public contact form, made real (audit M-16)
-- ----------------------------------------------------------------------------
create table contact_messages (
  id           uuid primary key default gen_random_uuid(),

  name         text not null,
  email        citext not null,
  phone        text,
  subject      text,
  message      text not null,

  -- NEW → IN_PROGRESS → RESOLVED → SPAM
  status       text not null default 'NEW',
  assigned_to  uuid references profiles(id) on delete set null,
  handled_at   timestamptz,
  internal_note text,

  source_ip    inet,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint contact_name_not_blank    check (length(btrim(name)) > 0),
  constraint contact_message_not_blank check (length(btrim(message)) > 0),
  constraint contact_message_length    check (length(message) <= 5000),
  constraint contact_email_shape       check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint contact_status_valid      check (status in ('NEW','IN_PROGRESS','RESOLVED','SPAM'))
);

create index contact_messages_status_idx  on contact_messages (status, created_at desc);

create trigger contact_messages_set_updated_at
  before update on contact_messages
  for each row execute function app.set_updated_at();
