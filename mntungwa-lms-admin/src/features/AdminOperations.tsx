import { useState } from 'react';
import { AdminShell } from '@/layouts/AdminShell';
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
  fmtCurrency,
  fmtDate,
  fmtDateTime,
  inputClass,
  statusLabel,
  statusTone,
} from '@/components/ui';
import { useAction, useAsync } from '@/hooks/useAsync';
import * as api from '@/services/admin';

/* ========================================================================== */
/* CERTIFICATES                                                                */
/* ========================================================================== */

export function CertificatesPage() {
  const issued = useAsync(() => api.listCertificates(), []);
  const completed = useAsync(() => api.listEnrollments('COMPLETED'), []);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);

  const check = useAsync(
    async () => (checking ? api.checkCertificateEligibility(checking) : null),
    [checking],
    { enabled: Boolean(checking) },
  );

  const issue = useAction(async (enrollmentId: string) => {
    await api.issueCertificate(enrollmentId);
    setMessage('Certificate issued. The learner has been notified.');
    issued.refetch();
    completed.refetch();
    setChecking(null);
  });

  const revoke = useAction(async (id: string, reason: string) => {
    await api.revokeCertificate(id, reason);
    setMessage('Certificate revoked.');
    issued.refetch();
  });

  const withoutCertificate = (completed.data ?? []).filter(
    (e) => !(issued.data ?? []).some((c) => c.enrollment_id === e.id && c.status === 'ISSUED'),
  );

  return (
    <AdminShell title="Certificates" subtitle="Issue and manage learner certificates">
      <div className="space-y-4">
        <div className="rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-800">
          <p className="font-bold">Issuance is verified by the database</p>
          <p className="mt-1">
            Every requirement is re-checked inside the same transaction that writes the certificate.
            If anything is outstanding, issuance is refused — including for administrators.
          </p>
        </div>

        <LiveRegion>
          {message && (
            <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
              {message}
            </p>
          )}
        </LiveRegion>

        {(issue.error || revoke.error) && <ErrorState error={(issue.error ?? revoke.error)!} />}

        <Card title="Awaiting issue">
          {completed.loading && <Spinner />}
          {completed.settled && !withoutCertificate.length && (
            <EmptyState icon="task_alt" title="Nothing awaiting issue" body="Learners appear here once they complete every requirement." />
          )}

          <ul className="divide-y divide-slate-100 -m-5 mt-0">
            {withoutCertificate.map((e) => (
              <li key={e.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-semibold text-slate-900">{e.profile?.full_name}</p>
                    <p className="text-xs text-slate-600">{e.course?.title}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {e.modules_passed}/{e.modules_total} modules · {e.credits_earned} credits
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setChecking(checking === e.id ? null : e.id)}>
                      Check eligibility
                    </Button>
                    <Button size="sm" loading={issue.running} onClick={() => issue.run(e.id)}>
                      Issue certificate
                    </Button>
                  </div>
                </div>

                {checking === e.id && (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    {check.loading && <Spinner label="Checking requirements" />}
                    {check.error && <ErrorState error={check.error} />}
                    {check.data && (
                      <ul className="space-y-2">
                        {check.data.checks.map((c) => (
                          <li key={c.key} className="flex items-start gap-2.5">
                            <Icon
                              name={c.passed ? 'check_circle' : 'cancel'}
                              className={c.passed ? 'text-emerald-600 text-[18px]' : 'text-red-600 text-[18px]'}
                              fill
                            />
                            <div>
                              <p className="text-sm font-semibold text-slate-800">{c.label}</p>
                              {c.detail && <p className="text-xs text-slate-600">{c.detail}</p>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card title={`Issued certificates (${issued.data?.length ?? 0})`}>
          {issued.loading && <Spinner />}
          {issued.error && <ErrorState error={issued.error} onRetry={issued.refetch} />}
          {issued.settled && !issued.data?.length && (
            <EmptyState icon="workspace_premium" title="No certificates issued yet" />
          )}

          <ul className="divide-y divide-slate-100 -m-5 mt-0">
            {issued.data?.map((c) => (
              <li key={c.id} className="px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{c.learner_name}</p>
                  <p className="text-xs font-mono text-slate-600">{c.certificate_number}</p>
                  <p className="text-xs text-slate-500">
                    {c.course_title} · issued {fmtDate(c.issued_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                  {c.status === 'ISSUED' && (
                    <Button
                      size="sm"
                      variant="danger"
                      loading={revoke.running}
                      onClick={() => {
                        const reason = window.prompt('Reason for revoking this certificate:');
                        if (reason?.trim()) revoke.run(c.id, reason.trim());
                      }}
                    >
                      Revoke
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
/* PAYMENTS                                                                    */
/* ========================================================================== */

export function PaymentsPage() {
  const [filter, setFilter] = useState('SUBMITTED');
  const payments = useAsync(() => api.listPayments(filter || undefined), [filter]);
  const [message, setMessage] = useState<string | null>(null);

  const review = useAction(async (id: string, approve: boolean, reason?: string) => {
    await api.reviewPayment(id, approve, reason);
    setMessage(
      approve
        ? 'Payment approved. The enrolment has been activated and the first module opened.'
        : 'Payment rejected. The learner has been notified with your reason.',
    );
    payments.refetch();
  });

  return (
    <AdminShell title="Payments" subtitle="Verify proof of payment">
      <div className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          {['SUBMITTED', 'APPROVED', 'REJECTED', ''].map((s) => (
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

        <LiveRegion>
          {message && (
            <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
              {message}
            </p>
          )}
        </LiveRegion>

        {review.error && <ErrorState error={review.error} />}

        <Card>
          {payments.loading && <Spinner />}
          {payments.error && <ErrorState error={payments.error} onRetry={payments.refetch} />}
          {payments.settled && !payments.data?.length && (
            <EmptyState icon="payments" title="Nothing to review" body="Payments appear here when learners record them." />
          )}

          <ul className="divide-y divide-slate-100 -m-5 mt-0">
            {payments.data?.map((p) => (
              <li key={p.id} className="px-5 py-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{fmtCurrency(p.amount)}</p>
                  <p className="text-sm text-slate-700">{p.profile?.full_name}</p>
                  <p className="text-xs text-slate-600">
                    {p.invoice?.invoice_number} · {p.method}
                    {p.reference && ` · ref ${p.reference}`} · {fmtDateTime(p.submitted_at)}
                  </p>
                  <Badge tone={statusTone(p.status)} className="mt-2">
                    {statusLabel(p.status)}
                  </Badge>
                  {p.rejection_reason && (
                    <p className="text-xs text-red-700 mt-1">{p.rejection_reason}</p>
                  )}
                </div>

                {['SUBMITTED', 'UNDER_REVIEW'].includes(p.status) && (
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="danger"
                      loading={review.running}
                      onClick={() => {
                        const reason = window.prompt('Why is this payment being rejected?');
                        if (reason?.trim()) review.run(p.id, false, reason.trim());
                      }}
                    >
                      Reject
                    </Button>
                    <Button size="sm" variant="success" loading={review.running} onClick={() => review.run(p.id, true)}>
                      Approve
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AdminShell>
  );
}

export function InvoicesPage() {
  const invoices = useAsync(() => api.listInvoices(), []);
  const enrollments = useAsync(() => api.listEnrollments(), []);
  const [form, setForm] = useState({ enrollmentId: '', total: '', description: 'Course fees' });
  const [message, setMessage] = useState<string | null>(null);

  const create = useAction(async () => {
    const e = enrollments.data?.find((x) => x.id === form.enrollmentId);
    if (!e) return;
    await api.createInvoice({
      profileId: e.profile_id,
      enrollmentId: e.id,
      courseId: e.course_id,
      total: Number(form.total),
      vatRate: 0.15,
      description: form.description,
    });
    setMessage('Invoice raised. The learner can now record a payment against it.');
    setForm({ enrollmentId: '', total: '', description: 'Course fees' });
    invoices.refetch();
  });

  return (
    <AdminShell title="Invoices">
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Raise an invoice">
          <LiveRegion>
            {message && (
              <p className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
                {message}
              </p>
            )}
          </LiveRegion>
          {create.error && <div className="mb-4"><ErrorState error={create.error} /></div>}

          <div className="space-y-4">
            <Field label="Enrolment" required>
              {(p) => (
                <select
                  {...p}
                  className={inputClass}
                  value={form.enrollmentId}
                  onChange={(e) => setForm({ ...form, enrollmentId: e.target.value })}
                >
                  <option value="">Choose a learner</option>
                  {enrollments.data?.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.profile?.full_name} — {e.course?.code}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Total including VAT" required>
              {(p) => (
                <input
                  {...p}
                  type="number"
                  step="0.01"
                  min="0"
                  className={inputClass}
                  value={form.total}
                  onChange={(e) => setForm({ ...form, total: e.target.value })}
                />
              )}
            </Field>
            <Field label="Description">
              {(p) => (
                <input
                  {...p}
                  className={inputClass}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              )}
            </Field>
            <Button loading={create.running} disabled={!form.enrollmentId || !form.total} onClick={() => create.run()}>
              Raise invoice
            </Button>
          </div>
        </Card>

        <Card title={`Invoices (${invoices.data?.length ?? 0})`}>
          {invoices.loading && <Spinner />}
          {invoices.settled && !invoices.data?.length && (
            <EmptyState icon="receipt_long" title="No invoices yet" />
          )}
          <ul className="divide-y divide-slate-100 -m-5 mt-0">
            {invoices.data?.map((inv) => (
              <li key={inv.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{inv.invoice_number}</p>
                  <p className="text-xs text-slate-600">{inv.profile?.full_name}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-slate-900">{fmtCurrency(inv.total, inv.currency)}</p>
                  <Badge tone={statusTone(inv.status)}>{statusLabel(inv.status)}</Badge>
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
/* FINAL EXAMS                                                                 */
/* ========================================================================== */

export function FinalExamsPage() {
  const exams = useAsync(() => api.listFinalExams(), []);
  const attempts = useAsync(() => api.listExamAttempts(), []);

  return (
    <AdminShell title="Final exams" subtitle="High-stakes assessment and attempts">
      <div className="space-y-4">
        <Card title="Examinations">
          {exams.loading && <Spinner />}
          {exams.error && <ErrorState error={exams.error} onRetry={exams.refetch} />}
          {exams.settled && !exams.data?.length && (
            <EmptyState
              icon="fact_check"
              title="No final exam configured"
              body="Each course may have one final examination. Add one through the backend seed or a future exam builder."
            />
          )}
          <ul className="divide-y divide-slate-100 -m-5 mt-0">
            {exams.data?.map((e) => (
              <li key={e.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-semibold text-slate-900">{e.title}</p>
                    <p className="text-xs text-slate-600">{e.course?.title}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {e.duration_minutes} minutes · pass mark {e.pass_mark}% · {e.max_attempts} attempts
                      {e.questions_per_attempt && ` · ${e.questions_per_attempt} questions drawn per attempt`}
                    </p>
                  </div>
                  <Badge tone={e.publication_status === 'PUBLISHED' ? 'green' : 'slate'}>
                    {e.publication_status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Recent attempts">
          {attempts.loading && <Spinner />}
          {attempts.settled && !attempts.data?.length && (
            <EmptyState icon="history" title="No attempts yet" />
          )}
          <ul className="divide-y divide-slate-100 -m-5 mt-0">
            {attempts.data?.map((a) => (
              <li key={a.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {a.enrollment?.profile?.full_name}
                  </p>
                  <p className="text-xs text-slate-600">
                    Attempt {a.attempt_number} · started {fmtDateTime(a.started_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {a.score_percent != null && (
                    <span className="text-sm font-bold text-slate-900">
                      {Number(a.score_percent).toFixed(0)}%
                    </span>
                  )}
                  <Badge tone={a.passed == null ? 'slate' : a.passed ? 'green' : 'red'}>
                    {a.passed == null ? a.status : a.passed ? 'Passed' : 'Not yet competent'}
                  </Badge>
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
/* ANNOUNCEMENTS                                                               */
/* ========================================================================== */

export function AnnouncementsPage() {
  const list = useAsync(() => api.listAnnouncements(), []);
  const [form, setForm] = useState({ title: '', body: '' });
  const [message, setMessage] = useState<string | null>(null);

  const create = useAction(async () => {
    await api.saveAnnouncement({
      title: form.title.trim(),
      body: form.body.trim(),
      audience_roles: [],
      publication_status: 'PUBLISHED',
      publish_at: new Date().toISOString(),
    });
    setMessage('Announcement published.');
    setForm({ title: '', body: '' });
    list.refetch();
  });

  return (
    <AdminShell title="Announcements">
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="New announcement">
          <LiveRegion>
            {message && (
              <p className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
                {message}
              </p>
            )}
          </LiveRegion>
          {create.error && <div className="mb-4"><ErrorState error={create.error} /></div>}

          <div className="space-y-4">
            <Field label="Title" required>
              {(p) => <input {...p} className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
            </Field>
            <Field label="Message" required>
              {(p) => <textarea {...p} rows={5} className={inputClass} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />}
            </Field>
            <Button loading={create.running} disabled={!form.title.trim() || !form.body.trim()} onClick={() => create.run()}>
              Publish announcement
            </Button>
          </div>
        </Card>

        <Card title={`Published (${list.data?.length ?? 0})`}>
          {list.loading && <Spinner />}
          {list.settled && !list.data?.length && <EmptyState icon="campaign" title="No announcements yet" />}
          <ul className="divide-y divide-slate-100 -m-5 mt-0">
            {list.data?.map((a) => (
              <li key={a.id} className="px-5 py-3">
                <p className="text-sm font-semibold text-slate-900">{a.title}</p>
                <p className="text-xs text-slate-600 mt-0.5">{fmtDateTime(a.publish_at)}</p>
                <p className="text-sm text-slate-700 mt-1 line-clamp-2">{a.body}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AdminShell>
  );
}
