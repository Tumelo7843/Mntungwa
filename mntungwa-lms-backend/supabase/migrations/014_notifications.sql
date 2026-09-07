-- ============================================================================
-- 014_notifications.sql
--
-- In-app notifications, with email support architected but not wired.
-- Rows are written by business functions (enrollment approved, assessment
-- graded, certificate issued...). Learners may only mark their own read.
-- ============================================================================

create table notifications (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references profiles(id) on delete cascade,

  -- Machine-readable type, e.g. ASSESSMENT_GRADED, CERTIFICATE_ISSUED.
  event_type     text not null,
  title          text not null,
  body           text,
  -- Deep link into the app, e.g. /app/results/{id}.
  link_path      text,

  -- Optional pointer to the subject row.
  resource_type  text,
  resource_id    uuid,

  channel        notification_channel not null default 'IN_APP',
  is_read        boolean not null default false,
  read_at        timestamptz,

  -- Email dispatch state. Populated by the Edge Function when configured;
  -- null everywhere until then, which is honest rather than fake.
  email_queued_at timestamptz,
  email_sent_at   timestamptz,
  email_error     text,

  created_at     timestamptz not null default now(),

  constraint notifications_title_not_blank check (length(btrim(title)) > 0),
  constraint notifications_type_not_blank  check (length(btrim(event_type)) > 0),
  constraint notifications_read_consistent check (
    (is_read = false and read_at is null) or (is_read = true and read_at is not null)
  )
);

create index notifications_profile_idx on notifications (profile_id, created_at desc);
create index notifications_unread_idx  on notifications (profile_id) where is_read = false;

comment on index notifications_unread_idx is 'Backs the unread badge count.';

-- ----------------------------------------------------------------------------
-- announcements — institution-wide or course/cohort scoped
-- ----------------------------------------------------------------------------
create table announcements (
  id             uuid primary key default gen_random_uuid(),

  title          text not null,
  body           text not null,

  -- Null scope = whole institution.
  course_id      uuid references courses(id) on delete cascade,
  cohort_id      uuid references cohorts(id) on delete cascade,
  -- Null audience = everyone; otherwise restrict to these roles.
  audience_roles app_role[] not null default '{}',

  is_pinned      boolean not null default false,
  publish_at     timestamptz not null default now(),
  expires_at     timestamptz,

  publication_status publication_status not null default 'DRAFT',
  created_by     uuid references profiles(id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint announcements_title_not_blank check (length(btrim(title)) > 0),
  constraint announcements_body_not_blank  check (length(btrim(body)) > 0),
  constraint announcements_window_order    check (expires_at is null or expires_at > publish_at)
);

create index announcements_live_idx   on announcements (publish_at desc)
  where publication_status = 'PUBLISHED';
create index announcements_course_idx on announcements (course_id) where course_id is not null;
create index announcements_cohort_idx on announcements (cohort_id) where cohort_id is not null;

create trigger announcements_set_updated_at
  before update on announcements
  for each row execute function app.set_updated_at();
