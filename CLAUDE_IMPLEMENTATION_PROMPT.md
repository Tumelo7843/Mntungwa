# Mntungwa LMS — Production Diagnosis, Repair, and Verification

You are working in the `mntungwa` workspace:

- `mntungwa-lms-admin`: deployed admin portal
- `mntungwa-lms-frontend`: deployed learner portal
- `mntungwa-lms-backend`: Supabase migrations, RLS policies, RPCs, Storage policies, and SQL tests

## Deployed sites to investigate

- Admin portal: https://mntungwa-rkc9.vercel.app/
- Learner portal: https://mntungwa-chi.vercel.app/

## Main objective

Diagnose and fix the production failure in the admin portal. Across the admin panel, the application displays:

> Something went wrong  
> Something went wrong. Please try again.  
> Try again

Determine the real cause. Establish clearly whether it is caused by the frontend, Vercel deployment/environment variables, Supabase configuration/database migrations/RLS/RPCs, or a combination. Do not guess and do not hide the problem with a generic fallback or fake data.

Then repair every issue that can be fixed in this repository, test the deployed applications and core functionality end to end, and provide precise manual Supabase or Vercel instructions only for steps that require account/dashboard access.

## Required investigation workflow

1. Read the existing code, migrations, service layers, environment-variable usage, Vercel configuration, and project documentation before changing code.
2. Open both deployed websites and reproduce the error. Inspect browser console errors, network requests, API responses, authentication state, and the failing route/component.
3. Trace the failing admin call from the React UI through `src/services/admin.ts` to the exact Supabase table, view, RPC, Storage operation, policy, or missing environment variable involved.
4. Compare the local backend migrations with the actual requirements implied by the deployed app. Identify missing migrations, missing functions, schema-cache issues, incorrect project URL/key, auth redirect URLs, RLS denials, or absent seed/admin-profile data.
5. Make the smallest secure fix that solves the root cause. Preserve the existing React/TypeScript/Supabase architecture. Do not weaken RLS, expose service-role credentials to the browser, or bypass server-authoritative authorization.
6. Improve error handling so an actionable, safe message is shown to the user while detailed diagnostic information remains available in the browser console or error logging. Keep the error boundary, but do not let it mask a predictable loading/API failure.

## Functional verification scope

Test both portals after the repair. Use real backend responses, not mocked UI states.

### Admin portal

- Sign-in, sign-out, and staff-role route protection.
- Dashboard data loads without the generic error boundary.
- Enrollment queue/list/detail and valid status changes.
- Learner, course, module, lesson, assessment, payment, grading, notification, certificate, and staff-management pages that exist in the app.
- Search, filters, forms, validation, loading, empty, permission-denied, and retry states.
- Direct URL access and API calls cannot grant a role access beyond its RLS/RPC permissions.

### Learner portal

- Public pages, registration/sign-in/sign-out, profile, and protected routes.
- Course browsing, application/enrollment status, payment/proof workflow where configured.
- Active learner course access, lessons, progress, assessments, submissions, notifications, certificates, and profile pages that exist in the app.
- Loading, empty, validation, denied, and unexpected-error states.

If a flow cannot be fully tested because it needs credentials, email confirmation, payment-provider configuration, or an already-provisioned role, test as far as safely possible and state the exact prerequisite. Do not claim an untested flow works.

## Technical requirements

- Keep Supabase RLS and database RPCs as the authorization source of truth; UI guards are not security.
- Do not use `any`, TypeScript suppressions, fake data, fake success states, localStorage for domain data, or client-side authorization shortcuts.
- Never put a Supabase service-role key in Vite/Vercel browser environment variables.
- Ensure all required `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` configuration is correctly documented and validated at startup without leaking secrets.
- Keep sensitive enrollment, payment, staff-role, grading, and certificate decisions transactional and auditable.
- Do not weaken policies merely to make a page load. Fix the query shape, role/profile setup, security-definer function, or policy deliberately and add denial tests.

## Verification and delivery requirements

1. Run both frontend/admin TypeScript and production builds.
2. Run applicable Supabase migration and SQL security/workflow tests. Add targeted regression tests for the exact root cause and any RLS/RPC defect fixed.
3. Verify the deployed sites again after code changes are deployed, if deployment access is available. Otherwise, provide the exact deployment command/action required and clearly distinguish local verification from deployed verification.
4. Deliver a concise report with:
   - root cause and evidence (route, request/error, and affected code/database object);
   - whether the cause was frontend, backend/Supabase, Vercel configuration, or multiple causes;
   - changed files and why;
   - commands/tests run and their outcomes;
   - verified functionality and functionality not verifiable without access;
   - exact manual steps for Supabase and/or Vercel, including SQL to run only when necessary, where to configure values, and how to verify success;
   - any remaining risks or prerequisites.

Do not finish with a generic diagnosis. The admin portal error must either be fixed and verified, or the exact external permission/configuration blocker must be demonstrated with reproducible evidence and step-by-step remediation.
