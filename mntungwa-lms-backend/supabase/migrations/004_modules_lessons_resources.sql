-- ============================================================================
-- 004_modules_lessons_resources.sql
--
-- COURSE → MODULE → LESSON → RESOURCE.
--
-- This migration resolves audit §7.1: in the demo a module *was* its
-- assessment and `TRACKS[x].assessType` decided whether it was a quiz or an
-- upload. Here a module owns lessons, and assessments attach independently
-- (007/008). `track` survives as descriptive metadata only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- course_modules
--
-- `sequence` replaces the demo's MODULE_INDEX array position.
-- `prerequisite_module_id` replaces the hard-coded "every prior module"
-- rule, which is now seeded as an explicit chain (audit D-02): behaviour is
-- identical, but the institution can branch tracks without a code change.
-- ----------------------------------------------------------------------------
create table course_modules (
  id                      uuid primary key default gen_random_uuid(),
  course_id               uuid not null references courses(id) on delete cascade,
  code                    text not null,
  title                   text not null,
  description             text,

  -- Descriptive only. KM / PM / WM in the seeded curriculum.
  track                   text,
  sequence                integer not null,
  credits                 integer not null default 0,
  outcomes                text[] not null default '{}',
  estimated_hours         integer,

  -- Progression
  prerequisite_module_id  uuid references course_modules(id) on delete set null,
  is_required             boolean not null default true,
  pass_mark               numeric(5,2),          -- null → course, then institution default

  -- Completion rules: what must be true for this module to become COMPLETED.
  require_all_lessons     boolean not null default true,
  require_formative       boolean not null default true,
  require_summative       boolean not null default true,

  publication_status      publication_status not null default 'DRAFT',
  published_at            timestamptz,
  created_by              uuid references profiles(id) on delete set null,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint modules_title_not_blank  check (length(btrim(title)) > 0),
  constraint modules_code_not_blank   check (length(btrim(code)) > 0),
  constraint modules_sequence_positive check (sequence > 0),
  constraint modules_credits_range    check (credits >= 0),
  constraint modules_pass_mark_range  check (pass_mark is null or (pass_mark >= 0 and pass_mark <= 100)),
  constraint modules_no_self_prereq   check (prerequisite_module_id is null or prerequisite_module_id <> id),
  constraint modules_published_has_date
    check (publication_status <> 'PUBLISHED' or published_at is not null),

  constraint modules_unique_code     unique (course_id, code),
  constraint modules_unique_sequence unique (course_id, sequence) deferrable initially deferred
);

create index modules_course_idx      on course_modules (course_id, sequence);
create index modules_prereq_idx      on course_modules (prerequisite_module_id);
create index modules_publication_idx on course_modules (publication_status);

create trigger course_modules_set_updated_at
  before update on course_modules
  for each row execute function app.set_updated_at();

comment on constraint modules_unique_sequence on course_modules is
  'Deferrable so an admin can reorder modules within one transaction without tripping the constraint mid-update.';

-- A prerequisite must belong to the same course, and must come earlier in the
-- sequence. Enforced by trigger because a CHECK cannot reference other rows.
create or replace function app.validate_module_prerequisite()
returns trigger
language plpgsql
as $$
declare
  v_prereq record;
begin
  if new.prerequisite_module_id is null then
    return new;
  end if;

  select course_id, sequence into v_prereq
    from course_modules where id = new.prerequisite_module_id;

  if not found then
    raise exception 'Prerequisite module % does not exist', new.prerequisite_module_id;
  end if;

  if v_prereq.course_id <> new.course_id then
    raise exception 'Prerequisite module must belong to the same course';
  end if;

  if v_prereq.sequence >= new.sequence then
    raise exception 'Prerequisite (sequence %) must precede this module (sequence %)',
      v_prereq.sequence, new.sequence;
  end if;

  return new;
end;
$$;

create constraint trigger course_modules_validate_prerequisite
  after insert or update of prerequisite_module_id, sequence, course_id on course_modules
  deferrable initially deferred
  for each row execute function app.validate_module_prerequisite();

-- ----------------------------------------------------------------------------
-- lessons
--
-- New in production. The demo had no lesson entity at all: a module linked
-- straight to a quiz or an upload box.
-- ----------------------------------------------------------------------------
create table lessons (
  id                 uuid primary key default gen_random_uuid(),
  module_id          uuid not null references course_modules(id) on delete cascade,
  title              text not null,
  summary            text,

  -- Markdown body. This is a document-based LMS (audit §8.2): the substance
  -- of a lesson is its attached documents, with body text as framing.
  body               text,
  sequence           integer not null,
  estimated_minutes  integer,
  is_required        boolean not null default true,

  publication_status publication_status not null default 'DRAFT',
  published_at       timestamptz,
  created_by         uuid references profiles(id) on delete set null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint lessons_title_not_blank   check (length(btrim(title)) > 0),
  constraint lessons_sequence_positive check (sequence > 0),
  constraint lessons_minutes_positive  check (estimated_minutes is null or estimated_minutes > 0),
  constraint lessons_published_has_date
    check (publication_status <> 'PUBLISHED' or published_at is not null),
  constraint lessons_unique_sequence unique (module_id, sequence) deferrable initially deferred
);

create index lessons_module_idx on lessons (module_id, sequence);

create trigger lessons_set_updated_at
  before update on lessons
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- learning_resources
--
-- Replaces the demo's fake uploads (audit M-11): the file lives in Supabase
-- Storage, this table holds the metadata, and RLS on both sides decides who
-- may read it.
--
-- A resource attaches to exactly one of lesson / module / course. Course-level
-- resources are the general library (the demo's "QCTO Curriculum Document").
-- ----------------------------------------------------------------------------
create table learning_resources (
  id                uuid primary key default gen_random_uuid(),

  lesson_id         uuid references lessons(id)        on delete cascade,
  module_id         uuid references course_modules(id) on delete cascade,
  course_id         uuid references courses(id)        on delete cascade,

  title             text not null,
  description       text,
  category          text,

  -- Storage
  storage_bucket    text not null default 'learning-resources',
  storage_path      text not null,
  file_name         text not null,
  mime_type         text not null,
  file_size_bytes   bigint not null,
  checksum          text,

  -- Versioning (brief: "Support document versions where appropriate")
  version           integer not null default 1,
  replaces_id       uuid references learning_resources(id) on delete set null,
  is_archived       boolean not null default false,
  archived_at       timestamptz,
  archived_by       uuid references profiles(id) on delete set null,

  sequence          integer not null default 1,
  is_downloadable   boolean not null default true,
  uploaded_by       uuid references profiles(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint resources_title_not_blank check (length(btrim(title)) > 0),
  constraint resources_path_not_blank  check (length(btrim(storage_path)) > 0),
  constraint resources_size_positive   check (file_size_bytes > 0),
  constraint resources_version_positive check (version > 0),
  constraint resources_no_self_replace check (replaces_id is null or replaces_id <> id),
  constraint resources_archived_consistent
    check ((is_archived = false and archived_at is null) or (is_archived = true and archived_at is not null)),

  -- Exactly one owner.
  constraint resources_single_owner check (
    (lesson_id is not null)::int + (module_id is not null)::int + (course_id is not null)::int = 1
  ),

  -- Video is deliberately excluded: this is a document-based LMS (audit §8.2).
  constraint resources_mime_not_video check (mime_type not like 'video/%'),

  constraint resources_unique_path unique (storage_bucket, storage_path)
);

create index resources_lesson_idx  on learning_resources (lesson_id)  where lesson_id is not null;
create index resources_module_idx  on learning_resources (module_id)  where module_id is not null;
create index resources_course_idx  on learning_resources (course_id)  where course_id is not null;
create index resources_active_idx  on learning_resources (is_archived) where is_archived = false;

create trigger learning_resources_set_updated_at
  before update on learning_resources
  for each row execute function app.set_updated_at();

comment on table learning_resources is
  'Document metadata. File bytes live in Supabase Storage — never in PostgreSQL.';
comment on constraint resources_mime_not_video on learning_resources is
  'Document-based LMS: video is not a core feature (audit §8.2).';
