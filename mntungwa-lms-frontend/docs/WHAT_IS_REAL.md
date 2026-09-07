# WHAT_IS_REAL.md

**A straight answer to: "is everything in my app real?"**

Short version: **the core learning system is real. Three supporting pieces are
not built, and I have not faked them.** This document tells you exactly which
is which, so nothing surprises you in front of a client.

Read this before you go live.

---

## 1. What "real" means here

A feature is **real** if it stores data in PostgreSQL, enforces its rules in
the database, and cannot be defeated by someone with browser devtools open.

A feature is **not real** if it looks finished but only pretends. The original
demo was full of these — a Publish button that showed a success message and
saved nothing, an upload box that never sent a file, a certificate whose serial
was four characters of a random ID.

None of those survive. Where something genuinely isn't built, this delivery
leaves it visibly absent rather than convincingly fake.

---

## 2. Fully real — works today

### Authentication
Supabase Auth. Registration, email confirmation, sign in, sign out, forgotten
password, reset, session restoration across refreshes.

**No password is stored in the application database.** There is no password
column anywhere in the 47 tables.

### Roles and permissions
Six roles — ADMIN, INSTRUCTOR, ASSESSOR, LEARNER, FINANCE, SUPPORT — enforced
by 139 Row Level Security policies. RLS is `ENABLE`d **and `FORCE`d**, so
policies apply even to the table owner.

A learner cannot grant themselves a role. Tested.

### Courses, modules, lessons, documents
Full hierarchy. An administrator creates a course, adds modules, writes
lessons, and uploads real files to Supabase Storage. Publishing runs validation
first and tells you what is missing.

Documents are served through 5-minute signed URLs, and only if the learner's
module is unlocked.

### Progression
The database decides. Passing a module unlocks the next one, in the same
transaction as the grade. A learner cannot mark a module passed, inflate their
credits, or open a locked module.

The strict linear chain is stored as data (`prerequisite_module_id`), so you
can branch tracks later without a code change.

### Formative assessment
Real question bank, real attempts, **grading in the database**.

This is the most important thing in the delivery. The correct answers live in
`formative_options.is_correct`, and learners have **no read policy on that
table at all**. Their browser receives option text only, through a view that
structurally omits the answer.

I verified this against the compiled bundle:

| Bundle | References to `is_correct` |
|---|---|
| Learner app | **0** |
| Admin app | 17 (staff author the questions — correct) |

The demo shipped 20 answer keys in its JavaScript. That is gone.

### Summative assessment and PoE
Real file uploads to a private bucket, versioned so a resubmission never
overwrites the evidence trail. Submitting with no files is refused
**server-side**, not just by the form.

### Assessor grading
Rubrics with criterion-level scoring, or a straight percentage. Feedback
threads. Results withheld until released. A regrade creates a new record and
supersedes the old one rather than overwriting it.

The pass/fail flag is arithmetic, enforced by a database constraint:
`check (passed = (score_percent >= pass_mark_applied))`. A 20% cannot be
recorded as a pass, by anyone.

### Final examination
Eligibility evaluated server-side and re-checked when the exam starts. Timed
against a server-stamped deadline — the client clock is irrelevant. Objective
questions auto-marked; anything needing judgement routes to an assessor. Exam
questions are only visible while an attempt is live.

### Certificates
Real records with unique numbers from a transactional per-year counter, a
separate high-entropy verification token, and a snapshot of the results that
justified issuance.

Issuance re-runs **every** eligibility check inside the same transaction. If
anything is outstanding it is refused — **including for an administrator**.
Revocation is supported.

Public verification at `/verify/{number}` returns only name, qualification,
issue date and validity. No ID number, no email.

### Payments
Invoice → learner records payment + uploads proof → finance reviews →
approve/reject with a reason → enrolment updated → first module opens. Every
step writes to an append-only ledger.

A learner can declare a payment but cannot mark it approved.

### Audit logging
Append-only. **No INSERT, UPDATE or DELETE policy exists for any role,
including ADMIN.** Entries are written only by database functions that take the
actor from the session, so the actor cannot be forged.

### Everything else
Notifications, announcements, the public contact form, admin dashboard metrics
(every number is a live count, none hard-coded), CSV reports, institution
settings.

---

## 3. Not built — and honestly so

These three are absent. Nothing in either app pretends otherwise.

### 3.1 Certificate PDF generation

**What works:** the certificate record, its number, verification, revocation,
and an on-screen certificate the learner can print or save as PDF through the
browser (`Ctrl/Cmd+P`), using a proper print stylesheet.

**What is missing:** server-side PDF generation. `certificates.storage_path`
and `generated_at` exist and are null; the `certificates` Storage bucket is
created and empty.

**Why:** a real PDF needs an Edge Function with a rendering library and the
service-role key. That is a discrete piece of work, not a line of code.

**Impact:** low. Browser print produces a usable certificate today.

**To finish it:** write `supabase/functions/generate-certificate/`, render the
PDF, upload to the `certificates` bucket, and write the path back. The database
side is ready and waiting.

### 3.2 Email notifications

**What works:** in-app notifications, fully. They are written by the database
when an assessment is graded, a payment is approved, a certificate is issued,
and so on. `notifications.email_queued_at`, `email_sent_at` and `email_error`
exist for the dispatcher.

Supabase's own auth emails — confirmation and password reset — **do work**,
because Supabase sends those itself.

**What is missing:** the dispatcher that turns an in-app notification into an
email.

**Why:** it needs a provider account and an API key. Faking it would mean a
learner believing they were emailed when nobody was.

**To finish it:** add `RESEND_API_KEY` (or your provider) to Edge Function
secrets and write `supabase/functions/send-notification/` to drain rows where
`email_sent_at is null`. The connection point is documented in the backend
`.env.example`.

### 3.3 Payment gateway

**What works:** the complete manual workflow, which is what the original
business model actually uses — EFT, proof of payment, finance verification.

**What is missing:** card payments. `payments.gateway_provider`,
`gateway_reference`, `gateway_status` and `gateway_payload` exist and are
unused; `payment_events` is the webhook landing point.

**Why:** it requires a merchant account (PayFast, Peach, Stripe) that only you
can open.

**To finish it:** add an Edge Function for the provider's webhook, write to
`payment_events`, and call the existing `review_payment()` on a confirmed
settlement. The rest of the flow is unchanged.

---

## 4. Partially real — one honest caveat

### Storage policies are correct but unproven against hosted Supabase

Migration `019_storage.sql` creates five buckets with path-based policies and a
trigger that enforces MIME type and size limits from `institution_settings`.

I verified this SQL parses and is internally consistent against PostgreSQL 16,
using a shim that reproduces `storage.objects` and `storage.foldername()`. But
a shim is not the real thing. **Real Storage behaviour can only be confirmed on
a live Supabase project.**

Do this on day one: upload a document as an admin, open it as an enrolled
learner, then try to open it as a learner who is *not* enrolled. The third
should fail. If it doesn't, the policy needs adjusting before you go live.

### Reports export, but there is no charting

CSV export works from live queries. There are no graphs. If the institution
wants dashboards with charts, that is additional work.

### The final exam is timed, not proctored

`expires_at` is server-stamped and enforced server-side, so a learner cannot
extend their own time. But there is no webcam monitoring, no lockdown browser
and no IP-anomaly detection. `submitted_late` and `auto_submitted` are recorded
as advisory signals.

For a high-stakes QCTO qualification, consider whether your accreditation
requires invigilation.

---

## 5. What I removed from the demo, deliberately

| Removed | Why |
|---|---|
| Multi-tenant SaaS layer (tenants, subdomains, MRR, licence seats, `super-admin`) | Model A is a single institution |
| Video player | This is a document-based LMS. A database constraint now rejects `video/*` uploads |
| All demo passwords and the one-click login panel | They were compiled into the shipped bundle |
| Four South African ID numbers from the seed | POPIA-regulated personal information in a public JavaScript file |
| `resetDemo()` | No production system wipes its database from a sidebar button |

**Kept**, because they are real institutional concepts rather than demo
scaffolding: cohorts, the 15-learner minimum (now a configurable setting), and
the "NOT YET COMPETENT" wording, which is correct occupational-qualification
vocabulary.

---

## 6. Verification you can repeat yourself

**Backend — 46 security assertions:**

```bash
cd mntungwa-lms-backend/supabase
./run_migrations.sh --seed --test
```

Rebuilds a throwaway database from zero, applies all 20 migrations, seeds the
curriculum and runs the tests. Among what it proves:

- A learner querying `formative_options` gets **zero rows**
- A deliberately-wrong attempt scores 16.67%, calculated in the database
- A learner cannot mark a module passed, inflate credits, or grant themselves ADMIN
- A pending learner cannot activate their own account
- A learner sees exactly one profile and one enrolment — their own
- Passing a module unlocks **only** the next one
- Even ADMIN cannot issue a certificate with requirements outstanding
- Even ADMIN cannot delete an audit row
- An assessor cannot approve payments; finance cannot grade

**Frontend and admin — builds:**

```bash
cd mntungwa-lms-frontend && npm install && npm run build
cd mntungwa-lms-admin    && npm install && npm run build
```

Both compile with TypeScript strict mode, `noUnusedLocals` and
`noUnusedParameters`.

**Leak check** — run after any change:

```bash
grep -r "service_role" dist/          # must find nothing
grep -o "is_correct" dist/assets/*.js | wc -l   # must be 0 in the LEARNER app
```

---

## 7. Before you go live

- [ ] Run the storage test in §4 against your real Supabase project
- [ ] Confirm no `.env` file is committed to any repository
- [ ] Confirm the service-role key exists nowhere in either app
- [ ] Change the certificate signatory name in **Settings**
- [ ] Review the certificate wording with the institution — the seeded course
      is a QCTO qualification, and the certificate should not imply the
      external EISA has been passed when only the internal exam has
- [ ] Decide on the three unbuilt pieces in §3: build, defer, or drop
- [ ] Set a database backup schedule in Supabase
- [ ] Agree a POPIA retention policy for `profiles.id_number`
- [ ] Run the full learner journey once on the production URLs

---

## 8. The one-sentence answer

**A learner can register, enrol, pay, study, be assessed, be graded by a real
assessor, progress through modules, sit a final exam, and receive a verifiable
certificate — with no fake data, no localStorage, and no developer
intervention.** Certificate PDFs, notification emails and card payments are the
three things still to build, and each has its connection point documented.
