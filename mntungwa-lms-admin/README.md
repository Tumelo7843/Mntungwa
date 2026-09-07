# Mntungwa LMS — Administration Panel

The staff application: dashboard, learners, roles, enrolments, course and module
building, document upload, assessment builders, grading, certificates,
payments, reports, announcements, settings and the audit log.

One of three projects:

| Project | Role |
|---|---|
| `mntungwa-lms-backend` | PostgreSQL, RLS, business logic, Storage |
| `mntungwa-lms-frontend` | Learners → Vercel |
| **`mntungwa-lms-admin`** | **This repo.** Staff → Vercel |

## Stack

React 18 · Vite 5 · TypeScript (strict) · Tailwind CSS 3 · React Router 6 ·
supabase-js 2.

## Install

```bash
npm install
cp .env.example .env
npm run dev             # http://localhost:5174
```

## Environment variables

| Variable | Notes |
|---|---|
| `VITE_SUPABASE_URL` | Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | The **anon** key |

**This application does not use the service-role key.** An administrator's
elevated access comes from their `ADMIN` row in `user_roles`, checked by Row
Level Security on every query — not from a privileged key in the bundle.

## First sign-in

There is no default account. Create the first administrator by hand — see
`CONNECTION_GUIDE.md` Part A, Step 6. Signing in with an account that has no
staff role shows an explanatory message rather than a broken dashboard.

## The first-module workflow

**Courses & modules → open a course → New module → open it.** Five tabs take
you through it:

1. **Lessons** — add at least one
2. **Documents** — upload the study material (real Supabase Storage)
3. **Knowledge check** — build the formative assessment and its questions
4. **Summative** — the assignment brief and submission rules
5. **Publish** — validated before it will let you publish

Publishing checks that the components the module claims to require actually
exist, and names anything missing.

## Roles this app respects

Navigation and routes are filtered by role, but that is presentation. The
database enforces the real separation:

| Role | Can | Cannot |
|---|---|---|
| ADMIN | everything | delete or alter an audit row |
| INSTRUCTOR | author content, view progress | approve payments |
| ASSESSOR | grade submissions, give feedback | approve payments, issue certificates |
| FINANCE | review and approve payments | grade, author content |
| SUPPORT | read learner records | grade, approve, publish |

An assessor who reaches `/payments` by typing the URL gets a permission error
from the database, not just a hidden menu item.

## Build

```bash
npm run build
npm run preview
npm run typecheck
```

## Deployment

Vercel, same as the frontend. `vercel.json` supplies the SPA rewrite and
security headers.

Consider restricting access further in production — Vercel password protection,
or an IP allow-list at the edge. Nothing in the application depends on that, but
defence in depth is cheap here.
