# CHANGELOG

## Session 3 — Workflow hardening

Migration `022_workflow_hardening.sql` and a matching test file
`tests/20_workflow_hardening_tests.sql`. Not yet executed against a live
database in this environment (no local PostgreSQL / Docker available); the SQL
follows the established patterns and ships with tests to run via
`run_migrations.sh --seed --test`.

### Added
- **Transactional audit safety-net (BR-012).** `AFTER` triggers on
  `user_roles` (grant/revoke), `profiles.account_status` and
  `enrollments.status` write an audit row in the same transaction as the
  change, so a material staff mutation can no longer succeed without an
  auditable record even if the client's follow-up audit call is skipped or
  fails. The admin app's `writeAudit()` now *throws* instead of swallowing
  errors, and the redundant client-side audit calls for the trigger-covered
  mutations were removed.
- **`set_enrollment_status(uuid, text, text)`** — an `ADMIN`-or-`SUPPORT` RPC
  that validates the status transition, requires a learner-facing reason for
  `SUSPENDED`/`WITHDRAWN`/`EXPIRED`, reopens module 1 on reactivation, audits
  and notifies the learner. `enrollments` gains `status_reason`,
  `status_changed_at`, `status_changed_by`. The ADMIN-only
  `enrollments_admin_write` policy is unchanged — SUPPORT reaches this through
  the RPC only.
- **`finalize_submission_version(uuid, text, jsonb)`** — writes a submission
  version and every file row in one transaction. Evidence upload now stages
  files first and only finalises once they are all in Storage, so a partial
  failure leaves no orphaned `submission_versions` / `submission_files` rows.
- **`learner_submissions_delete_orphan`** Storage policy — lets a learner
  remove *only* unreferenced objects in their own enrollment folder (failed
  upload cleanup). Attached evidence stays immutable (admin-delete only).
  `submission_versions` keeps its no-`UPDATE`/`DELETE` invariant; no table
  gained a write grant.

### Not changed
- No RLS policy widened. No constraint weakened. The answer-key protection,
  append-only `audit_logs`, and evidence immutability are all intact.

## Session 1 — Backend foundation (Phases 3 & 5)

Database, security model and business logic. Verified against PostgreSQL 16.

### Added
- 19 migrations, applied in order without error (`run_migrations.sh`).
- 47 tables, RLS **enabled and forced** on every one; 139 policies.
- 24 business functions implementing the authoritative layer.
- `seed.sql`: QCTO Occupational Certificate: Project Manager (SAQA 101869),
  28 modules / 240 credits, 28 lessons, 28 formative assessments with 168
  questions and 672 options, 17 summative assessments, 4 PoE assignments,
  standard rubric, final exam with 28 questions.
- Test suite: 46 assertions covering progression, answer-key protection,
  server-side grading, data isolation, exam eligibility, certificate issuance,
  audit immutability and separation of duties.
- Five Storage buckets with path-based policies and server-side MIME/size
  validation.
- Docs: `SUPABASE_SETUP.md`, `RLS.md`, `SECURITY.md`, `STORAGE.md`,
  `DATABASE_ARCHITECTURE.md`.

### Changed from the demo
- `localStorage` → PostgreSQL. Nothing persists client-side.
- Client-side grading → `submit_formative_attempt()` / `submit_final_exam_attempt()`.
- `isUnlocked()` → `app.refresh_module_unlocks()` with `prerequisite_module_id`
  as data. Strict linear order preserved as the seeded default (D-02).
- `progressOf()` → `app.recalculate_enrollment_progress()`; credits are summed
  from passed modules, not compared against a hard-coded 240 (C-06).
- `records[moduleId]` map → normalised attempts, submissions, versions, grades
  and feedback tables.
- Module ≠ assessment. `track` (KM/PM/WM) is now descriptive metadata; each
  module configures its own completion requirements.
- Grades are versioned: a regrade supersedes rather than overwrites (M-20).

### Added that did not exist
- Final examination engine with server-evaluated eligibility (D-04).
- Certificate records, numbering, verification and revocation.
- Rubrics with criterion-level scoring.
- Submission versioning.
- Payments: invoice → proof → finance review → approve/reject → ledger.
- Notifications, announcements, audit logging, contact messages.
- `INSTRUCTOR`, `ASSESSOR`, `FINANCE`, `SUPPORT` roles.

### Removed
- The entire SaaS layer: tenants, subdomains, MRR, licence seats,
  white-labelling, `super-admin` (Model A).
- Video as a content type — excluded by CHECK constraint (§8.2).
- All demo credentials and RSA ID numbers.

### Fixed during verification
Three defects caught by executing the SQL rather than only writing it:
1. Malformed `FILTER` clause missing `WHERE` in the eligibility function.
2. Stray unused declarations in `check_final_exam_eligibility()`.
3. **`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM public` also
   stripped pgcrypto's `gen_random_uuid()`**, which backs the DEFAULT on nearly
   every primary key — every INSERT by a non-superuser would have failed in
   production. Now re-granted for extension-owned functions only.

Two test failures also turned out to be the system behaving correctly:
the profile guard blocking the test fixture, and a module refusing to complete
while its lesson was outstanding. Both tests were corrected, not the code.

### Known gaps
- Edge Functions not implemented (certificate PDF, email dispatch).
- No email provider or payment gateway wired — connection points documented.
- Storage policies not yet executed against a hosted Supabase project.

### Next
Session 2 — Phases 1, 2, 4, 6–9: the frontend against this schema.
