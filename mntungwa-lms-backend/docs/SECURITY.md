# SECURITY.md

Security model, and how each audit finding was closed.

---

## Threat model

Assume a learner with a valid account, the public anon key, browser devtools
and the ability to issue arbitrary PostgREST requests. Every control below is
designed against that adversary, not against a cooperative client.

---

## Audit findings and their resolution

| # | Finding | Resolution | Test |
|---|---|---|---|
| S-01 | 7 plaintext passwords in the shipped bundle | Supabase Auth owns credentials; no password column exists; `seed.sql` creates no accounts | — |
| S-02 | Demo credentials on the login page | Removed; first admin created manually (`SUPABASE_SETUP.md` §13) | — |
| S-03 | 20 quiz answer keys in the bundle | No learner SELECT policy on any `*_options` table; safe views omit `is_correct`; grading is server-side | 3–7 |
| S-04 | Grading executed in the browser | `submit_formative_attempt()` / `submit_final_exam_attempt()` compute scores in PostgreSQL; `grades_passed_matches_score` CHECK | 17–18, 40 |
| S-05 | No authorization | 139 RLS policies, enabled and forced; `user_roles` is admin-write-only | 8–10 |
| S-06 | All users' data in one client store | Ownership traced through `enrollments`; a learner sees one profile and one enrollment | 13–15 |
| S-07 | RSA ID numbers in the bundle | `id_number` nullable, not seeded, owner+admin only, never in audit metadata or verification output | 35–36 |
| S-11 | No email verification | Supabase "Confirm email" required; `PENDING_VERIFICATION` → `PENDING_PAYMENT` on confirm | — |
| S-12 | No password policy or rate limiting | Supabase Auth policy + built-in rate limits | — |
| S-13 | Guessable certificate serial | Transactional per-year counter + separate high-entropy `verification_token` | — |
| S-14 | Unaudited one-click payment approval | `review_payment()` is finance-only, writes a `payment_events` ledger row and an audit row | 45 |
| M-07 | Client-side payment gate | `guard_profile_self_update()` blocks self-activation | 11–12 |
| M-12 | Filename-only submissions | Real Storage uploads; submission refused with zero files | 38 |
| M-14/M-15 | Fake certificate, no verification | `certificates` rows + `verify_certificate()` | 31–36 |
| M-20 | Grades overwritten on regrade | Regrade inserts a new row and supersedes the old one | — |
| C-03 | Invoices matched by learner name | Real `profile_id` foreign key | — |
| C-04/C-05 | Colliding invoice and user ids | Transactional counters; UUID primary keys | — |
| C-06 | Completion gated on a hard-coded 240 | Credits summed from `module_progress` | — |

Test numbers refer to `supabase/tests/10_security_and_progression_tests.sql`
(46 assertions, all passing).

---

## Key handling

| Key | Where it may live |
|---|---|
| `anon` | frontend and admin bundles. Safe: RLS constrains it. |
| `service_role` | Edge Function secrets and CI only. **Never** in a `VITE_*` variable, a React app, or anything a browser downloads. |

The service-role key bypasses every policy in this repository. Before each
release, grep the built bundles:

```bash
grep -r "service_role\|eyJ.*service" dist/ && echo "LEAK" || echo "clean"
```

Add this to CI (risk R-03).

---

## Defence in depth

Three independent layers, so no single mistake is fatal:

1. **Grants** — which verbs a role can attempt at all.
2. **RLS policies** — which rows it may touch.
3. **Function-level checks** — `issue_certificate()` calls `app.is_admin()` and
   raises regardless of how it was reached.

Certificate issuance illustrates the pattern: a learner has no INSERT policy on
`certificates`, no useful grant, and `issue_certificate()` refuses them — and
refuses an *admin* too while any requirement is outstanding, because it re-runs
`check_certificate_eligibility()` inside the same transaction (risk R-06,
assertion 33).

---

## SECURITY DEFINER hygiene

Every `SECURITY DEFINER` function pins its search path:

```sql
set search_path = public, pg_temp
```

Without this, a caller could create a table in a schema earlier in their search
path and hijack an unqualified reference inside the function body.

`FORCE ROW LEVEL SECURITY` on all 47 tables means policies apply to the owner
too, so a definer function that queries carelessly is still constrained.

---

## POPIA (Act 4 of 2013)

The institution is South African and processes learner personal information.

`profiles.id_number` holds RSA ID numbers, which encode date of birth, sex and
citizenship — this is personal information under POPIA.

Controls:

- Readable only by the owner and `ADMIN` / `SUPPORT`.
- Not populated by `seed.sql`.
- Never written to `audit_logs.metadata`.
- Never returned by `verify_certificate()` — public verification exposes only
  name, qualification, issue date and validity (assertions 35–36).

Still outstanding for a full POPIA position: a documented retention schedule, a
data-subject access-request procedure, and a decision on whether to encrypt
`id_number` at column level. These are policy decisions for the institution,
noted here so they are not forgotten.

---

## Certificate integrity

- `certificate_number` is unique, issued from a transactional counter.
- `verification_token` is 24 random bytes hex-encoded, separate from the
  printed number so publishing a certificate does not enable enumeration.
- `results_snapshot` records the evidence that justified issuance.
- Revocation is supported; `verify_certificate()` reports a revoked
  certificate as invalid.
- At most one `ISSUED` certificate per enrollment (exclusion constraint).

---

## Audit trail

Append-only. No `INSERT`, `UPDATE` or `DELETE` policy exists for any role,
including `ADMIN` (assertions 42–43). Writes go only through
`app.create_audit_log()`, which takes the actor from the session.

Audited today: formative submission, summative submission and grading, final
exam start/submit/grade, certificate issue and revoke, payment approve and
reject.

---

## Known gaps

Stated rather than papered over:

1. **Storage policies are unverified against a hosted project.** The local shim
   reproduces `storage.objects` and `storage.foldername()`, but real behaviour
   must be confirmed on Supabase.
2. **No penetration test has been performed.** The 46 assertions test the
   controls that were designed; they cannot find controls nobody thought of.
3. **No CSP or security headers yet** — these belong to the frontend session
   and `vercel.json` (audit S-15).
4. **Exam integrity is time-based only.** `expires_at` is server-stamped and
   enforced server-side, but there is no proctoring, lockdown browser or
   IP-anomaly detection. `submitted_late` and `auto_submitted` are recorded as
   advisory signals.
5. **No secrets scanning in CI yet.** The grep above should be automated.
