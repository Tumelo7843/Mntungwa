# Mntungwa LMS — Learner Frontend

The learner-facing application: public website, course catalogue, registration,
learner portal, lessons, assessments, submissions, results and certificates.

One of three projects:

| Project | Role |
|---|---|
| `mntungwa-lms-backend` | PostgreSQL, RLS, business logic, Storage |
| **`mntungwa-lms-frontend`** | **This repo.** Learners → Vercel |
| `mntungwa-lms-admin` | Staff administration → Vercel |

## Stack

React 18 · Vite 5 · TypeScript (strict) · Tailwind CSS 3 · React Router 6 ·
supabase-js 2. No other runtime dependencies.

## Prerequisites

Node 20+, and a Supabase project with the backend migrations applied. See
`CONNECTION_GUIDE.md` in the delivery.

## Install

```bash
npm install
cp .env.example .env    # then fill in the two values
npm run dev             # http://localhost:5173
```

## Environment variables

| Variable | Notes |
|---|---|
| `VITE_SUPABASE_URL` | Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | The **anon** key, never service-role |

`src/lib/supabase.ts` decodes the key on startup and throws if a service-role
JWT is supplied. That key bypasses every Row Level Security policy in the
backend and must never reach a browser.

## Build

```bash
npm run build      # tsc -b && vite build
npm run preview
npm run typecheck
```

## Structure

```
src/
├── app/          route guards, error boundary, enrollment context
├── components/   shared UI kit
├── features/
│   ├── public/       home, catalogue, course detail, contact, verification
│   ├── auth/         sign in, register, password reset
│   ├── learning/     dashboard, roadmap, module, lesson, documents, results
│   ├── assessments/  formative, summative, final exam
│   └── certificates/ certificate, profile and payments
├── hooks/        useAsync / useAction — loading, empty, error, retry
├── layouts/      app shell, public layout, auth layout
├── lib/          supabase client, auth context, database types
└── services/     the only place that talks to the database
```

Components never import `supabase` directly — everything goes through
`services/lms.ts`.

## Security notes

This application holds no secrets and enforces no security. Route guards are a
convenience; the database is the boundary. A user who bypasses a guard sees
empty screens, because Row Level Security filters every query by their identity.

Specifically: assessment answer keys are never sent to this application. It
reads option text from `formative_options_public`, a view that structurally
omits `is_correct`. Grading happens in the database.

## Accessibility

Targets WCAG 2.2 AA. Radio/checkbox semantics on assessments, focus-trapped
mobile drawer with Escape, labelled form fields, live regions for results, skip
link, table captions and scopes, visible focus rings, and
`prefers-reduced-motion` respected.

## Deployment

Vercel. `vercel.json` provides the SPA rewrite and security headers. Set the
two environment variables in the project settings for Production, Preview and
Development.

## Troubleshooting

See `CONNECTION_GUIDE.md`. The two most common issues: `.env` not restarted
after editing, and Supabase redirect URLs not updated after deploying.
