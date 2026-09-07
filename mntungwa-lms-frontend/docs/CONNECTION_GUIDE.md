# CONNECTION_GUIDE.md

**Mntungwa LMS — connecting the three projects**

This guide assumes you have three ZIP files and nothing else:

```
mntungwa-lms-backend-supabase-production.zip    the database, security and business logic
mntungwa-lms-frontend-production.zip            the learner-facing application
mntungwa-lms-admin-production.zip               the staff administration application
```

They connect like this:

```
        mntungwa-lms-frontend                 mntungwa-lms-admin
        (learners)                            (staff)
              │                                     │
              │      anon key + user's JWT          │
              └──────────────┬──────────────────────┘
                             ▼
                    ┌──────────────────┐
                    │    SUPABASE      │
                    │  PostgreSQL      │  ← Row Level Security decides
                    │  Auth            │    what each request may see
                    │  Storage         │
                    └──────────────────┘
```

Both applications use the **same project** and the **same anon key**. There is
no server between them and the database. What separates a learner from an
administrator is the roles in `user_roles`, enforced by RLS.

Allow about 45 minutes for a first run-through.

---

## Prerequisites

| | |
|---|---|
| Node.js | 20 or later (`node -v`) |
| npm | 10 or later |
| Supabase account | free tier is enough to start |
| Supabase CLI | `npm install -g supabase` |
| psql | optional, but easier for seeding |

---

# PART A — BACKEND (do this first)

Nothing else works until the database exists.

## Step 1 — Create the Supabase project

1. Sign in at <https://supabase.com/dashboard>, create a new project.
2. Pick a region near your learners. For South Africa, Ireland (`eu-west-1`)
   or Frankfurt (`eu-central-1`) are usually lowest-latency.
3. Set a strong database password and save it.

From **Project Settings → API**, copy and keep:

| Value | Where it goes |
|---|---|
| Project URL | both apps |
| `anon` public key | both apps |
| Project reference | the CLI |
| `service_role` key | **nowhere in this project.** See the warning below. |

> **The service-role key bypasses every security policy in this system.** It
> must never appear in a `VITE_*` variable, a React file, or anything a browser
> downloads. Neither application in this delivery uses it. Keep it for Edge
> Function secrets and CI only.

## Step 2 — Configure authentication

**Authentication → Providers → Email**

- Enable the Email provider.
- Enable **Confirm email**. The schema depends on this: a new profile is created
  as `PENDING_VERIFICATION` and only promoted to `PENDING_PAYMENT` once the
  address is confirmed.
- Set minimum password length to 10 (the apps enforce this client-side too).

**Authentication → URL Configuration**

- Site URL: `http://localhost:5173` for development.
- Redirect URLs — add all of these:
  ```
  http://localhost:5173/auth/callback
  http://localhost:5173/auth/reset-password
  http://localhost:5174/login
  ```
  Add your Vercel domains here too once you deploy (Part D).

## Step 3 — Apply the migrations

```bash
unzip mntungwa-lms-backend-supabase-production.zip
cd mntungwa-lms-backend

supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

This applies `supabase/migrations/*.sql` in filename order. **The order
matters** — `016_auth_helper_functions.sql` must run before
`018_rls_policies.sql`, because every policy calls the helpers it defines.

Verify in the SQL Editor:

```sql
select count(*) from pg_tables t
  join pg_class c on c.relname = t.tablename
 where t.schemaname = 'public' and c.relrowsecurity;
-- expect 47

select count(*) from pg_policies where schemaname = 'public';
-- expect 139
```

If a migration fails, fix the cause and re-run. **Do not disable RLS to get
past an error.**

## Step 4 — Seed the curriculum

```bash
psql "postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres" \
  -f supabase/seed.sql
```

Or paste `supabase/seed.sql` into the SQL Editor.

This creates the institution record, two cohorts, the QCTO qualification, 28
modules with a linear prerequisite chain, 28 lessons, 28 formative assessments
(168 questions, 672 options), 17 summative assessments, 4 Portfolio of Evidence
tasks, the standard rubric, and the final exam.

```sql
select count(*) as modules, sum(credits) as credits from course_modules;
-- expect 28 | 240
```

The seed deliberately contains **no user accounts and no passwords**.

## Step 5 — Confirm the Storage buckets

Migration `019_storage.sql` creates all five. Check **Storage** shows:

`learning-resources`, `learner-submissions`, `payment-proofs`, `certificates`
(all private) and `institution-assets` (public).

If they are missing, some CLI versions restrict the `storage` schema — paste
`019_storage.sql` into the SQL Editor and run it as project owner.

## Step 6 — Create the first administrator

No credentials ship in this delivery, so the first account is made by hand.

**a.** Dashboard → **Authentication → Users → Add user**. Tick *Auto Confirm
User*. Use a real address you control.

The `on_auth_user_created` trigger creates the profile and grants `LEARNER`
automatically. Self-registration never grants a privileged role.

**b.** In the SQL Editor:

```sql
insert into user_roles (profile_id, role)
select id, 'ADMIN'::app_role from profiles where email = 'admin@yourdomain.co.za'
on conflict do nothing;

update profiles set account_status = 'ACTIVE'
 where email = 'admin@yourdomain.co.za';
```

**c.** Repeat for the other staff you need. Available roles: `ADMIN`,
`INSTRUCTOR`, `ASSESSOR`, `LEARNER`, `FINANCE`, `SUPPORT`. One person may hold
several — an instructor who also assesses gets both rows.

```sql
insert into user_roles (profile_id, role)
select id, 'ASSESSOR'::app_role from profiles where email = 'assessor@yourdomain.co.za'
on conflict do nothing;

insert into user_roles (profile_id, role)
select id, 'FINANCE'::app_role from profiles where email = 'finance@yourdomain.co.za'
on conflict do nothing;
```

**d.** Confirm:

```sql
select p.email, array_agg(ur.role) as roles
  from profiles p join user_roles ur on ur.profile_id = p.id
 group by p.email;
```

---

# PART B — ADMIN PANEL

## Step 7 — Install and configure

```bash
unzip mntungwa-lms-admin-production.zip
cd mntungwa-lms-admin
npm install
cp .env.example .env
```

Edit `.env`:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**Anon key only.** The app refuses to start if you paste a service-role key —
it decodes the JWT and throws.

## Step 8 — Run it

```bash
npm run dev          # http://localhost:5174
```

Sign in with the administrator from Step 6. You should land on a dashboard
showing real counts — mostly zeros at this stage, which is correct.

## Step 9 — Build the first real module

This is the workflow that proves the system works end to end.

1. **Courses & modules** → you will see the seeded QCTO course. Open it, or
   create a new one with **New course**.
2. **New module** → enter a code (e.g. `KM-01`), title, description, credits.
   The module is added at the end of the sequence and automatically requires
   the module before it.
3. Open the module. You get five tabs:

   | Tab | What to do |
   |---|---|
   | **Lessons** | Add at least one lesson with a title and body text |
   | **Documents** | Upload the study PDF. Choose whether it attaches to a lesson or the whole module |
   | **Knowledge check** | Create the formative assessment, then add questions. Mark the correct option with the radio button |
   | **Summative** | Add the assignment brief and set how many files the learner must upload |
   | **Publish** | Run the checks, then publish |

4. The **Publish** tab validates before it lets you proceed. If the module
   requires a formative assessment and none is published, or a published
   assessment has no questions, it tells you exactly what is missing.

**Where the correct answers live:** when you mark an option correct, that flag
is written to `formative_options.is_correct` and stays in the database.
Learners have no read access to that column at all. Their browser receives
option text only.

---

# PART C — LEARNER FRONTEND

## Step 10 — Install and configure

```bash
unzip mntungwa-lms-frontend-production.zip
cd mntungwa-lms-frontend
npm install
cp .env.example .env
```

Same two variables, same anon key:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Step 11 — Run it

```bash
npm run dev          # http://localhost:5173
```

## Step 12 — Walk the learner journey

1. **Register** at `/register`. Use a real address — you must click the
   confirmation link.
2. Confirm the email, then **sign in**.
3. Browse `/courses`, open the course, click **Apply to enrol**.

   At this point the learner has a `PENDING` enrolment and can see nothing.
   That is correct — `BR-001` requires an active enrolment.

4. **In the admin panel**, go to **Invoices** and raise one for the learner.
5. **Back in the learner app**, on **Profile & payments**, record a payment
   against the invoice and attach a proof-of-payment file.
6. **In the admin panel**, go to **Payments**, and **Approve**.

   Approval does four things in one transaction: marks the invoice paid,
   clears the enrolment, activates it, and **opens the first module**.

7. **Back in the learner app**: the dashboard now shows the course, and
   **Course roadmap** shows module 1 open with the rest locked.
8. Open the module → open the lesson → **Open** the document (served through a
   5-minute signed URL) → **Mark lesson complete**.
9. Take the knowledge check. Answer and submit.

   Your score is calculated in the database against the answer key. Nothing in
   the browser can change it.

10. Complete the summative assessment: upload a file, submit.

    Try submitting with no file attached — it is refused server-side, not just
    by the form.

11. **In the admin panel** (as an assessor), go to **Grading queue**. Open the
    submission, download the file, enter rubric scores or a percentage, write
    feedback, and **Record result and release**.

12. **Back in the learner app**: the result appears under **Results**, and
    **module 2 has unlocked**.

Repeat for as many modules as your course requires. Once all are passed,
**Final examination** becomes available; passing it makes the certificate
eligible, and an administrator issues it from **Certificates**.

13. Finally, test `/verify` with the certificate number. This page is public —
    sign out first and confirm it still works.

---

# PART D — DEPLOY TO VERCEL

Both applications deploy identically.

## Step 13 — Push to GitHub

Three separate repositories is cleanest:

```bash
cd mntungwa-lms-frontend
git init && git add . && git commit -m "Initial commit"
git remote add origin git@github.com:you/mntungwa-lms-frontend.git
git push -u origin main
```

`.gitignore` already excludes `node_modules`, `dist` and `.env`. **Check that
`.env` is not committed before you push.**

## Step 14 — Create the Vercel projects

For each app: **Add New → Project** → import the repository.

| Setting | Value |
|---|---|
| Framework preset | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Install command | `npm install` |

Add the environment variables under **Settings → Environment Variables**:

```
VITE_SUPABASE_URL       = https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY  = your-anon-key
```

Add them to **Production, Preview and Development** so preview deployments work.

`vercel.json` is already in both projects. It handles two things:

- **SPA routing** — a rewrite so refreshing `/app/roadmap` does not 404.
- **Security headers** — `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy` and HSTS.

## Step 15 — Point Supabase at the deployed URLs

Back in **Authentication → URL Configuration**:

- Site URL → your learner app's production domain.
- Redirect URLs → add:
  ```
  https://your-frontend.vercel.app/auth/callback
  https://your-frontend.vercel.app/auth/reset-password
  https://your-admin.vercel.app/login
  ```

Miss this and email confirmation links will bounce to localhost.

## Step 16 — Production acceptance test

Re-run Part C, Step 12 against the deployed URLs with a fresh learner account.
Confirm in particular:

- [ ] Refreshing a deep link (e.g. `/app/roadmap`) does not 404
- [ ] Email confirmation and password reset both arrive and work
- [ ] Documents open (signed URLs)
- [ ] File upload works from a phone as well as a laptop
- [ ] `/verify/{number}` works while signed out

---

# TROUBLESHOOTING

**"Supabase is not configured"**
`.env` is missing or the variables are misnamed. They must start with `VITE_`
and you must restart `npm run dev` after editing.

**"VITE_SUPABASE_ANON_KEY contains a SERVICE ROLE key"**
Exactly what it says, and the app is right to refuse. Copy the `anon` key.

**A learner signs in but sees no course**
Expected until the enrolment is `ACTIVE`. Approve a payment, or in the admin
panel use **Enrolments → Activate**, which also opens the first module.

**A learner sees the module list but every module is locked**
`module_progress` rows have not been created. Either approve a payment, or use
**Enrolments → Activate**. To fix directly:

```sql
select public.refresh_module_unlocks_admin('<enrollment-id>');
```

**"new row violates row-level security policy"**
Usually correct behaviour. Check what roles the caller holds:

```sql
select array_agg(role) from user_roles where profile_id = auth.uid();
```

Do not disable RLS to work around it.

**"permission denied for function gen_random_uuid"**
Migration `017` did not finish. Re-run it — it re-grants execute on
extension-owned functions after its blanket revoke.

**"infinite recursion detected in policy"**
A policy is querying a table whose own policy refers back. Every role lookup
must go through the `app.*` helper functions, never a direct select on
`user_roles` inside a policy.

**Documents will not open**
The signed URL is minted only if the Storage policy passes. Confirm the module
is unlocked for that learner and that `learning_resources.storage_path` matches
the object's actual path.

**Uploads rejected with "File type … is not permitted"**
The database enforces the MIME allow-list from `institution_settings`. Adjust
`allowed_resource_mime` or `allowed_submission_mime` there — not in the browser.

**Build fails on Vercel but works locally**
Almost always a missing environment variable or a case-sensitive import path.
Vercel's filesystem is case-sensitive; macOS is not.

---

# WHAT TO DO NEXT

Read `WHAT_IS_REAL.md` in this delivery before going live. It sets out
precisely which parts of the system are fully implemented and which are not,
with no ambiguity.
