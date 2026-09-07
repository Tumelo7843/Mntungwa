import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AdminAuthLayout, AdminShell } from '@/layouts/AdminShell';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  LiveRegion,
  Spinner,
  StatCard,
  fmtCurrency,
  fmtDate,
  fmtDateTime,
  inputClass,
  statusLabel,
  statusTone,
} from '@/components/ui';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/lib/auth';
import * as api from '@/services/admin';
import type { AppRole } from '@/lib/database.types';

const ALL_ROLES: AppRole[] = ['ADMIN', 'INSTRUCTOR', 'ASSESSOR', 'LEARNER', 'FINANCE', 'SUPPORT'];

/* ========================================================================== */
/* LOGIN                                                                       */
/* ========================================================================== */

export function AdminLoginPage() {
  const { signIn, session, roles, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const action = useAction(signIn);
  const navigate = useNavigate();

  const isStaff = roles.some((r) => r !== 'LEARNER');
  if (session && isStaff) return <Navigate to="/" replace />;

  return (
    <AdminAuthLayout title="Staff sign in">
      {session && !isStaff && !loading && (
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          This account does not have a staff role. Ask an administrator to grant you access, or use
          the learner portal instead.
        </div>
      )}

      {action.error && (
        <div className="mb-5">
          <ErrorState error={action.error} />
        </div>
      )}

      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await action.run(email, password);
          if (r !== undefined) navigate('/', { replace: true });
        }}
      >
        <Field label="Email address" required>
          {(p) => (
            <input
              {...p}
              type="email"
              autoComplete="email"
              className={inputClass}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Password" required>
          {(p) => (
            <input
              {...p}
              type="password"
              autoComplete="current-password"
              className={inputClass}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={action.running}>
          Sign in
        </Button>
      </form>
    </AdminAuthLayout>
  );
}

/* ========================================================================== */
/* DASHBOARD — every figure is a live count (fixes audit M-19)                 */
/* ========================================================================== */

export function DashboardPage() {
  const metrics = useAsync(() => api.getDashboardMetrics(), []);

  return (
    <AdminShell title="Dashboard" subtitle="Live institution metrics">
      {metrics.loading && <Spinner />}
      {metrics.error && <ErrorState error={metrics.error} onRetry={metrics.refetch} />}

      {metrics.data && (
        <div className="space-y-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Link to="/enrollments" className="rounded-xl focus-visible:outline-none">
              <StatCard icon="group" label="Total learners" value={metrics.data.totalLearners} />
            </Link>
            <Link to="/enrollments?status=ACTIVE" className="rounded-xl focus-visible:outline-none">
              <StatCard icon="how_to_reg" label="Active learners" value={metrics.data.activeLearners} tone="text-emerald-700 bg-emerald-50" />
            </Link>
            <Link to="/enrollments?status=PENDING" className="rounded-xl focus-visible:outline-none">
              <StatCard icon="pending_actions" label="Pending applications" value={metrics.data.pendingApplications} tone="text-amber-700 bg-amber-50" />
            </Link>
            <StatCard icon="school" label="Published courses" value={metrics.data.activeCourses} />
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon="view_module" label="Published modules" value={metrics.data.publishedModules} />
            <StatCard icon="assignment_late" label="Awaiting grading" value={metrics.data.awaitingGrading} tone="text-amber-700 bg-amber-50" />
            <StatCard icon="fact_check" label="Exams to mark" value={metrics.data.examsAwaitingMarking} tone="text-amber-700 bg-amber-50" />
            <StatCard icon="task_alt" label="Completed learners" value={metrics.data.completedLearners} tone="text-emerald-700 bg-emerald-50" />
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon="workspace_premium" label="Certificates issued" value={metrics.data.certificatesIssued} tone="text-violet-700 bg-violet-50" />
            <StatCard icon="receipt_long" label="Outstanding invoices" value={metrics.data.outstandingPayments} tone="text-red-700 bg-red-50" />
            <StatCard icon="payments" label="Payments to review" value={metrics.data.paymentsAwaitingReview} tone="text-amber-700 bg-amber-50" />
            <StatCard icon="mail" label="New enquiries" value={metrics.data.newContactMessages} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="What needs attention">
              <ul className="space-y-2 text-sm">
                {metrics.data.awaitingGrading > 0 && (
                  <li>
                    <Link to="/submissions" className="flex items-center gap-2 text-primary font-semibold hover:underline">
                      <Icon name="assignment_late" className="text-[18px]" />
                      {metrics.data.awaitingGrading} submission(s) waiting to be graded
                    </Link>
                  </li>
                )}
                {metrics.data.paymentsAwaitingReview > 0 && (
                  <li>
                    <Link to="/payments" className="flex items-center gap-2 text-primary font-semibold hover:underline">
                      <Icon name="payments" className="text-[18px]" />
                      {metrics.data.paymentsAwaitingReview} payment(s) awaiting verification
                    </Link>
                  </li>
                )}
                {metrics.data.pendingApplications > 0 && (
                  <li>
                    <Link to="/enrollments?status=PENDING" className="flex items-center gap-2 text-primary font-semibold hover:underline">
                      <Icon name="how_to_reg" className="text-[18px]" />
                      {metrics.data.pendingApplications} enrolment application(s) pending
                    </Link>
                  </li>
                )}
                {metrics.data.newContactMessages > 0 && (
                  <li>
                    <Link to="/messages" className="flex items-center gap-2 text-primary font-semibold hover:underline">
                      <Icon name="mail" className="text-[18px]" />
                      {metrics.data.newContactMessages} unanswered enquiry(ies)
                    </Link>
                  </li>
                )}
                {metrics.data.awaitingGrading === 0 &&
                  metrics.data.paymentsAwaitingReview === 0 &&
                  metrics.data.pendingApplications === 0 &&
                  metrics.data.newContactMessages === 0 && (
                    <li className="text-slate-600">Nothing is waiting. All queues are clear.</li>
                  )}
              </ul>
            </Card>

            <Card title="Getting started">
              <ol className="space-y-2 text-sm text-slate-700 list-decimal list-inside">
                <li>Create a course under <Link to="/courses" className="text-primary font-semibold">Courses &amp; modules</Link>.</li>
                <li>Add a module, its lessons and upload the study documents.</li>
                <li>Build a formative assessment and add questions.</li>
                <li>Create the summative assessment and set the submission rules.</li>
                <li>Publish the module — the system checks the required parts exist.</li>
              </ol>
            </Card>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

/* ========================================================================== */
/* LEARNERS & STAFF                                                            */
/* ========================================================================== */

export function LearnersPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const people = useAsync(() => api.listPeople(query), [query]);

  return (
    <AdminShell title="Learners" subtitle="Everyone registered on the system">
      <Card>
        <form
          className="flex gap-3 mb-5"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search);
          }}
        >
          <input
            className={inputClass}
            placeholder="Search by name"
            aria-label="Search learners by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="submit">Search</Button>
        </form>

        {people.loading && <Spinner />}
        {people.error && <ErrorState error={people.error} onRetry={people.refetch} />}
        {people.settled && !people.data?.length && (
          <EmptyState icon="group" title="No people found" body="Learners appear here once they register." />
        )}

        {!!people.data?.length && (
          <div className="overflow-x-auto -m-5 mt-0">
            <table className="w-full text-sm">
              <caption className="sr-only">Registered people and their roles</caption>
              <thead className="bg-slate-50 border-y border-slate-200">
                <tr>
                  <th scope="col" className="text-left font-bold text-slate-700 px-5 py-3">Name</th>
                  <th scope="col" className="text-left font-bold text-slate-700 px-5 py-3">Email</th>
                  <th scope="col" className="text-left font-bold text-slate-700 px-5 py-3">Status</th>
                  <th scope="col" className="text-left font-bold text-slate-700 px-5 py-3">Roles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {people.data.map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-3 font-semibold text-slate-900">{p.full_name}</td>
                    <td className="px-5 py-3 text-slate-600">{p.email}</td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(p.account_status)}>{statusLabel(p.account_status)}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {p.roles.map((r) => (
                          <Badge key={r} tone="blue">{r}</Badge>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AdminShell>
  );
}

export function StaffPage() {
  const [search, setSearch] = useState('');
  const people = useAsync(() => api.listPeople(search), [search]);
  const [message, setMessage] = useState<string | null>(null);

  const grant = useAction(async (id: string, role: AppRole) => {
    await api.grantRole(id, role);
    setMessage(`Granted ${role}.`);
    people.refetch();
  });
  const revoke = useAction(async (id: string, role: AppRole) => {
    await api.revokeRole(id, role);
    setMessage(`Revoked ${role}.`);
    people.refetch();
  });

  return (
    <AdminShell title="Staff & roles" subtitle="Grant institution roles">
      <div className="space-y-4">
        <div className="rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-800">
          <p className="font-bold">Roles are the security boundary</p>
          <p className="mt-1">
            Role grants are enforced by the database, not this interface. A learner cannot grant
            themselves a role even with full access to the browser.
          </p>
        </div>

        <LiveRegion>
          {message && (
            <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
              {message}
            </p>
          )}
        </LiveRegion>

        {(grant.error || revoke.error) && <ErrorState error={(grant.error ?? revoke.error)!} />}

        <Card>
          <input
            className={inputClass + ' mb-5'}
            placeholder="Search by name"
            aria-label="Search people by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {people.loading && <Spinner />}
          {people.error && <ErrorState error={people.error} onRetry={people.refetch} />}

          <ul className="divide-y divide-slate-100 -m-5 mt-0">
            {people.data?.map((p) => (
              <li key={p.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{p.full_name}</p>
                    <p className="text-xs text-slate-600">{p.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_ROLES.map((role) => {
                      const has = p.roles.includes(role);
                      return (
                        <button
                          key={role}
                          onClick={() => (has ? revoke.run(p.id, role) : grant.run(p.id, role))}
                          disabled={grant.running || revoke.running}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset transition-colors disabled:opacity-50 ${
                            has
                              ? 'bg-primary-50 text-primary-700 ring-primary-300'
                              : 'bg-white text-slate-500 ring-slate-300 hover:bg-slate-50'
                          }`}
                          aria-pressed={has}
                          aria-label={`${has ? 'Revoke' : 'Grant'} ${role} for ${p.full_name}`}
                        >
                          {role}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AdminShell>
  );
}

/* ========================================================================== */
/* ENROLMENTS                                                                  */
/* ========================================================================== */

export function EnrollmentsPage() {
  const [params, setParams] = useSearchParams();
  const filter = params.get('status') ?? '';
  const courseFilter = params.get('course') ?? '';
  const [search, setSearch] = useState('');
  const list = useAsync(() => api.listEnrollments(filter || undefined), [filter]);
  const [message, setMessage] = useState<string | null>(null);

  const setFilter = (s: string) => {
    const next = new URLSearchParams(params);
    if (s) next.set('status', s);
    else next.delete('status');
    setParams(next, { replace: true });
  };
  const setCourseFilter = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('course', id);
    else next.delete('course');
    setParams(next, { replace: true });
  };

  // Course options are derived from whatever the current status view returned,
  // plus a stable label. Search and course are applied client-side over the
  // service-layer result — no extra database round trip per keystroke.
  const courseOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of list.data ?? []) {
      if (e.course?.id) seen.set(e.course.id, e.course.title ?? e.course.code ?? e.course.id);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [list.data]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data ?? []).filter((e) => {
      if (courseFilter && e.course?.id !== courseFilter) return false;
      if (!q) return true;
      return (
        (e.profile?.full_name ?? '').toLowerCase().includes(q) ||
        (e.profile?.email ?? '').toLowerCase().includes(q)
      );
    });
  }, [list.data, search, courseFilter]);

  const activate = useAction(async (id: string) => {
    await api.updateEnrollment(id, { documents_verified: true });
    await api.setEnrollmentStatus(id, 'ACTIVE');
    setMessage('Enrolment activated and the first module opened.');
    list.refetch();
  });

  const verifyDocs = useAction(async (id: string) => {
    await api.updateEnrollment(id, { documents_verified: true });
    setMessage('Documents marked as verified.');
    list.refetch();
  });

  const changeStatus = useAction(
    async (id: string, status: 'SUSPENDED' | 'WITHDRAWN' | 'ACTIVE', reason?: string) => {
      await api.setEnrollmentStatus(id, status, reason);
      setMessage(
        status === 'ACTIVE'
          ? 'Enrolment reinstated. The learner has been notified and their content is unlocked again.'
          : `Enrolment ${status.toLowerCase()}. The learner has been notified with your reason.`,
      );
      list.refetch();
    },
  );

  const promptStatus = (id: string, status: 'SUSPENDED' | 'WITHDRAWN') => {
    const verb = status === 'SUSPENDED' ? 'suspending' : 'withdrawing';
    const reason = window.prompt(
      `Reason for ${verb} this enrolment (shown to the learner):`,
    );
    if (reason?.trim()) changeStatus.run(id, status, reason.trim());
  };

  return (
    <AdminShell title="Enrolments" subtitle="Applications and active enrolments">
      <div className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          {['', 'PENDING', 'ACTIVE', 'SUSPENDED', 'COMPLETED', 'WITHDRAWN', 'EXPIRED'].map((s) => (
            <button
              key={s || 'ALL'}
              onClick={() => setFilter(s)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                filter === s ? 'bg-primary text-white' : 'bg-white text-slate-700 border border-slate-300'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>

        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex-1 min-w-[220px]">
            <label htmlFor="enrol-search" className="block text-xs font-bold text-slate-600 mb-1">
              Search learner
            </label>
            <input
              id="enrol-search"
              className={inputClass}
              placeholder="Name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="min-w-[200px]">
            <label htmlFor="enrol-course" className="block text-xs font-bold text-slate-600 mb-1">
              Course
            </label>
            <select
              id="enrol-course"
              className={inputClass}
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
            >
              <option value="">All courses</option>
              {courseOptions.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <LiveRegion>
          {message && (
            <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
              {message}
            </p>
          )}
        </LiveRegion>

        {(activate.error || verifyDocs.error || changeStatus.error) && (
          <ErrorState error={(activate.error ?? verifyDocs.error ?? changeStatus.error)!} />
        )}

        {list.settled && !list.error && (
          <p className="text-xs text-slate-500">
            Showing {visible.length} of {list.data?.length ?? 0} enrolment(s)
            {filter ? ` · status ${statusLabel(filter)}` : ''}.
          </p>
        )}

        <Card>
          {list.loading && <Spinner />}
          {list.error && <ErrorState error={list.error} onRetry={list.refetch} />}
          {list.settled && !list.data?.length && (
            <EmptyState icon="how_to_reg" title="No enrolments" body="Applications appear here when learners apply for a course." />
          )}
          {list.settled && !!list.data?.length && !visible.length && (
            <EmptyState icon="search_off" title="No enrolments match" body="Adjust the search or course filter." />
          )}

          <ul className="divide-y divide-slate-100 -m-5 mt-0">
            {visible.map((e) => (
              <li key={e.id} className="px-5 py-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{e.profile?.full_name}</p>
                  <p className="text-xs text-slate-600">
                    {e.profile?.email}
                    {e.profile?.email && e.course?.title ? ' · ' : ''}
                    {e.course?.title}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">Applied {fmtDate(e.applied_at)}</p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <Badge tone={statusTone(e.status)}>{statusLabel(e.status)}</Badge>
                    <Badge tone={e.payment_cleared ? 'green' : 'amber'}>
                      {e.payment_cleared ? 'Fees cleared' : 'Fees outstanding'}
                    </Badge>
                    <Badge tone={e.documents_verified ? 'green' : 'amber'}>
                      {e.documents_verified ? 'Docs verified' : 'Docs outstanding'}
                    </Badge>
                    <span className="text-xs text-slate-500">
                      {e.modules_passed}/{e.modules_total} modules · {e.credits_earned} credits
                    </span>
                  </div>
                  {e.status_reason && ['SUSPENDED', 'WITHDRAWN', 'EXPIRED'].includes(e.status) && (
                    <p className="text-xs text-slate-600 mt-1">
                      <span className="font-semibold">Reason:</span> {e.status_reason}
                    </p>
                  )}
                </div>

                <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                  {!e.documents_verified && e.status !== 'WITHDRAWN' && e.status !== 'EXPIRED' && (
                    <Button size="sm" variant="secondary" loading={verifyDocs.running} onClick={() => verifyDocs.run(e.id)}>
                      Verify documents
                    </Button>
                  )}
                  {e.status === 'PENDING' && (
                    <Button size="sm" loading={activate.running} onClick={() => activate.run(e.id)}>
                      Activate
                    </Button>
                  )}
                  {e.status === 'ACTIVE' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={changeStatus.running}
                      onClick={() => promptStatus(e.id, 'SUSPENDED')}
                    >
                      Suspend
                    </Button>
                  )}
                  {e.status === 'SUSPENDED' && (
                    <Button
                      size="sm"
                      loading={changeStatus.running}
                      onClick={() => changeStatus.run(e.id, 'ACTIVE')}
                    >
                      Reinstate
                    </Button>
                  )}
                  {['PENDING', 'ACTIVE', 'SUSPENDED'].includes(e.status) && (
                    <Button
                      size="sm"
                      variant="danger"
                      loading={changeStatus.running}
                      onClick={() => promptStatus(e.id, 'WITHDRAWN')}
                    >
                      Withdraw
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AdminShell>
  );
}

/* ========================================================================== */
/* ENQUIRIES / AUDIT / SETTINGS                                                */
/* ========================================================================== */

export function MessagesPage() {
  const list = useAsync(() => api.listContactMessages(), []);
  const resolve = useAction(async (id: string) => {
    await api.setContactStatus(id, 'RESOLVED');
    list.refetch();
  });

  return (
    <AdminShell title="Enquiries" subtitle="Messages from the public contact form">
      <Card>
        {list.loading && <Spinner />}
        {list.error && <ErrorState error={list.error} onRetry={list.refetch} />}
        {list.settled && !list.data?.length && <EmptyState icon="mail" title="No enquiries yet" />}

        <ul className="divide-y divide-slate-100 -m-5 mt-0">
          {list.data?.map((m) => (
            <li key={m.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-900">{m.name}</p>
                    <Badge tone={m.status === 'NEW' ? 'amber' : 'green'}>{m.status}</Badge>
                  </div>
                  <p className="text-xs text-slate-600">
                    {m.email} · {fmtDateTime(m.created_at)}
                  </p>
                  {m.subject && <p className="text-sm font-semibold text-slate-800 mt-2">{m.subject}</p>}
                  <p className="text-sm text-slate-700 mt-1 whitespace-pre-line">{m.message}</p>
                </div>
                {m.status === 'NEW' && (
                  <Button size="sm" variant="secondary" loading={resolve.running} onClick={() => resolve.run(m.id)}>
                    Mark resolved
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </AdminShell>
  );
}

export function AuditPage() {
  const logs = useAsync(() => api.listAuditLogs(150), []);

  return (
    <AdminShell title="Audit log" subtitle="Append-only record of sensitive actions">
      <div className="rounded-xl border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700 mb-4">
        Audit entries cannot be edited or deleted by anyone, including administrators. The database
        grants no UPDATE or DELETE on this table.
      </div>

      <Card>
        {logs.loading && <Spinner />}
        {logs.error && <ErrorState error={logs.error} onRetry={logs.refetch} />}
        {logs.settled && !logs.data?.length && (
          <EmptyState icon="history" title="No audit entries yet" body="Entries appear as staff and learners act on the system." />
        )}

        {!!logs.data?.length && (
          <div className="overflow-x-auto -m-5 mt-0">
            <table className="w-full text-sm">
              <caption className="sr-only">Audit log entries</caption>
              <thead className="bg-slate-50 border-y border-slate-200">
                <tr>
                  <th scope="col" className="text-left font-bold text-slate-700 px-5 py-3">When</th>
                  <th scope="col" className="text-left font-bold text-slate-700 px-5 py-3">Actor</th>
                  <th scope="col" className="text-left font-bold text-slate-700 px-5 py-3">Action</th>
                  <th scope="col" className="text-left font-bold text-slate-700 px-5 py-3">Resource</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.data.map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 py-2.5 text-slate-600 whitespace-nowrap">{fmtDateTime(l.created_at)}</td>
                    <td className="px-5 py-2.5 text-slate-700">{l.actor_email ?? 'system'}</td>
                    <td className="px-5 py-2.5">
                      <span className="font-mono text-xs font-bold text-slate-800">{l.action}</span>
                    </td>
                    <td className="px-5 py-2.5 text-slate-600">
                      {l.resource_label ?? l.resource_type}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AdminShell>
  );
}

export function SettingsPage() {
  const settings = useAsync(() => api.getSettings(), []);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const save = useAction(async () => {
    await api.saveSettings({
      default_pass_mark: Number(form.default_pass_mark),
      min_cohort_size: Number(form.min_cohort_size),
      certificate_prefix: form.certificate_prefix,
      certificate_signatory_name: form.certificate_signatory_name,
      certificate_signatory_title: form.certificate_signatory_title,
    });
    setSaved(true);
    settings.refetch();
  });

  const s = settings.data;
  const value = (k: string, fallback: unknown) => form[k] ?? String(fallback ?? '');

  return (
    <AdminShell title="Settings" subtitle="Institution-wide policy">
      {settings.loading && <Spinner />}
      {settings.error && <ErrorState error={settings.error} onRetry={settings.refetch} />}

      {s && (
        <div className="max-w-2xl space-y-4">
          <LiveRegion>
            {saved && (
              <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
                Settings saved.
              </p>
            )}
          </LiveRegion>
          {save.error && <ErrorState error={save.error} />}

          <Card title="Academic policy">
            <div className="space-y-4">
              <Field label="Default pass mark (%)" hint="Used when a course or module does not set its own.">
                {(p) => (
                  <input
                    {...p}
                    type="number"
                    min={0}
                    max={100}
                    className={inputClass}
                    value={value('default_pass_mark', s.default_pass_mark)}
                    onChange={(e) => setForm({ ...form, default_pass_mark: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Minimum cohort size" hint="Drives the compliance warning on cohort planning.">
                {(p) => (
                  <input
                    {...p}
                    type="number"
                    min={1}
                    className={inputClass}
                    value={value('min_cohort_size', s.min_cohort_size)}
                    onChange={(e) => setForm({ ...form, min_cohort_size: e.target.value })}
                  />
                )}
              </Field>
            </div>
          </Card>

          <Card title="Certificates">
            <div className="space-y-4">
              <Field label="Certificate number prefix">
                {(p) => (
                  <input
                    {...p}
                    className={inputClass}
                    value={value('certificate_prefix', s.certificate_prefix)}
                    onChange={(e) => setForm({ ...form, certificate_prefix: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Signatory name">
                {(p) => (
                  <input
                    {...p}
                    className={inputClass}
                    value={value('certificate_signatory_name', s.certificate_signatory_name)}
                    onChange={(e) => setForm({ ...form, certificate_signatory_name: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Signatory title">
                {(p) => (
                  <input
                    {...p}
                    className={inputClass}
                    value={value('certificate_signatory_title', s.certificate_signatory_title)}
                    onChange={(e) => setForm({ ...form, certificate_signatory_title: e.target.value })}
                  />
                )}
              </Field>
            </div>
          </Card>

          <Card title="Upload limits">
            <dl className="grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">Learning resources</dt>
                <dd className="font-semibold text-slate-900">
                  {Math.round(s.max_resource_bytes / 1024 / 1024)} MB
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">Learner submissions</dt>
                <dd className="font-semibold text-slate-900">
                  {Math.round(s.max_submission_bytes / 1024 / 1024)} MB
                </dd>
              </div>
            </dl>
            <p className="text-xs text-slate-600 mt-3">
              File type and size limits are enforced by the database on upload, not only in the
              browser. Change them in the institution_settings table.
            </p>
          </Card>

          <Button size="lg" loading={save.running} onClick={() => save.run()}>
            Save settings
          </Button>
        </div>
      )}
    </AdminShell>
  );
}

/* ========================================================================== */
/* REPORTS                                                                     */
/* ========================================================================== */

export function ReportsPage() {
  const enrollments = useAsync(() => api.listEnrollments(), []);
  const certificates = useAsync(() => api.listCertificates(), []);
  const payments = useAsync(() => api.listPayments(), []);

  const toCsv = (rows: Record<string, unknown>[], name: string) => {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminShell title="Reports" subtitle="Database-backed exports">
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Learner progress" action={
          <Button size="sm" variant="secondary" onClick={() =>
            toCsv(
              (enrollments.data ?? []).map((e) => ({
                learner: e.profile?.full_name,
                email: e.profile?.email,
                course: e.course?.title,
                status: e.status,
                modules_passed: e.modules_passed,
                modules_total: e.modules_total,
                credits: e.credits_earned,
                progress_percent: e.progress_percent,
                final_exam_passed: e.final_exam_passed,
                completed: e.course_completed,
              })),
              'learner-progress',
            )
          }>
            Export CSV
          </Button>
        }>
          {enrollments.loading && <Spinner />}
          <p className="text-sm text-slate-700">
            {enrollments.data?.length ?? 0} enrolment(s).{' '}
            {enrollments.data?.filter((e) => e.course_completed).length ?? 0} learner(s) have
            completed their course.
          </p>
        </Card>

        <Card title="Certificates" action={
          <Button size="sm" variant="secondary" onClick={() =>
            toCsv(
              (certificates.data ?? []).map((c) => ({
                certificate_number: c.certificate_number,
                learner: c.learner_name,
                course: c.course_title,
                issued_at: c.issued_at,
                status: c.status,
                final_score: c.final_score,
              })),
              'certificates',
            )
          }>
            Export CSV
          </Button>
        }>
          {certificates.loading && <Spinner />}
          <p className="text-sm text-slate-700">
            {certificates.data?.filter((c) => c.status === 'ISSUED').length ?? 0} certificate(s)
            currently valid.
          </p>
        </Card>

        <Card title="Payments" action={
          <Button size="sm" variant="secondary" onClick={() =>
            toCsv(
              (payments.data ?? []).map((p) => ({
                learner: p.profile?.full_name,
                invoice: p.invoice?.invoice_number,
                amount: p.amount,
                method: p.method,
                status: p.status,
                submitted_at: p.submitted_at,
                reviewed_at: p.reviewed_at,
              })),
              'payments',
            )
          }>
            Export CSV
          </Button>
        }>
          {payments.loading && <Spinner />}
          <p className="text-sm text-slate-700">
            {payments.data?.filter((p) => p.status === 'APPROVED').length ?? 0} approved,{' '}
            {payments.data?.filter((p) => ['SUBMITTED', 'UNDER_REVIEW'].includes(p.status)).length ?? 0}{' '}
            awaiting review.
          </p>
        </Card>

        <Card title="Course completion">
          {enrollments.loading && <Spinner />}
          <ul className="space-y-2 text-sm">
            {Object.entries(
              (enrollments.data ?? []).reduce<Record<string, { total: number; done: number }>>((acc, e) => {
                const key = e.course?.title ?? 'Unknown';
                acc[key] = acc[key] ?? { total: 0, done: 0 };
                acc[key].total += 1;
                if (e.course_completed) acc[key].done += 1;
                return acc;
              }, {}),
            ).map(([course, v]) => (
              <li key={course} className="flex justify-between gap-3">
                <span className="text-slate-700 truncate">{course}</span>
                <span className="font-bold text-slate-900 shrink-0">
                  {v.done}/{v.total}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AdminShell>
  );
}

/* Re-exported helpers used by other admin page modules. */
export { fmtCurrency, fmtDate };
