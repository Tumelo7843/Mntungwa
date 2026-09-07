# BUSINESS_RULES.md

Every rule below is enforced by the database, not by the user interface. The
test file that proves it is `mntungwa-lms-backend/supabase/tests/10_security_and_progression_tests.sql`.

| ID | Rule | Enforced by | Proven |
|---|---|---|---|
| BR-001 | A learner must have an ACTIVE enrolment before accessing restricted content | `app.has_active_enrollment()` in every content policy | ✓ |
| BR-002 | A learner cannot access a locked module | `app.can_access_module()`; no learner write policy on `module_progress` | ✓ |
| BR-003 | A learner must complete required formative assessments | `app.recalculate_module_progress()` | ✓ |
| BR-004 | A learner must pass required summative assessments | `app.recalculate_module_progress()` | ✓ |
| BR-005 | A learner must satisfy final-exam eligibility before starting | `check_final_exam_eligibility()`, re-run inside `start_final_exam_attempt()` | ✓ |
| BR-006 | A learner must pass the final exam before certificate eligibility | `check_certificate_eligibility()` | ✓ |
| BR-007 | Only authorised personnel may grade summative submissions | `app.is_assessor()` inside `grade_summative_attempt()` | ✓ |
| BR-008 | Learners cannot modify grades | No learner INSERT/UPDATE policy on `grades` | ✓ |
| BR-009 | Learners cannot issue certificates | `app.is_admin()` inside `issue_certificate()`; no learner INSERT policy | ✓ |
| BR-010 | Certificates issue only after all requirements pass | `issue_certificate()` re-runs every check in the same transaction | ✓ |
| BR-011 | Private documents require authorised access | `app.can_access_resource()` on both the row and the Storage object | partial* |
| BR-012 | All sensitive administrative actions are auditable | `app.create_audit_log()`; append-only table; `AFTER` triggers on `user_roles`, `profiles.account_status`, `enrollments.status` (migration 022) make the audit row transactional, not a best-effort client call | ✓ |

\* BR-011 is verified at the database level. The Storage half is verified
against a local shim, not a hosted Supabase project — see `WHAT_IS_REAL.md` §4.

## Additional rules the system enforces

| Rule | Where |
|---|---|
| A passed module is never downgraded by a later failed attempt | `app.recalculate_module_progress()` — preserved from the original demo |
| The best score is retained across retakes | same |
| A pass/fail flag must match the arithmetic | `grades_passed_matches_score` CHECK constraint |
| A submission cannot leave DRAFT with no evidence | `submissions_submitted_has_version` CHECK |
| At most one live certificate per enrolment | EXCLUDE constraint on `certificates` |
| A prerequisite must precede its module in sequence | constraint trigger on `course_modules` |
| Answers cannot be changed after submission | write policies conditioned on attempt status |
| A rejected payment must carry a reason | `payments_rejection_has_reason` CHECK |
| A suspended/withdrawn/expired enrolment must carry a reason | `set_enrollment_status()` (migration 022) |
| A submission version and its files are written atomically | `finalize_submission_version()` (migration 022) — a partial upload leaves no orphaned rows |
| Exam time is measured server-side | `expires_at` stamped at start, checked at submit |
| Video files cannot be uploaded as learning resources | `resources_mime_not_video` CHECK |

## Use cases

| ID | Use case | Implemented |
|---|---|---|
| UC-AUTH-001/002/003 | Register · Login · Password reset | ✓ |
| UC-LEARN-001…004 | Dashboard · Access course · Study lesson · Access document | ✓ |
| UC-FORM-001/002 | Take and retake formative assessment | ✓ |
| UC-SUM-001…004 | Start · Submit assignment · Upload PoE · Resubmit | ✓ |
| UC-GRADE-001/002 | Grade submission · Provide feedback | ✓ |
| UC-FINAL-001…004 | Check eligibility · Start · Submit · View result | ✓ |
| UC-CERT-001/002/003 | Determine eligibility · Issue · Verify | ✓ |
| UC-ADMIN-001…008 | Manage learners · Create module · Upload document · Create assessments · Manage results and certificates | ✓ |
| UC-ADMIN-006 | Create final exam | partial — exams are seeded/edited in SQL; no visual builder yet |
| UC-FIN-001/002 | Review and approve payment | ✓ |
