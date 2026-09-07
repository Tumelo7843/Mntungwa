# SUPABASE_SETUP.md

Step-by-step setup of the Mntungwa LMS backend on a hosted Supabase project.
Assumes you have this repository and nothing else.

---

## Step 1 — Create the project

1. Sign in at <https://supabase.com/dashboard> and create a new project.
2. Choose a region close to your learners. For South Africa, `eu-west-1`
   (Ireland) or `eu-central-1` (Frankfurt) are usually the lowest-latency
   options currently offered.
3. Set a strong database password and store it in your password manager. You
   will need it for the CLI.
4. Wait for provisioning to finish (a minute or two).

From **Project Settings → API**, copy:

| Value | Used by |
|---|---|
| Project URL | all three projects |
| `anon` public key | frontend, admin panel |
| `service_role` key | Edge Functions and CI **only** |
| Project reference | the CLI |

> The `service_role` key bypasses every RLS policy in this repo. It must never
> appear in a React app, a `VITE_*` variable, or anything a browser downloads.

---

## Step 2 — Configure authentication

**Authentication → Providers → Email**

- Enable Email provider.
- Enable **Confirm email**. The schema depends on this: `handle_new_user()`
  creates the profile as `PENDING_VERIFICATION` and only promotes it to
  `PENDING_PAYMENT` once the address is confirmed.
- Set minimum password length to at least 10 characters.

**Authentication → URL Configuration**

- Site URL: `http://localhost:5173` for development; your Vercel domain in
  production.
- Redirect URLs: add both the frontend and admin origins, plus
  `/auth/callback` and `/auth/reset-password` on each.

**Authentication → Rate limits** — leave the defaults on; they mitigate the
credential-stuffing exposure noted as S-12 in the audit.

---

## Step 3 — Install the CLI and link

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
```

---

## Step 4 — Apply the migrations

```bash
supabase db push
```

This applies `supabase/migrations/*.sql` in filename order. **Order matters:**
`016_auth_helper_functions.sql` must run before `018_rls_policies.sql`, because
every policy calls the helpers defined there.

Verify:

```sql
select count(*) from pg_tables t
  join pg_class c on c.relname = t.tablename
 where t.schemaname = 'public' and c.relrowsecurity;
-- expect 47

select count(*) from pg_policies where schemaname = 'public';
-- expect 139
```

If a migration fails midway, fix the cause and re-run. Do not disable RLS to
get past an error — see `docs/RLS.md`.

---

## Step 5 — Seed the curriculum

```bash
psql "postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres" \
  -f supabase/seed.sql
```

or paste `seed.sql` into the SQL Editor.

This creates the institution record, two cohorts, the QCTO qualification, all
28 modules with their linear prerequisite chain, 28 lessons, 28 formative
assessments with 168 questions and 672 options, 17 summative assessments, 4
Portfolio of Evidence assignments, the standard rubric, and the final exam with
28 questions.

Verify:

```sql
select count(*) as modules, sum(credits) as credits from course_modules;
-- expect 28 | 240
```

The seed contains **no user accounts and no passwords** — that is deliberate
(audit S-01/S-02). Accounts are created in step 13.

---

## Step 6 — Storage buckets

`019_storage.sql` creates all five buckets, so if `db push` succeeded they
already exist. Confirm under **Storage**:

| Bucket | Public | Holds |
|---|---|---|
| `learning-resources` | no | study guides, templates, worksheets |
| `learner-submissions` | no | assignments and PoE evidence |
| `payment-proofs` | no | proof-of-payment uploads |
| `certificates` | no | generated certificate PDFs |
| `institution-assets` | **yes** | logo and branding |

If the bucket rows are missing (some CLI versions restrict the `storage`
schema), run `019_storage.sql` manually in the SQL Editor as project owner.

---

## Step 7 — Storage policies

Also created by `019_storage.sql`. Verify:

```sql
select policyname from pg_policies
 where schemaname = 'storage' and tablename = 'objects';
```

You should see read/write policies for each bucket. The path conventions the
policies depend on are documented in `docs/STORAGE.md` — the apps must generate
paths with the matching shape or access checks will silently fail.

---

## Step 8 — Edge Functions

**Not yet implemented.** `supabase/functions/` is empty; nothing to deploy.
Certificate PDF generation and email dispatch will live here. The database is
ready for both (see README → Known gaps). Skip this step for now.

---

## Steps 9–12 — Connect the applications

Covered in the frontend and admin READMEs. Each needs:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

Only the **anon** key. Never the service-role key.

---

## Step 13 — Create the first administrator

No credentials ship in this repository, so the first admin is created by hand.

**a. Create the auth user.** Dashboard → Authentication → Users → *Add user*,
with "Auto Confirm User" ticked. Or:

```bash
supabase auth admin create-user admin@mntungwa.co.za --password '<strong-password>'
```

The `on_auth_user_created` trigger creates the profile and grants `LEARNER`
automatically. Self-registration never grants a privileged role — metadata is
not trusted.

**b. Grant the ADMIN role** in the SQL Editor:

```sql
insert into user_roles (profile_id, role)
select id, 'ADMIN'::app_role from profiles where email = 'admin@mntungwa.co.za'
on conflict do nothing;

update profiles set account_status = 'ACTIVE'
 where email = 'admin@mntungwa.co.za';
```

**c. Repeat for the other staff roles** as needed:

```sql
insert into user_roles (profile_id, role)
select id, 'ASSESSOR'::app_role from profiles where email = 'assessor@mntungwa.co.za'
on conflict do nothing;

insert into user_roles (profile_id, role)
select id, 'FINANCE'::app_role from profiles where email = 'finance@mntungwa.co.za'
on conflict do nothing;
```

Available roles: `ADMIN`, `INSTRUCTOR`, `ASSESSOR`, `LEARNER`, `FINANCE`,
`SUPPORT`. One person may hold several — an instructor who also assesses gets
both rows.

**d. Verify the grant took effect:**

```sql
select p.email, array_agg(ur.role) as roles
  from profiles p join user_roles ur on ur.profile_id = p.id
 group by p.email;
```

---

## Steps 14–34 — Acceptance testing

The first-module acceptance test and the full learner journey are exercised in
sessions 3–6, once the admin panel and frontend exist. The database-level
equivalents already pass today:

```bash
./supabase/run_migrations.sh --seed --test
```

46 assertions covering progression, answer-key protection, server-side grading,
data isolation, exam eligibility, certificate issuance, audit immutability and
separation of duties.

---

## Troubleshooting

**"permission denied for function gen_random_uuid"**
Migration `017` re-grants execute on extension-owned functions after its
blanket revoke. If you see this, `017` did not complete — re-run it.

**"new row violates row-level security policy"**
Usually correct behaviour. Check which role the caller holds:
`select array_agg(role) from user_roles where profile_id = auth.uid();`
Do not disable RLS to work around it.

**"infinite recursion detected in policy"**
A policy is querying a table that has its own policy referring back. Every
role lookup must go through the `SECURITY DEFINER` helpers in `016`, never a
direct `select ... from user_roles` inside a policy.

**Migrations fail on `storage` objects**
Some CLI versions cannot alter the `storage` schema. Run `019_storage.sql`
directly in the SQL Editor as project owner.

**A learner sees no modules after enrolling**
Module unlocks are created by `app.refresh_module_unlocks()`, which runs when a
payment is approved. For a manually created enrollment, call it once:
`select app.refresh_module_unlocks('<enrollment-id>');`
