# RLS.md

Row Level Security model for the Mntungwa LMS.

---

## Principle

**Frontend permissions are for UX. RLS is the security boundary.**

The demo had no authorization at all: a client-side `<Navigate>` guard and a
single `localStorage` blob containing every user's data. Editing that object
granted admin access, issued certificates and exposed every learner's ID number
and grades (audit S-05, S-06).

The rule that replaces it: **assume the client is hostile.** A learner running
arbitrary JavaScript against the anon key must not be able to reach anything
they should not have.

---

## Enabled *and* forced

Every one of the 47 tables has:

```sql
alter table X enable row level security;
alter table X force  row level security;
```

`FORCE` matters. Without it, policies are skipped for the table owner, so a
`SECURITY DEFINER` function running as owner would silently bypass every
policy. With it, the function must be correct too.

---

## Avoiding recursion

A policy on `profiles` that checks the caller's role by selecting from
`user_roles` would trigger `user_roles`' own policy, which may read `profiles`
again. That cycle either errors or hangs (risk R-02).

All role and ownership lookups therefore go through `SECURITY DEFINER` helpers
in `016_auth_helper_functions.sql`, which bypass RLS and break the cycle:

| Helper | Answers |
|---|---|
| `app.has_role(role)` | does the caller hold this role? |
| `app.is_admin()` / `is_staff()` / `is_academic()` / `is_assessor()` / `is_finance()` | role groupings |
| `app.owns_enrollment(id)` | is this the caller's enrollment? |
| `app.has_active_enrollment(course)` | BR-001 |
| `app.can_access_module(id)` | published + enrolled + not LOCKED |
| `app.can_access_lesson(id)` / `can_access_resource(id)` | content gating |

Every helper is `STABLE` (cached per statement, not per row) and pins
`search_path` so a caller cannot shadow a table name to hijack it.

**Never write `select ... from user_roles` directly inside a policy.**

---

## Ownership model

Learner data is reached by joining through `enrollments`:

```
profiles.id = auth.uid()
     └── enrollments.profile_id
            ├── module_progress / lesson_progress
            ├── formative_attempts → formative_answers
            ├── summative_attempts → submissions → versions → files
            ├── final_exam_attempts → final_exam_answers
            ├── grades → grade_criteria_scores
            └── certificates
```

A policy that cannot trace a row back to `auth.uid()` through this chain does
not grant access.

---

## Protecting the answer keys

The single most important control in the system (audit S-03, risk R-01).

`formative_options.is_correct`, `summative_options.is_correct` and
`final_exam_options.is_correct` are the marking keys. The demo shipped 20 of
them in its JavaScript bundle.

The protection has three layers:

1. **No learner SELECT policy exists** on any `*_options` table. Only
   `app.is_staff()` can read them. A learner querying the table gets zero rows.
2. **Safe views** — `formative_options_public`, `summative_options_public`,
   `final_exam_options_public` — expose `id`, `question_id`, `label` and
   `sequence`, and *structurally omit* `is_correct`. They are declared
   `security_invoker = false` so they run as owner, which is what lets them
   read the base table the learner cannot.
3. **Grading never leaves the database.** `submit_formative_attempt()` and
   `submit_final_exam_attempt()` compare answers against `is_correct` inside
   `SECURITY DEFINER` functions and return only a score.

Exam options are narrower still: `final_exam_options_public` returns rows only
while the caller has an `IN_PROGRESS` attempt containing that question. The
moment the attempt is submitted, the options become invisible again.

Tested by assertions 3–7 and 17–18.

---

## Result integrity

Tables a learner can **read but never write**:

| Table | Why |
|---|---|
| `module_progress` | BR-002 — a learner cannot unlock a module |
| `grades` | BR-008 — a learner cannot modify a grade |
| `certificates` | BR-009 — a learner cannot issue a certificate |
| `formative_attempts` | scores are written by the grading function |
| `audit_logs` | append-only for everyone |
| `payment_events` | append-only financial ledger |
| `submission_versions` | immutable evidence |

There is simply no `INSERT`/`UPDATE`/`DELETE` policy for learners on these.

RLS does not raise an error when a caller writes to rows they cannot see — the
statement succeeds and affects **zero rows**. That silent no-op is the
protection. The test suite asserts on rows-affected, not just on exceptions,
because testing only for raised errors would miss the common case.

---

## Withheld results

`grades` carries `released_at`. The learner policy is:

```sql
using (app.owns_enrollment(enrollment_id) and released_at is not null)
```

An assessor can grade a batch and release the results together; until then the
learner sees nothing.

`feedback.is_internal = true` is likewise invisible to learners, so staff can
moderate in the open.

---

## Answer immutability after submission

The brief requires that a learner cannot "modify assessment answers after
submission". `summative_answers` write policies are conditioned on the parent
attempt's status:

```sql
and at.status in ('DRAFT','OPEN','RESUBMISSION_REQUIRED')
```

Once the attempt reaches `SUBMITTED`, the answer rows become read-only.

---

## Public surface

Deliberately small. Unauthenticated (`anon`) callers may:

- `select` on `institution` (branding) and `courses` where
  `publication_status = 'PUBLISHED'` — the public catalogue;
- `insert` into `contact_messages`, pinned to `status = 'NEW'`;
- `execute verify_certificate(number, token)`.

Nothing else. `anon` has no access to profiles, enrollments, modules, lessons,
resources, assessments, grades or payments.

---

## Privilege-escalation guards

Two go beyond ordinary policies:

**`user_roles` is admin-write-only.** This is what closes the demo's
"edit localStorage, set `role: 'admin'`" hole.

**`app.guard_profile_self_update()`** blocks a non-admin from changing their own
`account_status` or `email` through a profile update. Without it, the
`profiles_update_own` policy would let a `PENDING_PAYMENT` learner self-activate
and skip the payment gate entirely.

Both are tested (assertions 10–12).

---

## Separation of duties

| Role | Can | Cannot |
|---|---|---|
| `LEARNER` | own data, unlocked content, own attempts | grade, approve payment, issue certificate |
| `INSTRUCTOR` | author content, view progress | approve payments |
| `ASSESSOR` | grade submissions, give feedback | approve payments, issue certificates |
| `FINANCE` | review and approve payments | grade, author content |
| `SUPPORT` | read learner records | grade, approve, publish |
| `ADMIN` | full institution administration | delete or alter audit rows |

Enforced both by policy and by explicit role checks inside the business
functions, so a caller who somehow reaches the function still fails. Tested by
assertions 45–46.

---

## Rules for extending this

1. Never write `USING (true)` on a table containing learner data.
2. Never disable RLS to make a query work. If a query fails, the policy is
   wrong or the caller lacks the role — fix that.
3. Never look up a role directly in a policy; use the `app.*` helpers.
4. New tables need **both** a policy and a `GRANT`. RLS with no grant is
   unreachable; a grant with no policy returns nothing.
5. Add an assertion to `tests/10_security_and_progression_tests.sql` for any
   new access rule, and make sure it fails before the policy is added.
