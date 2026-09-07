-- ============================================================================
-- 003_courses.sql
--
-- A course is the qualification container. The demo hard-coded a single
-- qualification in curriculum.js; here it is data, so the institution can
-- run more than one programme without a code change.
-- ============================================================================

create table courses (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  title                 text not null,
  subtitle              text,
  description           text,
  summary               text,

  -- Accreditation metadata (SAQA 101869 / NQF 5 / 240 credits in the demo).
  qualification_body    text,
  qualification_id      text,
  nqf_level             integer,
  total_credits         integer,

  outcomes              text[] not null default '{}',
  requirements          text[] not null default '{}',
  target_audience       text,
  duration_months       integer,

  -- Completion policy
  pass_mark             numeric(5,2),          -- null → institution default
  require_all_modules   boolean not null default true,
  require_final_exam    boolean not null default true,
  issues_certificate    boolean not null default true,

  -- Commercial
  price                 numeric(12,2),
  price_includes_vat    boolean not null default true,

  hero_image_path       text,
  publication_status    publication_status not null default 'DRAFT',
  published_at          timestamptz,
  created_by            uuid references profiles(id) on delete set null,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint courses_title_not_blank  check (length(btrim(title)) > 0),
  constraint courses_code_not_blank   check (length(btrim(code)) > 0),
  constraint courses_pass_mark_range  check (pass_mark is null or (pass_mark >= 0 and pass_mark <= 100)),
  constraint courses_nqf_range        check (nqf_level is null or (nqf_level between 1 and 10)),
  constraint courses_credits_positive check (total_credits is null or total_credits > 0),
  constraint courses_price_positive   check (price is null or price >= 0),
  constraint courses_duration_positive check (duration_months is null or duration_months > 0),
  -- A published course must record when it was published.
  constraint courses_published_has_date
    check (publication_status <> 'PUBLISHED' or published_at is not null)
);

create index courses_publication_idx on courses (publication_status);
create index courses_code_idx        on courses (lower(code));

create trigger courses_set_updated_at
  before update on courses
  for each row execute function app.set_updated_at();

comment on column courses.total_credits is
  'Nominal credit total for the qualification. Actual earned credits are summed from module credits (audit C-06 avoided: completion is never gated on a hard-coded credit constant).';
