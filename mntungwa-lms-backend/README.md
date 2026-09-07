# Mntungwa LMS — Backend (Supabase / PostgreSQL)

The database, security model and business logic for the Mntungwa LMS. This is
one of three projects:

| Project | Role |
|---|---|
| `mntungwa-lms-backend` | **This repo.** PostgreSQL schema, RLS, business logic, Storage |
| `mntungwa-lms-frontend` | Learner-facing React app → Vercel |
| `mntungwa-lms-admin` | Institution admin React app → Vercel |

**Model A: single institution.** There is no tenant model, no SaaS billing and
no white-label layer. See `docs/DATABASE_ARCHITECTURE.md`.

---

## The one-line summary

The database is the source of truth. React is not.

Scores, pass/fail decisions, module unlocks, exam eligibility and certificate
issuance are all computed inside PostgreSQL by `SECURITY DEFINER` functions and
protected by Row Level Security. The client submits **answers and intent** — it
never submits a result.

---

## Status

| | |
|---|---|
| Migrations | 19, all verified against PostgreSQL 16 |
| Tables | 47, every one with RLS enabled **and forced** |
| RLS policies | 139 |
| Business functions | 24 |
| Security/progression tests | 46 assertions, all passing |
| Edge Functions | Not yet implemented — see Known gaps |

Verified by running `supabase/run_migrations.sh --seed --test`.

---

## Layout

```
supabase/
├── migrations/
│   ├── 001_extensions_and_institution.sql   extensions, enums, institution
│   ├── 002_roles_and_profiles.sql           identity, roles, cohorts
│   ├── 003_courses.sql
│   ├── 004_modules_lessons_resources.sql    COURSE→MODULE→LESSON→RESOURCE
│   ├── 005_enrollments.sql                  the RLS ownership anchor
│   ├── 006_progress.sql
│   ├── 007_formative_assessments.sql        auto-graded, answer keys protected
│   ├── 008_summative_assessments.sql        assessor-graded
│   ├── 009_submissions.sql                  real uploads, versioned
│   ├── 010_gradebook.sql                    rubrics, grades, feedback
│   ├── 011_final_exams.sql                  the new high-stakes gate
│   ├── 012_certificates.sql                 issued records + verification
│   ├── 013_payments.sql                     invoice→proof→review→approve
│   ├── 014_notifications.sql
│   ├── 015_audit_logs.sql                   append-only
│   ├── 016_auth_helper_functions.sql        RLS helpers (non-recursive)
│   ├── 017_business_functions.sql           ★ the authoritative layer
│   ├── 018_rls_policies.sql                 ★ the authorisation layer
│   └── 019_storage.sql                      buckets + storage policies
├── seed.sql                                 28-module QCTO curriculum
├── tests/
│   ├── 00_local_shim.sql                    LOCAL ONLY — fakes Supabase auth
│   └── 10_security_and_progression_tests.sql
├── functions/                               Edge Functions (see gaps)
└── run_migrations.sh                        local verification runner
docs/                                        architecture, RLS, storage, setup
```

Migrations are numbered and must run **in order**. `016` must precede `018`
because policies call the helpers it defines.

---

## Quick start (hosted Supabase)

Full walkthrough in `docs/SUPABASE_SETUP.md`. Short version:

```bash
npm install -g supabase
supabase link --project-ref <your-project-ref>
supabase db push          # applies migrations/ in order
psql "$DATABASE_URL" -f supabase/seed.sql
```

Then create the first administrator (see `SUPABASE_SETUP.md` step 13) — no
credentials ship in this repo.

## Local verification (no Supabase account needed)

`run_migrations.sh` rebuilds a throwaway database, applies every migration,
seeds it and runs the test suite:

```bash
./supabase/run_migrations.sh --seed --test
```

This works against a plain PostgreSQL 16 instance because
`tests/00_local_shim.sql` stands in for the `auth` and `storage` schemas that
Supabase normally provides. **Never run the shim against a real project.**

---

## What the tests actually prove

Each assertion maps to a finding in `PROJECT_AUDIT.md` or a documented business
rule. The notable ones:

- A learner reading `formative_options`, `summative_options` or
  `final_exam_options` gets **zero rows**. The answer keys the demo shipped in
  its JavaScript bundle are now unreachable from the client.
- Grading is server-side: a deliberately-wrong attempt scores 16.67%, computed
  from the answer key inside the database.
- A learner cannot mark a module `PASSED`, inflate their credits, grant
  themselves `ADMIN`, or activate their own pending account.
- A learner sees exactly one enrollment and one profile — their own.
- Passing a module unlocks **only** the next one.
- A learner cannot issue a certificate; neither can an admin, while any
  requirement is outstanding.
- Even `ADMIN` cannot delete or modify an audit row.
- An assessor cannot approve payments; finance cannot grade.

Run them yourself: `./supabase/run_migrations.sh --seed --test`.

---

## Security notes

**The service-role key must never reach a browser.** It bypasses every RLS
policy in this repo. It belongs in Edge Function secrets and CI only. Both
React apps use the anon key.

**POPIA.** `profiles.id_number` holds South African ID numbers, which are
personal information under Act 4 of 2013. It is readable only by the owner and
`ADMIN`/`SUPPORT`, is never written to `audit_logs.metadata`, and is never
returned by `verify_certificate()`. See `docs/SECURITY.md`.

**Row Level Security is FORCED**, not merely enabled, so policies apply to the
table owner too. A mistake in a `SECURITY DEFINER` function cannot silently
bypass them.

---

## Known gaps

Stated plainly rather than stubbed, per the brief's "NO FAKE PRODUCTION" rule:

1. **Edge Functions are not implemented.** `supabase/functions/` is empty. The
   two that are needed are certificate PDF generation and email dispatch. The
   database side is ready for both: `certificates.storage_path` /
   `generated_at` await the PDF writer, and `notifications.email_queued_at` /
   `email_sent_at` / `email_error` await the mailer. In-app notifications work
   today without either.
2. **No email provider is wired.** Deliberate: no credential exists yet.
   `.env.example` documents the connection point.
3. **No payment gateway.** The manual invoice → proof → finance review flow is
   complete and working. `payments.gateway_*` and the `payment_events` ledger
   are the integration seam.
4. **Certificate PDF layout** is not yet generated server-side; the demo's
   print layout will be ported in the frontend session.
5. **`storage.objects` policies are unverified locally.** The shim reproduces
   the table and `storage.foldername()`, but real Storage behaviour can only be
   confirmed against a hosted project. Treat migration `019` as reviewed but
   not yet executed in anger.

---

## Next

Session 2 builds the frontend against this schema. See §11 of
`PROJECT_AUDIT.md` for the phase plan.
