# PROJECT_AUDIT.md

**Mntungwa LMS — Demo → Production (Model A, Single Institution)**
Phase 0 deliverable. Audit performed against the supplied `mntungwa-lms.zip`.

| | |
|---|---|
| Audit date | 28 August 2026 |
| Artefact audited | `mntungwa-lms.zip` → `mntungwa-lms/mntungwa-lms/` |
| Source files | 19 (excluding `node_modules/`, `dist/`, `.git/`) |
| Lines of source | 2,491 |
| Baseline build | **Passes.** Clean `npm install` (133 packages), `vite build` succeeds in 3.73s |
| Bundle size | 277.41 kB JS (80.39 kB gzip), 31.36 kB CSS |
| Backend | **None.** No server, no database, no API, no environment configuration |
| Tests | **None.** No test runner, no test files, no linter, no CI |

---

## 1. What exists

### 1.1 Stack

| Layer | Technology | Version | Verdict |
|---|---|---|---|
| Build | Vite | 5.3.4 | Keep, upgrade to 7.x |
| UI | React | 18.3.1 | Keep, upgrade to 19.x |
| Routing | react-router-dom | 6.26.0 | Keep, upgrade to 7.x |
| Styling | Tailwind CSS | 3.4.6 | Keep |
| Language | JavaScript (JSX) | — | **Migrate to TypeScript** (§9.1) |
| State | React Context + `localStorage` | — | **Replace entirely** |
| Icons | Material Symbols (CDN) | — | Keep, self-host |
| Fonts | Inter (Google Fonts CDN) | — | Keep, self-host |

`package.json` declares three runtime dependencies and five dev dependencies. There is no Supabase client, no data-fetching library, no form library, no validation library, no test framework, no ESLint, no Prettier, no TypeScript.

### 1.2 File inventory

```
mntungwa-lms/
├── index.html                                 15   Google Fonts CDN, #root, module script
├── package.json                               23   3 deps, 5 devDeps, no test script
├── vite.config.js                              3   bare react() plugin, no aliases, no proxy
├── tailwind.config.js                         21   navy #1a396b palette, Inter, shadow-card
├── postcss.config.js                           —   tailwind + autoprefixer
├── README.md                                  44   documents demo accounts + passwords
├── src/
│   ├── main.jsx                               16   HashRouter + AppProvider
│   ├── index.css                              19   Tailwind layers, Material Symbols, @media print
│   ├── App.jsx                                68   26 routes, Protected guard
│   ├── context/AppContext.jsx                197   ★ God-object: auth + data + rules + persistence
│   ├── data/curriculum.js                     95   28 modules, TRACKS, QUIZ_BANK, GENERIC_QUIZ
│   ├── data/seed.js                          115   6 users, 3 tenants, 8 resources, 4 invoices
│   ├── components/ui.jsx                     200   Icon, Badge, ProgressBar, StatCard, Card,
│   │                                               GlobalResponsiveShell, PublicNav, PublicFooter
│   ├── components/SequentialCurriculumTree.jsx 105  28-node locked/unlocked roadmap tree
│   ├── components/Certificate.jsx            117   CertificateCard + PrintableCertificate
│   └── pages/
│       ├── public/PublicPages.jsx            187   Home, Catalog, CourseDetail, Contact, 404
│       ├── public/AuthPages.jsx              254   Login, Register, Checkout, PendingApproval,
│       │                                            ForgotPassword, CheckEmail
│       ├── student/StudentPages.jsx          436   Dashboard, Roadmap, LessonPlayer, Quiz,
│       │                                            ResourceLibrary, ProfilePayments, Certificate
│       ├── admin/AdminPages.jsx              429   Dashboard, StudentManagement, ResultsGrading,
│       │                                            QuizBuilder, ModuleUpload, CertificateManager,
│       │                                            TenantAcademyDashboard
│       └── saas/SaasPages.jsx                147   ✂ SaaSAdminDashboard, SaaSTenantsPage
└── dist/, node_modules/, .git/                     ✂ must not ship (§8.5)
```

### 1.3 Domain model as implemented

The demo encodes a real South African qualification:

> **QCTO Occupational Certificate: Project Manager** — SAQA ID 101869, NQF Level 5, 240 credits, 28 modules, 50% pass mark, R23,800 (incl. VAT), minimum cohort size 15.

Modules are split across three tracks, and **the track determines the assessment type**:

| Track | Count | Credits | `assessType` | How it is assessed today |
|---|---|---|---|---|
| `KM` Knowledge | 11 | 8 each = 88 | `quiz` | Auto-graded MCQ in the browser |
| `PM` Practical | 13 | 8–10 = 112 | `assignment` | Filename string + admin types a % |
| `WM` Workplace | 4 | 10 each = 40 | `poe` | Filename string + admin types a % |
| | **28** | **240** | | |

### 1.4 Routes

26 routes across four zones: 4 public, 6 auth, 7 learner (`/app/*`), 7 admin (`/admin/*`), 2 SaaS (`/saas/*`).

---

## 2. What works

These are genuine assets. **They must survive the rewrite.**

### 2.1 Visual identity — keep verbatim

The navy `#1a396b` primary scale (50→950), Inter display font, Material Symbols iconography and the `shadow-card` token in `tailwind.config.js` produce a coherent, professional institutional look. `GlobalResponsiveShell` (`ui.jsx:81`) is a competent app shell: fixed 256px sidebar on `lg+`, off-canvas drawer below it, sticky backdrop-blurred header, role badge and user avatar. Copy this file's design tokens into both production apps unchanged.

### 2.2 The progression engine — the single most valuable asset

`AppContext.jsx:21–46` implements progression as **four pure functions with no side effects**:

```js
getRecord(user, moduleId)     // → record | null
isPassed(user, moduleId)      // → boolean
isUnlocked(user, moduleId)    // → every prior module in sequence is PASSED
currentModuleId(user)         // → first module not yet PASSED
progressOf(user)              // → { passedCount, credits, pct, certificateUnlocked }
```

This is a clean, testable design and it **ports to PL/pgSQL almost line-for-line**. The rewrite should preserve the semantics exactly and move the location of execution, not the logic.

### 2.3 Business rules worth keeping

Three rules are encoded in the demo that a naive rebuild would lose:

1. **A passed module is never downgraded by a failed retake.** `submitQuiz` (`AppContext.jsx:106–110`) explicitly keeps `PASSED` and the *best* score on voluntary retakes. This is correct assessment practice and must be reimplemented server-side.
2. **Resources inherit their module's lock state.** `ResourceLibraryPage` (`StudentPages.jsx`) gates a resource behind `isUnlocked(user, r.moduleId)`. This becomes a Storage RLS policy.
3. **Cohort minimum of 15 learners.** `QUALIFICATION.minCohortSize` drives a compliance warning banner on the admin dashboard. This is a real QCTO-adjacent provider obligation — promote it to `institution_settings`, do not delete it.

### 2.4 Learner-facing UX worth keeping

- **Quiz page** (`StudentPages.jsx`): answered-counter, disabled submit until complete, sticky bottom submit bar, post-submission reveal of correct/incorrect per option, distinct PASSED / NOT YET COMPETENT result banners with a "Continue to {nextId}" call to action. The "NOT YET COMPETENT" wording is correct occupational-qualification vocabulary.
- **`SequentialCurriculumTree`**: a 28-node vertical roadmap with locked/current/passed states. Strong orientation device for a linear qualification.
- **Certificate print layout** (`Certificate.jsx`): double border, corner rules, watermark, three-column signature block, and real `@media print` rules in `index.css` (`.no-print`, `.print-page`). Keep the layout; replace the data behind it.
- **Empty and error states exist in places** — the grading queue's "queue is clear" state and the dashboard's "no results yet" state are already written.

### 2.5 Structural conventions worth keeping

- Role-keyed navigation config (`NAV` in `ui.jsx:60`) — extends cleanly to six roles.
- Permission matrix concept (`RBAC` / `can()` in `AppContext.jsx:9–19`) — the *shape* is right, though it must be demoted to UX-only (§6.3).
- `MODULE_INDEX` derived lookup — good pattern, becomes a `sequence` column.

---

## 3. What is mocked

Every item below currently renders as though it works.

| # | Feature | Where | What actually happens |
|---|---|---|---|
| M-01 | Authentication | `AppContext.jsx:64` | `x.password === password` string compare against a seed array |
| M-02 | Session | `AppContext.jsx:5,52` | `sessionUserId` in a `localStorage` blob, key `mntungwa-lms-v1` |
| M-03 | Database | `AppContext.jsx:49–60` | One JSON object in `localStorage` |
| M-04 | Registration | `AppContext.jsx:73` | Creates a user with hard-coded `password: 'password'` |
| M-05 | Email verification | — | Does not exist |
| M-06 | Password reset | `AuthPages.jsx:230` | Renders "check your email"; **no email is sent** |
| M-07 | Payment approval | `AppContext.jsx:158` | Sets `accountStatus = 'active'`; no gateway, no ledger |
| M-08 | Proof of payment | `AppContext.jsx:144` | Sets `proofUploaded = true`. No file |
| M-09 | Installment "Pay" button | `StudentPages.jsx` | **No `onClick` handler at all** — dead button |
| M-10 | Resource download | `StudentPages.jsx` | **No `onClick` handler at all** — dead button |
| M-11 | Admin document upload | `AdminPages.jsx:296` | Stores `{name, size}` in component state. **File never leaves the browser.** Displays a fake `v1 uploaded` badge |
| M-12 | Assignment / PoE upload | `StudentPages.jsx` | `submitAssignment(moduleId, fileName)` — persists a **filename string only** |
| M-13 | Quiz Builder publish | `AdminPages.jsx:271` | `setSaved(true)` + 2.5s timeout. **Writes nothing anywhere** |
| M-14 | Certificate issuance | `Certificate.jsx:56` | Serial is `MIS-101869-{last 4 of user.id}-2026`. No record, no uniqueness, no issuance event |
| M-15 | Certificate verification | `Certificate.jsx` | Prints "Verify at verify.mntungwa.co.za". **No such endpoint exists** |
| M-16 | Contact form | `PublicPages.jsx:145` | No persistence |
| M-17 | Video lecture | `StudentPages.jsx` | A dark `<div>` with a play icon and a static 1/3 progress bar |
| M-18 | SaaS metrics | `seed.js:9–40` | MRR, seats, cohort counts are literals |
| M-19 | Admin dashboard metrics | `AdminPages.jsx:13` | Derived from seed — real arithmetic over fake data |
| M-20 | Grade audit trail | `AppContext.jsx:148` | `gradedBy` / `gradedAt` strings on the record. Overwritten on regrade; no history |

---

## 4. What is unsafe

> Every finding below is **confirmed by inspection of the built `dist/` bundle**, not inferred from source.

### 4.1 Critical

**S-01 — Plaintext passwords compiled into the shipped JavaScript.**
`grep -o 'password:"password"' dist/assets/index-*.js` → **7 matches.** Anyone who loads the site downloads the credentials.

**S-02 — Credentials advertised on the login page.**
`AuthPages.jsx:64` renders "Demo accounts (password: password)" with one-click sign-in buttons, including the admin and super-admin accounts.

**S-03 — Quiz answer keys shipped to the client.**
`grep -o 'answer:[0-9]' dist/assets/index-*.js` → **20 matches.** Every correct answer index for every question is in the bundle. A learner opening devtools can read the answer key for any assessment. **This alone disqualifies the current build from any real assessment use.**

**S-04 — Grading executed in the browser.**
`QuizPage.grade()` computes the score client-side and calls `submitQuiz`, which writes `status: 'PASSED'` directly. There is no server. A learner does not even need to cheat on the quiz — they can write the result.

**S-05 — Total absence of authorization.**
`Protected` (`App.jsx:12`) is a client-side `<Navigate>`. There is no other access control anywhere in the system. Editing `localStorage.setItem('mntungwa-lms-v1', ...)` with `role: 'admin'` grants the admin panel; setting all 28 records to `PASSED` issues a certificate; setting `accountStatus: 'active'` bypasses the payment gate.

**S-06 — Cross-learner data exposure.**
All six users — including their RSA ID numbers, payment histories and every grade — live in a single `localStorage` object readable by any signed-in user. This is not an access-control bug; it is the storage architecture.

**S-07 — POPIA-regulated personal information in the client bundle.**
`grep -o 'idNumber:"[0-9]*"' dist/assets/index-*.js` returns **four South African ID numbers**. RSA ID numbers are personal information under POPIA (Act 4 of 2013); a 13-digit RSA ID also encodes date of birth, sex and citizenship. Publishing them in a static bundle is a reportable processing failure. Even as fabricated demo data this pattern must not survive into production.

### 4.2 High

| # | Finding |
|---|---|
| S-08 | `dist/` is committed to the repository — a built artefact containing S-01, S-03 and S-07 is under version control |
| S-09 | `.git/` (with full history and remote config) is inside the delivered ZIP |
| S-10 | `node_modules/` is inside the ZIP — 3,600+ files, and it is what inflates the archive |
| S-11 | No email verification — any address can be registered and used immediately |
| S-12 | No password policy, no complexity rule, no rate limiting, no lockout |
| S-13 | Certificate serial `MIS-101869-{4 chars}-2026` is guessable, collision-prone and unverifiable |
| S-14 | Payment approval is a single unaudited client-side state flip |
| S-15 | No CSP, HSTS, `X-Frame-Options` or any security header configuration |
| S-16 | No error boundary — any render exception yields a blank white page |

### 4.3 Accessibility (WCAG 2.2 AA target)

| # | Finding | SC |
|---|---|---|
| A-01 | Quiz options are `<button>`s, not a radio group. Screen readers cannot announce "option 2 of 4, selected" | 4.1.2 |
| A-02 | Mobile nav drawer has no focus trap, no `aria-modal`, no Escape handler, no focus restoration | 2.1.2, 2.4.3 |
| A-03 | `<input type="file">` in the lesson page has no associated `<label>` | 1.3.1, 4.1.2 |
| A-04 | Search inputs carry a `placeholder` but no accessible name | 3.3.2 |
| A-05 | Certificate serial: 10px `text-slate-400` (#94a3b8) on white ≈ 2.8:1 — fails | 1.4.3 |
| A-06 | Icon-only download button has `title` but no `aria-label` | 4.1.2 |
| A-07 | Tables have no `<caption>` and no `scope` on header cells | 1.3.1 |
| A-08 | No skip-to-content link | 2.4.1 |
| A-09 | Result banners are not announced — no `role="status"` / live region | 4.1.3 |
| A-10 | Focus indicators removed by `outline-none` on some controls without a visible replacement | 2.4.7, 2.4.11 |
| A-11 | Public pages have no `<main>` landmark | 1.3.1 |

### 4.4 Correctness

| # | Finding |
|---|---|
| C-01 | `ProfilePaymentsPage` reads `user.payment.total` unguarded — a learner without a payment record throws |
| C-02 | `StudentDashboard` reads `user.payment.total` unguarded — same |
| C-03 | `approvePayment` matches invoices by **learner display name string**, not by ID. Two learners named "Thabo Nkosi" corrupt each other's billing |
| C-04 | Invoice IDs generated as `'INV-2026-0' + (160 + invoices.length)` — collides on any deletion |
| C-05 | User IDs generated as `Math.random().toString(36).slice(2,8)` — 6 chars, no collision check |
| C-06 | `progressOf` requires `credits === 240` **and** `passedCount === 28`. Any credit-value edit silently locks every certificate |
| C-07 | Route `/app/lesson/:moduleId` renders for KM modules but the dashboard links KM straight to `/app/quiz/:moduleId` — the lesson page is unreachable for 11 of 28 modules |
| C-08 | `HashRouter` produces `/#/app/roadmap` URLs — not shareable, poor SEO, and it *hides* rather than solves the SPA-refresh problem |

---

## 5. What should be preserved

| Asset | Location | Disposition |
|---|---|---|
| Colour scale, fonts, `shadow-card` | `tailwind.config.js` | **Copy verbatim** into both apps |
| Print stylesheet | `index.css` | **Copy verbatim** |
| `GlobalResponsiveShell` | `ui.jsx:81` | Port to TSX; add focus trap (A-02) |
| `Icon`/`Badge`/`ProgressBar`/`StatCard`/`Card` | `ui.jsx` | Port to a shared `components/ui` |
| Progression semantics | `AppContext.jsx:21–46` | **Reimplement in PL/pgSQL, same rules** |
| Best-score-retained rule | `AppContext.jsx:106` | Reimplement server-side |
| Resource-follows-module lock | `StudentPages.jsx` | Becomes a Storage RLS policy |
| Cohort minimum 15 | `curriculum.js:16` | → `institution_settings` |
| Curriculum content (28 modules, titles, descriptions, credits) | `curriculum.js:27–60` | → `seed.sql` rows |
| Question bank content (12 real MCQs) | `curriculum.js:66–89` | → `seed.sql`; **answers never leave the DB** |
| Quiz UX, roadmap tree, certificate layout | various | Port; rewire to real data |
| "NOT YET COMPETENT" vocabulary | `StudentPages.jsx` | Keep — correct occupational terminology |

---

## 6. What must be replaced

### 6.1 `localStorage` → PostgreSQL

The entire `AppContext` persistence layer disappears. `localStorage` retains exactly one legitimate use: UI preferences (sidebar collapsed, table density). Nothing else.

### 6.2 Mock auth → Supabase Auth

`login`/`register`/`logout` → `supabase.auth.signInWithPassword` / `signUp` / `signOut`, plus `onAuthStateChange` for session restoration, real email verification, and real reset tokens. `profiles` is keyed by `auth.users.id` and **never stores a password**.

### 6.3 `RBAC`/`can()` → RLS

The `can()` matrix stays, **demoted to UX only** — it decides whether to render a button. Authorization becomes Row Level Security on every table. Frontend permissions must be treated as advisory; the database must assume the client is hostile.

### 6.4 Client grading → database functions

| Client function today | Becomes |
|---|---|
| `QuizPage.grade()` | `submit_formative_attempt(attempt_id)` — grades from `formative_options.is_correct`, which RLS never exposes to learners |
| `submitQuiz` | (removed — client submits *answers*, never a score) |
| `gradeSubmission` | `grade_submission(submission_id, rubric_scores, feedback)`, assessor-only |
| `progressOf` | `calculate_module_completion()` / `calculate_course_progress()` |
| `certificateUnlocked` | `check_certificate_eligibility()` → `issue_certificate()` |

### 6.5 Fake uploads → Supabase Storage

M-11 and M-12 become real multipart uploads to private buckets with a database metadata row, MIME/size validation, and a path convention that RLS can enforce.

---

## 7. What must be redesigned

### 7.1 Module ≠ Assessment — the biggest structural change

In the demo, a module **is** its assessment: one quiz *or* one file upload, with the track picking which. The production model requires:

```
COURSE → MODULE → LESSON → RESOURCE
                ↘ FORMATIVE ASSESSMENT  (many, auto-graded, retryable)
                ↘ SUMMATIVE ASSESSMENT  (one+, assessor-graded, resubmittable)
COURSE → FINAL EXAM                      (eligibility-gated, high-stakes)
```

Consequences:
- A module gains lessons, and lessons gain resources — neither exists today.
- Formative and summative become independent entities with their own attempts, not a `records[moduleId]` slot.
- `TRACKS[x].assessType` stops determining assessment type; each module is configured independently. Track becomes descriptive metadata (which it should always have been).

### 7.2 `records` map → normalized tables

`records: { 'KM-01': { status, score, attempts, gradedBy, gradedAt } }` cannot express: multiple attempts with history, per-question answers, rubric scores, feedback threads, resubmission chains, or who changed what and when. It decomposes into `enrollments`, `module_progress`, `lesson_progress`, `*_attempts`, `*_answers`, `submissions`, `submission_versions`, `grades`, `feedback`.

### 7.3 Prerequisites: hard-coded → configurable

`isUnlocked` hard-codes strict linear order over a static array. Production stores `sequence` and an explicit `prerequisite_module_id` per module. **Strict linear remains the seeded default** so current behaviour is preserved, but the institution can branch tracks later without a code change.

### 7.4 A final exam must be built from nothing

The demo has **no final exam**. It conflates "28/28 passed" with "EISA cleared" and issues the certificate immediately. Model A requires a distinct gate:

```
all modules complete → check_final_exam_eligibility() → final exam attempt
  → server-side grading → pass → check_certificate_eligibility() → issue_certificate()
```

The existing "EISA Readiness" concept maps onto this cleanly: internal completion + final exam = readiness for the external QCTO assessment. Wording should be reviewed with the client so the certificate does not imply the external EISA has been passed.

### 7.5 Context decomposition

The 197-line `AppContext` becomes: a thin `AuthProvider` (session only), a typed service layer per domain (`services/courses.ts`, `services/assessments.ts`, …), server-state caching, and route-level guards. No component reaches for `supabase` directly.

### 7.6 `HashRouter` → `BrowserRouter` + `vercel.json`

Fixes C-08 and delivers clean shareable URLs. SPA refresh is solved properly with a rewrite rule.

### 7.7 Certificates → issued records

A certificate becomes a **row**, not a computed boolean: unique number, issue timestamp, issuing officer, snapshot of the results that justified it, revocation fields, and a public verification endpoint that returns *only* name, qualification, issue date and validity — nothing more.

---

## 8. What must be removed

### 8.1 The entire SaaS layer — Model A is single-institution

Delete: `src/pages/saas/` (147 lines), both `/saas` routes, the `'super-admin'` role and its `NAV` block, `SEED_TENANTS`, `updateTenant`, `TenantAcademyDashboard` (`AdminPages.jsx:365`), and every `tenantId` / `subdomain` / `accentColor` / `logoInitials` / `plan` / `licenseSeats` / `seatsUsed` / `mrr` field.

**Retain, re-scoped:** cohorts (a real institutional concept), and a single-row `institution` + `institution_settings` pair for name, logo, accent colour and pass marks. This preserves the branding capability without SaaS architecture.

### 8.2 Video

Remove the fake player (M-17) and the `MP4` entry in `SEED_RESOURCES`. This is a document-based LMS. Drop `MP4` from the accepted MIME allow-list.

### 8.3 Demo scaffolding

`resetDemo()` and its sidebar button; the demo-account panel and `quick()` on the login page; every hard-coded `password: 'password'`; all four RSA ID numbers.

### 8.4 Dead controls

M-09 (installment Pay) and M-10 (resource download) — implement or remove. Nothing ships with a button that does nothing.

### 8.5 Repository hygiene

`dist/`, `node_modules/` and `.git/` must not appear in any deliverable ZIP. Add a real `.gitignore`.

---

## 9. Production gaps

Requirements from the brief with **zero implementation** today:

**Backend (nothing exists):** PostgreSQL schema · migrations · seed · RLS · Storage buckets and policies · database functions · triggers · Edge Functions · server-side validation · audit logging · notification backend.

**Roles:** `INSTRUCTOR`, `ASSESSOR`, `FINANCE`, `SUPPORT` are entirely absent. Today the single `admin` account grades submissions, approves payments and manages content, with no separation of duties.

**Assessment:** lessons · resources · formative/summative separation · question types beyond single-answer MCQ (no true/false, no multiple-select) · attempt limits · configurable feedback · rubrics · criterion scoring · resubmission workflow · assessor assignment · question bank · randomized selection · timed exams.

**Certificates:** issuance records · unique numbering · verification endpoint · revocation.

**Payments:** invoices · payment records · proof upload · finance review queue · approve/reject with reason · payment events · gateway integration seam.

**Platform:** notifications · announcements · audit logs · reports · error boundaries · loading/empty/error/retry/unauthorized/forbidden/not-found states · `.env.example` · environment configuration · `vercel.json` · tests at any level · linting · CI.

---

## 10. Target architecture

### 10.1 Three projects

```
mntungwa-lms-frontend/     React 19 + Vite 7 + TS + Tailwind + supabase-js   → Vercel
mntungwa-lms-backend/      supabase/{migrations,functions}, seed.sql, docs   → Supabase
mntungwa-lms-admin/        React 19 + Vite 7 + TS + Tailwind + supabase-js   → Vercel
```

Both React apps consume the **same generated database types** (`supabase gen types typescript`), which is the strongest single argument for the TypeScript migration: the schema becomes compile-time-checked in three places at once.

### 10.2 Proposed table set (37 tables)

Grouped as the migrations will be ordered:

| Migration | Tables |
|---|---|
| `001_institution` | `institution`, `institution_settings` |
| `002_profiles` | `profiles`, `roles`, `user_roles`, `cohorts` |
| `003_courses` | `courses` |
| `004_modules_lessons_resources` | `course_modules`, `lessons`, `learning_resources` |
| `005_enrollments` | `enrollments` |
| `006_progress` | `lesson_progress`, `module_progress` |
| `007_formative` | `formative_assessments`, `formative_questions`, `formative_options`, `formative_attempts`, `formative_answers` |
| `008_summative` | `summative_assessments`, `summative_questions`, `summative_options`, `summative_attempts`, `summative_answers` |
| `009_submissions` | `assignments`, `submissions`, `submission_versions` |
| `010_gradebook` | `rubrics`, `rubric_criteria`, `grades`, `grade_criteria_scores`, `feedback` |
| `011_final_exams` | `final_exams`, `final_exam_questions`, `final_exam_attempts`, `final_exam_answers` |
| `012_certificates` | `certificates` |
| `013_payments` | `invoices`, `payments`, `payment_proofs`, `payment_events` |
| `014_notifications` | `notifications`, `announcements` |
| `015_audit` | `audit_logs`, `contact_messages` |
| `016_rls` | policies across all of the above |
| `017_functions` | progression, grading, eligibility, issuance, audit |

### 10.3 Authoritative database functions

`calculate_module_completion` · `check_module_unlocked` · `submit_formative_attempt` · `grade_submission` · `check_final_exam_eligibility` · `start_final_exam_attempt` · `submit_final_exam_attempt` · `check_course_completion` · `check_certificate_eligibility` · `issue_certificate` · `verify_certificate` · `create_audit_log`

All are `SECURITY DEFINER` with a locked `search_path`. Learners hold `EXECUTE` on only the three they legitimately invoke.

### 10.4 Storage buckets

| Bucket | Public | Path convention | Read | Write |
|---|---|---|---|---|
| `learning-resources` | no | `{course}/{module}/{lesson}/{uuid}` | enrolled + module unlocked | instructor/admin |
| `learner-submissions` | no | `{enrollment}/{assessment}/{version}/{uuid}` | owner + assigned assessor + admin | owner, own enrollment only |
| `payment-proofs` | no | `{enrollment}/{invoice}/{uuid}` | owner + finance + admin | owner |
| `certificates` | no | `{certificate_number}.pdf` | owner + admin; public via signed URL from `verify_certificate` | function only |
| `institution-assets` | **yes** | `branding/{uuid}` | anyone | admin |

---

## 11. Delivery plan

Phase 0 is complete — this document. The remaining 23 phases group into six sessions of work. Each ends with a build that compiles and a state you can actually run.

| Session | Phases | Output |
|---|---|---|
| **1** | 3, 5 | `mntungwa-lms-backend`: 17 migrations, RLS, functions, seed, `SUPABASE_SETUP.md`. Verified against a local Postgres. |
| **2** | 1, 2, 4, 6–9 | `mntungwa-lms-frontend` skeleton: TS, Supabase Auth, protected routes, course/module/lesson browsing, real resource access, progress tracking. Builds clean. |
| **3** | 10–13 | Formative engine, summative engine, submissions, rubric grading — across frontend and admin. |
| **4** | 14–16 | Final exam engine, certificate engine + public verification, payment workflow. |
| **5** | 17–19 | `mntungwa-lms-admin` completed: dashboards, management screens, notifications, reports, audit log viewer. |
| **6** | 20–23 | Security hardening, accessibility remediation (A-01…A-11), test suites, Vercel config, the 26 documentation files, SRS, and the first-module acceptance test executed end to end. |

### 11.1 Decisions taken in this audit

Recorded so they can be challenged now rather than discovered later:

| # | Decision | Rationale |
|---|---|---|
| D-01 | **Migrate to TypeScript** | 2,491 LOC is small; the code is being restructured regardless; generated DB types give all three projects compile-time schema safety. Brief permits it where safe. |
| D-02 | **Strict linear progression stays the default**, but as configurable data | Preserves current behaviour exactly while removing the hard-coded array. |
| D-03 | **Cohorts and the 15-learner minimum survive** the SaaS removal | Institutional, not multi-tenant. Real provider obligation. |
| D-04 | **The final exam is new**; EISA readiness maps onto it | The demo has no exam engine. Certificate wording needs client review so it does not imply the external QCTO assessment has been passed. |
| D-05 | **`BrowserRouter` + `vercel.json` rewrite** | Fixes C-08 properly instead of hiding it behind `#`. |
| D-06 | **Track becomes descriptive metadata** | Assessment type moves to per-module configuration. |

### 11.2 Scope note

The brief asks for three production applications, ~37 tables with full RLS, a rubric-based grading workflow, a timed exam engine, a certificate authority, a payments workflow, 26 documentation files, an SRS, and unit + integration + E2E suites — then correctly insists on **NO FAKE PRODUCTION**.

Honouring that instruction means this is built and verified in stages, not emitted as three plausible-looking archives in one pass. Nothing will be declared production-ready until the first-module acceptance test in §11 of the brief has actually been executed, all 38 steps.

---

## 12. Risk register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R-01 | Answer keys leaking to the client again | Assessment integrity destroyed | `formative_options.is_correct` never selectable by a learner role; grading only inside `SECURITY DEFINER` functions; add an RLS test that asserts a learner query cannot read it |
| R-02 | RLS recursion on `profiles` ↔ `user_roles` | Every query fails or hangs | Role lookup via a `SECURITY DEFINER` helper, not a self-referential policy |
| R-03 | Service-role key reaching a React bundle | Total compromise | Key exists only in Edge Function secrets; add a CI grep over `dist/` |
| R-04 | Storage path convention drifting from policy | Silent access-control failure | Paths generated by one shared helper; policies written against that helper's format |
| R-05 | POPIA obligations on learner ID numbers | Regulatory exposure | Column-level RLS, no ID numbers in logs or verification responses, retention policy documented in `SECURITY.md` |
| R-06 | Certificate issued while an eligibility rule is unimplemented | Invalid qualification issued | `issue_certificate` re-runs *every* check inside the same transaction; no client path can call it |
| R-07 | Existing UI regressing during the TS port | Loss of the demo's main asset | Port file-by-file per the brief's §"FILE-BY-FILE RULE"; design tokens copied verbatim |

---

*End of Phase 0. Next: Phase 3 — database foundation.*
