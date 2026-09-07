# DATABASE_ARCHITECTURE.md

47 tables, 139 RLS policies, 24 business functions. PostgreSQL 16 / Supabase.

---

## Model A: single institution

There is exactly one institution. `institution` is constrained to a single row
by a unique index on a constant column plus a `CHECK` forbidding any other
value:

```sql
singleton boolean not null default true,
constraint institution_singleton_true check (singleton is true),
create unique index institution_only_one_row on institution (singleton);
```

No `tenant_id` appears anywhere. The demo's SaaS layer — tenants, subdomains,
MRR, licence seats, white-labelling, the `super-admin` role — has been removed
entirely (audit §8.1). **Cohorts survive**, because a cohort is an institutional
grouping rather than a tenant boundary, and the 15-learner minimum is a real
provider obligation now stored in `institution_settings.min_cohort_size`.

---

## Domain map

```
institution ─ institution_settings

profiles ─┬─ user_roles                     (many-to-many: 6 roles)
          └─ enrollments ────────────────────────────┐
                                                      │
courses ─┬─ course_modules ─┬─ lessons ─ learning_resources
         │                  ├─ formative_assessments ─ questions ─ options
         │                  └─ summative_assessments ─ questions ─ options
         └─ final_exams ─ final_exam_questions ─ final_exam_options

enrollments ─┬─ module_progress / lesson_progress
             ├─ formative_attempts ─ formative_answers
             ├─ summative_attempts ─ summative_answers
             │        └─ submissions ─ submission_versions ─ submission_files
             ├─ final_exam_attempts ─ final_exam_answers
             ├─ grades ─ grade_criteria_scores        (rubrics ─ rubric_criteria)
             ├─ feedback
             ├─ invoices ─ payments ─ payment_proofs / payment_events
             └─ certificates

notifications · announcements · audit_logs · contact_messages · cohorts
```

`enrollments` is the ownership anchor: nearly every learner-owned row reaches
`auth.uid()` by joining through it, which is what makes the RLS model tractable.

---

## The structural change from the demo

In the demo a **module was its assessment**. `TRACKS[track].assessType` decided
whether a module rendered a quiz or an upload box, and a learner's entire
history was one map:

```js
records: { 'KM-01': { status, score, attempts, gradedBy, gradedAt } }
```

That shape cannot express multiple attempts with history, per-question answers,
rubric criteria scores, feedback threads, resubmission chains, or who changed
what and when.

Production splits it:

```
COURSE → MODULE → LESSON → RESOURCE
              ↘ FORMATIVE ASSESSMENT   (many, auto-graded, retryable)
              ↘ SUMMATIVE ASSESSMENT   (assessor-graded, resubmittable)
COURSE → FINAL EXAM                    (eligibility-gated)
```

`track` (`KM`/`PM`/`WM`) survives as **descriptive metadata only**. Each module
now configures its own requirements via `require_all_lessons`,
`require_formative` and `require_summative`.

---

## Progression: from array position to data

The demo hard-coded strict linear order over a 28-element array:

```js
isUnlocked = (user, id) => MODULES.slice(0, INDEX[id]).every(m => isPassed(m))
```

Production stores `sequence` and an explicit `prerequisite_module_id`. The seed
builds the same strict chain KM-01 → … → WM-04, so **behaviour is identical**,
but the institution can branch tracks later without a code change (decision
D-02).

A trigger enforces that a prerequisite belongs to the same course and has a
lower sequence — a `CHECK` cannot do this because it cannot reference other
rows.

`app.refresh_module_unlocks()` walks the modules in order and opens each one
whose prerequisite has `PASSED`. It is called after every result event.

---

## Authoritative vs cached

Some columns are **derived**, recalculated by functions and never written by a
client: `module_progress.status`, `enrollments.progress_percent`,
`enrollments.credits_earned`, all `*_attempts.score_percent`.

These are cached deliberately — a dashboard listing 200 learners should not
aggregate 28 modules each on every render. They are never trusted as
authoritative: `check_certificate_eligibility()` recomputes from the underlying
tables rather than reading the rollup.

`enrollments.credits_earned` **sums** `module_progress.credits_awarded` rather
than comparing against a constant. The demo required
`credits === 240 && passedCount === 28`, so editing any module's credit value
silently locked every certificate (audit C-06).

---

## Key constraints

Constraints encode business rules so a bug cannot write an impossible row.

**`grades_passed_matches_score`**
```sql
check (passed = (score_percent >= pass_mark_applied))
```
The pass/fail flag is arithmetic, not opinion. A 20% cannot be recorded as
`PASSED` (tested, assertion 40).

**`certificates_one_live_per_enrollment`**
```sql
exclude (enrollment_id with =) where (status = 'ISSUED')
```
At most one live certificate per enrollment; revoked and replaced records are
retained for audit.

**`resources_single_owner`** — a resource attaches to exactly one of lesson,
module or course.

**`resources_mime_not_video`** — this is a document-based LMS (audit §8.2).

**`summative_weights_sum`** — `question_weight + submission_weight = 100`.

**`submissions_submitted_has_version`** — a submission cannot leave `DRAFT`
without at least one version, preventing the demo's empty "submitted" state.

**Deferrable unique sequences** on modules, lessons, questions and options, so
an admin can reorder items in one transaction without tripping the constraint
mid-update.

---

## Enums

`app_role`, `account_status`, `publication_status`, `enrollment_status`,
`progress_status`, `submission_status`, `attempt_status`, `question_type`,
`feedback_policy`, `certificate_status`, `invoice_status`, `payment_status`,
`payment_method`, `notification_channel`.

Enums rather than `text` + `CHECK`: invalid values are rejected at the type
level, and `supabase gen types typescript` renders them as TypeScript unions,
so an invalid status becomes a compile error in both React apps.

---

## Numbering

Certificate and invoice numbers come from transactional counter tables
(`certificate_sequences`, `invoice_sequences`) keyed by year:

- `MIS-101869-2026-00017`
- `INV-2026-00042`

The demo derived a serial from four characters of a random user id (audit M-14)
and invoice ids from `array.length` (C-04) — both collision-prone. The counters
are `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, so concurrent issuance
cannot produce a duplicate. Neither table is reachable by any role; only
`SECURITY DEFINER` functions touch them.

---

## Indexing

Beyond primary and foreign keys, indexes are added where a real query needs
them. Notable partial indexes:

| Index | Purpose |
|---|---|
| `summative_att_queue_idx` where status in (SUBMITTED, UNDER_REVIEW) | assessor grading queue |
| `payments_queue_idx` where status in (SUBMITTED, UNDER_REVIEW) | finance review queue |
| `notifications_unread_idx` where `is_read = false` | unread badge count |
| `enrollments_active_idx` where `status = 'ACTIVE'` | the hottest RLS lookup |
| `final_att_marking_idx` where manual marking pending | exam marking queue |
| `resources_active_idx` where `is_archived = false` | resource listings |

Partial indexes because the queues are small relative to the tables and the
predicate is always present in the query.

---

## Audit trail

`audit_logs` is append-only: no `INSERT`, `UPDATE` or `DELETE` policy exists for
any role, including `ADMIN`. Rows arrive exclusively through
`app.create_audit_log()`, which is `SECURITY DEFINER` and takes the actor from
the session, so a caller cannot forge it. Roles are captured at write time, so
the trail stays accurate after a later role change.

`metadata` must never contain `id_number` or other POPIA-regulated personal
information.

---

## What is not here

- No `tenant_id`, no SaaS tables (Model A).
- No password column anywhere. Supabase Auth owns credentials (audit S-01).
- No file bytes. Documents live in Storage; PostgreSQL holds metadata only.
- No video. Excluded by constraint.
