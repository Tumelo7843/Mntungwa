# Mntungwa LMS: Enrollment, Learning, and Administration

You are working in the `mntungwa` workspace:

- `mntungwa-lms-frontend`: learner portal
- `mntungwa-lms-admin`: staff/admin portal
- `mntungwa-lms-backend`: Supabase migrations, RLS, Storage policies, and tests

Read the existing code, migrations, service layers, and documentation before changing anything. Implement and verify the following production-ready flows; do not add fake UI success states or client-side shortcuts.

## Main goal

Make the complete learner-to-admin journey work correctly:

```text
Learner registers
  → confirms email and signs in
  → completes profile
  → selects and enrols for a course
  → sees a clear “Pending approval / payment required” status
  → uploads payment proof or records payment
  → finance/admin reviews payment
  → admin accepts or declines the enrolment
  → learner is notified and sees the decision
  → approved learner can start learning
```

## 1. Learner enrollment and payment flow

Implement or repair this flow end to end:

1. A learner can browse published courses, open a course, and submit an enrollment application.
2. Prevent duplicate applications for the same learner/course. Explain the existing status instead of showing a generic error.
3. After application, the learner dashboard must show the correct enrollment status: `PENDING`, `ACTIVE`, `DECLINED`, `SUSPENDED`, or `CANCELLED`, including the reason and next action.
4. If payment is required, the learner must see the correct invoice, due amount, payment instructions, payment history, and proof-of-payment upload action.
5. Payment proof must upload to private Storage with validation for file type, size, ownership, and duplicate/partial-upload failure. Show upload progress and a retryable error state.
6. Finance/admin must see pending payments in a queue, open the proof securely, and approve or reject it with a required reason for rejection.
7. When a payment decision is made, update the payment, invoice, enrollment, ledger/audit trail, notification, and learner dashboard consistently. The learner must not need to refresh the browser.
8. Enrollment acceptance must occur only when the required rules are met. If the business process allows manual acceptance before payment, make that explicit, auditable, and role-restricted. Never let a learner activate themselves.
9. Admin can approve or decline an enrollment. A decline must require and show a clear reason. An accepted learner becomes active and can learn; a declined/suspended learner cannot access protected learning content.

## 2. Learner learning experience

Once the enrollment is active, make the learning journey clear and functional:

- Dashboard: active course, progress, current unlocked module, outstanding payments/actions, latest notification, and useful empty states.
- Roadmap: locked, current, in-progress, passed, and completed modules must accurately reflect database progress.
- Module: show lessons, authorized resources, formative assessments, summative tasks, previous attempts, submission/grade status, and what the learner must do next.
- Lessons: learners can read content, safely open/download only authorized private resources, and mark lessons complete. Completion must update module and course progress.
- Formative assessments: start, save answers, submit, receive database-calculated results, retry within rules, and see accessible feedback. Correct answers must never enter the learner bundle.
- Summative assessments: start an attempt, upload versioned evidence, submit, receive assessor feedback/results after release, and resubmit where permitted.
- Final exam and certificate: show eligibility reasons before access; do not allow the learner to bypass eligibility, time limits, grading, or certificate issuance.
- Notifications: display enrollment, payment, grading, and certificate events with readable statuses and links to the affected item.

All learner pages need loading, empty, validation, permission, network, and unexpected-error states; actions must prevent double submission and preserve input where a retry is safe.

## 3. Admin dashboard and enrollment management

Create a useful, live admin dashboard—not static metrics. It must show:

- pending enrollment applications;
- pending payment reviews;
- learners awaiting an enrollment decision;
- submissions awaiting grading;
- active learner/course counts and completion/progression signals;
- recent critical activity and clear links to the relevant queues.

Enrollment management must include:

- searchable/filterable learner and enrollment lists;
- enrollment detail with learner profile, course, application date, payment/invoice state, audit history, and current status;
- accept, decline, suspend, reactivate, and cancel actions only where valid;
- mandatory reasons for decline/suspension/cancellation;
- confirmation for consequential actions;
- immediate learner notification and correct learner portal update.

## 4. Staff and role management

Implement secure staff management for administrators:

- View staff members, role, status, last activity if available, and assigned responsibilities.
- Add/invite staff using the existing secure auth pattern; do not store or expose passwords.
- Activate/deactivate staff accounts and change roles only through a secure, audited, database-authorized path.
- Enforce the existing roles:
  - `ADMIN`: institution, staff, enrollments, academic operations, settings, certificates.
  - `INSTRUCTOR`: authorised courses/modules/lessons/assessments.
  - `ASSESSOR`: submissions and grading only.
  - `FINANCE`: invoices, proofs, and payment decisions only.
  - `SUPPORT`: permitted learner, enrollment, and contact support tasks only.
  - `LEARNER`: only their own permitted information and learning content.
- Staff must not access work outside their role by manipulating URLs, browser state, IDs, or API calls.

## Technical rules

- Keep the existing React/TypeScript/Supabase architecture. Learner UI uses `src/services/lms.ts`; staff UI uses `src/services/admin.ts`.
- RLS and database RPCs are the authorization source of truth. UI route guards are not security. Do not weaken RLS to make a page work.
- All sensitive changes must be audited transactionally. Do not make audit logging best-effort for enrollment, payment, staff-role, grade, or certificate decisions.
- Keep assessment grading, progression, invoice numbering, payment approval, eligibility, and certificate issuance server-authoritative.
- Fix partial upload failures so they do not leave orphaned submission/payment records or Storage files.
- Invoice numbers must come from the transactional database function only; remove any timestamp/random fallback.
- Do not use `localStorage` for domain data, `any`, TypeScript suppression, fake uploads, fake data, or fake success messages.
- Maintain WCAG 2.2 AA: semantic forms/tables, associated labels, keyboard access, visible focus, accessible dialogs, live regions, and clear error messages.

## Verification required

1. Add SQL tests for all enrollment/payment state transitions and role-denial cases.
2. Test the full learner journey from registration to active learning, plus acceptance and decline paths.
3. Test finance payment approval/rejection and admin enrollment approval/decline separately.
4. Test that learners cannot see other learners, staff data, answer keys, private documents, or unauthorized signed URLs.
5. Run the backend migration/security suite and both TypeScript/Vite builds.
6. Deliver a concise report listing changed files, verified flows, tests run, and any remaining external-provider prerequisites. Do not claim card payments, email delivery, or server-generated certificate PDFs exist unless they are actually implemented and configured.
