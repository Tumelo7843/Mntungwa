-- ============================================================================
-- 012_certificates.sql
--
-- A certificate becomes a ROW, not a computed boolean (audit §7.7).
--
-- The demo derived `certificateUnlocked` in the browser and minted a serial
-- from four characters of a random user id (audit M-14) with no record and no
-- verification endpoint (M-15). Here:
--
--   * certificate_number is unique and collision-checked by the database
--   * verification_token is a separate high-entropy secret for public lookup
--   * results_snapshot records what justified issuance
--   * issuance happens only inside issue_certificate() (migration 017)
--   * verify_certificate() returns minimal data — no ID number, no email
--
-- BR-009: learners cannot issue certificates.
-- BR-010: certificates are only issued after all mandatory requirements pass.
-- ============================================================================

create table certificates (
  id                  uuid primary key default gen_random_uuid(),

  certificate_number  text not null unique,
  -- Public lookup secret. Separate from the human-readable number so the
  -- number can be printed without making enumeration trivial.
  verification_token  text not null unique default encode(gen_random_bytes(24), 'hex'),

  enrollment_id       uuid not null references enrollments(id) on delete restrict,
  profile_id          uuid not null references profiles(id)    on delete restrict,
  course_id           uuid not null references courses(id)     on delete restrict,

  -- Denormalised on purpose: a certificate must remain readable and accurate
  -- even if the course is renamed or the learner changes their display name.
  learner_name        text not null,
  course_title        text not null,
  qualification_id    text,
  nqf_level           integer,
  credits_awarded     integer,

  status              certificate_status not null default 'ISSUED',

  issued_at           timestamptz not null default now(),
  issued_by           uuid references profiles(id) on delete set null,
  completion_date     date,

  -- Evidence trail: module results, final exam score, checks that passed.
  results_snapshot    jsonb not null default '{}'::jsonb,
  final_score         numeric(5,2),

  -- Generated PDF in the private `certificates` bucket.
  storage_bucket      text default 'certificates',
  storage_path        text,
  generated_at        timestamptz,

  -- Revocation
  revoked_at          timestamptz,
  revoked_by          uuid references profiles(id) on delete set null,
  revocation_reason   text,
  replaced_by_id      uuid references certificates(id) on delete set null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint certificates_number_not_blank check (length(btrim(certificate_number)) > 0),
  constraint certificates_learner_not_blank check (length(btrim(learner_name)) > 0),
  constraint certificates_score_range check (final_score is null or (final_score >= 0 and final_score <= 100)),
  constraint certificates_credits_sane check (credits_awarded is null or credits_awarded >= 0),
  constraint certificates_revoked_consistent check (
    (status <> 'REVOKED') or (revoked_at is not null and revocation_reason is not null)
  ),
  constraint certificates_replaced_consistent check (
    (status <> 'REPLACED') or (replaced_by_id is not null)
  ),
  constraint certificates_no_self_replace check (replaced_by_id is null or replaced_by_id <> id),
  -- One live certificate per enrollment. Revoked/replaced ones remain for the
  -- audit trail, so the uniqueness is partial rather than absolute.
  constraint certificates_one_live_per_enrollment
    exclude (enrollment_id with =) where (status = 'ISSUED')
);

create index certificates_profile_idx    on certificates (profile_id);
create index certificates_enrollment_idx on certificates (enrollment_id);
create index certificates_status_idx     on certificates (status);
create index certificates_number_idx     on certificates (upper(certificate_number));

create trigger certificates_set_updated_at
  before update on certificates
  for each row execute function app.set_updated_at();

comment on table certificates is
  'Issued certificate records. Issuance is only possible through issue_certificate(), which re-runs every eligibility check inside the same transaction (risk R-06).';
comment on column certificates.verification_token is
  'High-entropy public lookup key. The printed certificate_number is deliberately not sufficient on its own to enumerate records.';
comment on constraint certificates_one_live_per_enrollment on certificates is
  'At most one ISSUED certificate per enrollment; revoked and replaced records are retained.';

-- ----------------------------------------------------------------------------
-- certificate_sequences
--
-- Per-year counter backing certificate numbering, e.g. MIS-101869-2026-00017.
-- A dedicated table (rather than a sequence object) keeps the counter
-- transactional and lets an admin see exactly how many were issued per year.
-- ----------------------------------------------------------------------------
create table certificate_sequences (
  year        integer primary key,
  last_number integer not null default 0,

  constraint certificate_sequences_year_sane check (year between 2000 and 2200),
  constraint certificate_sequences_number_sane check (last_number >= 0)
);

comment on table certificate_sequences is
  'Transactional per-year counter. Replaces the demo''s collision-prone serial derived from four characters of a random user id (audit M-14, S-13).';
