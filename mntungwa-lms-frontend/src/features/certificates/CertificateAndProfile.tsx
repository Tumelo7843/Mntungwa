import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '@/layouts/Layouts';
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
  inputClass,
  statusLabel,
  statusTone,
} from '@/components/ui';
import { useAction, useAsync } from '@/hooks/useAsync';
import * as api from '@/services/lms';
import { useAuth } from '@/lib/auth';
import { useEnrollment } from '@/app/EnrollmentContext';
import type { Invoice } from '@/lib/database.types';

/* ========================================================================== */
/* CERTIFICATE                                                                 */
/* ========================================================================== */

export function CertificatePage() {
  const { enrollment } = useEnrollment();

  const eligibility = useAsync(
    async () => (enrollment ? api.checkCertificateEligibility(enrollment.id) : null),
    [enrollment?.id],
    { enabled: Boolean(enrollment) },
  );
  const certificate = useAsync(
    async () => (enrollment ? api.getMyCertificate(enrollment.id) : null),
    [enrollment?.id],
    { enabled: Boolean(enrollment) },
  );

  if (!enrollment) {
    return <AppShell title="Certificate"><EmptyState icon="workspace_premium" title="No active enrolment" /></AppShell>;
  }
  if (eligibility.loading || certificate.loading) {
    return <AppShell title="Certificate"><Spinner /></AppShell>;
  }
  if (eligibility.error) {
    return <AppShell title="Certificate"><ErrorState error={eligibility.error} onRetry={eligibility.refetch} /></AppShell>;
  }

  const cert = certificate.data;

  if (cert) {
    return (
      <AppShell title="Certificate">
        <div className="max-w-4xl space-y-5">
          <div className="flex flex-wrap items-center gap-3 no-print">
            <Button onClick={() => window.print()}>
              <Icon name="print" className="text-[18px]" />
              Print or save as PDF
            </Button>
            <Link
              to={`/verify/${encodeURIComponent(cert.certificate_number)}`}
              className="text-sm font-bold text-primary"
            >
              View public verification page
            </Link>
          </div>

          {/* Print layout carried over from the demo. */}
          <div className="print-page bg-white border-[6px] border-double border-primary p-8 sm:p-12 shadow-card">
            <div className="border border-primary-200 p-6 sm:p-10 text-center">
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-primary">
                Mntungwa IT Solution
              </p>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600 mt-1">
                QCTO Accredited Skills Development Provider
              </p>

              <p className="mt-10 text-sm text-slate-700">This is to certify that</p>
              <p className="mt-2 text-2xl sm:text-4xl font-black text-slate-900">{cert.learner_name}</p>
              <p className="mt-6 text-sm text-slate-700">has successfully completed</p>
              <p className="mt-2 text-lg sm:text-2xl font-extrabold text-primary">{cert.course_title}</p>

              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {cert.qualification_id && <Badge tone="slate">SAQA {cert.qualification_id}</Badge>}
                {cert.nqf_level && <Badge tone="slate">NQF Level {cert.nqf_level}</Badge>}
                {cert.credits_awarded != null && <Badge tone="slate">{cert.credits_awarded} Credits</Badge>}
              </div>

              <div className="mt-12 grid sm:grid-cols-3 gap-8 text-center">
                <div>
                  <div className="border-t border-slate-400 pt-2 text-xs font-semibold text-slate-700">
                    Date of issue
                  </div>
                  <p className="text-sm font-bold text-slate-900 mt-1">{fmtDate(cert.issued_at)}</p>
                </div>
                <div>
                  <div className="border-t border-slate-400 pt-2 text-xs font-semibold text-slate-700">
                    Certificate number
                  </div>
                  {/* Contrast raised from the demo's 10px slate-400 (audit A-05). */}
                  <p className="text-sm font-mono font-bold text-slate-800 mt-1 break-all">
                    {cert.certificate_number}
                  </p>
                </div>
                <div>
                  <div className="border-t border-slate-400 pt-2 text-xs font-semibold text-slate-700">
                    Head facilitator
                  </div>
                  <p className="text-sm font-bold text-slate-900 mt-1">Mntungwa IT Solution</p>
                </div>
              </div>

              <p className="mt-10 text-[11px] text-slate-700">
                Verify this certificate at {window.location.origin}/verify using the number above.
              </p>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  const v = eligibility.data;

  return (
    <AppShell title="Certificate">
      <div className="max-w-3xl space-y-6">
        <Card title="Certificate requirements">
          <p className="text-sm text-slate-600 mb-4">
            Your certificate is issued by the institution once every requirement below has been met.
            The system verifies each one; nothing here can be unlocked manually.
          </p>

          <ul className="space-y-2.5">
            {v?.checks.map((c) => (
              <li key={c.key} className="flex items-start gap-3">
                <Icon
                  name={c.passed ? 'check_circle' : 'radio_button_unchecked'}
                  className={c.passed ? 'text-emerald-600' : 'text-slate-400'}
                  fill={c.passed}
                />
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${c.passed ? 'text-slate-800' : 'text-slate-600'}`}>
                    {c.label}
                  </p>
                  {c.detail && <p className="text-xs text-slate-600">{c.detail}</p>}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6">
            {v?.eligible ? (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
                <p className="font-bold text-emerald-900 text-sm">All requirements met</p>
                <p className="text-sm text-emerald-800 mt-1">
                  Your certificate is ready to be issued. The institution will finalise it shortly and
                  you will be notified.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-300 bg-slate-50 p-4">
                <p className="font-bold text-slate-800 text-sm">Requirements outstanding</p>
                <p className="text-sm text-slate-700 mt-1">
                  Complete the items above to become eligible.
                </p>
                <Link to="/app/roadmap" className="inline-block mt-3 text-sm font-bold text-primary">
                  Go to roadmap
                </Link>
              </div>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

/* ========================================================================== */
/* PROFILE & PAYMENTS                                                          */
/* ========================================================================== */

/** Plain-language explanation of an enrolment status and the learner's next step. */
function enrollmentExplainer(status: string): { headline: string; next: string; tone: 'green' | 'amber' | 'red' | 'slate' } {
  switch (status) {
    case 'ACTIVE':
      return {
        headline: 'Your enrolment is active. You have full access to your course.',
        next: 'Continue from your course roadmap.',
        tone: 'green',
      };
    case 'PENDING':
      return {
        headline: 'Your application has been received and is awaiting activation.',
        next: 'Settle your invoice below and upload proof of payment. Finance activates your enrolment once a payment is verified.',
        tone: 'amber',
      };
    case 'SUSPENDED':
      return {
        headline: 'Your enrolment is currently suspended, so course content is locked.',
        next: 'See the reason below and contact the institution to resolve it. Access returns as soon as staff reinstate your enrolment.',
        tone: 'red',
      };
    case 'WITHDRAWN':
      return {
        headline: 'This enrolment has been withdrawn.',
        next: 'Contact the institution if you believe this is a mistake or wish to re-apply.',
        tone: 'red',
      };
    case 'EXPIRED':
      return {
        headline: 'This enrolment has expired.',
        next: 'Contact the institution about re-enrolling to complete the qualification.',
        tone: 'red',
      };
    case 'COMPLETED':
      return {
        headline: 'You have completed this course.',
        next: 'Check your certificate status.',
        tone: 'green',
      };
    default:
      return { headline: statusLabel(status), next: 'Contact the institution for details.', tone: 'slate' };
  }
}

export function ProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const { enrollment } = useEnrollment();
  const [form, setForm] = useState({
    full_name: profile?.full_name ?? '',
    preferred_name: profile?.preferred_name ?? '',
    phone: profile?.phone ?? '',
  });
  const [saved, setSaved] = useState(false);

  const invoices = useAsync(() => api.listMyInvoices(), []);
  const payments = useAsync(() => api.listMyPayments(), []);

  const save = useAction(async () => {
    await api.updateMyProfile({
      full_name: form.full_name,
      preferred_name: form.preferred_name || null,
      phone: form.phone || null,
    });
    await refreshProfile();
    setSaved(true);
  });

  return (
    <AppShell title="Profile & payments">
      <div className="max-w-3xl space-y-6">
        <Card title="Your details">
          <LiveRegion>
            {saved && (
              <p className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
                Your details have been updated.
              </p>
            )}
          </LiveRegion>
          {save.error && <div className="mb-4"><ErrorState error={save.error} /></div>}

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.run();
            }}
          >
            <Field label="Full name" required>
              {(p) => (
                <input
                  {...p}
                  className={inputClass}
                  required
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                />
              )}
            </Field>
            <Field label="Preferred name">
              {(p) => (
                <input
                  {...p}
                  className={inputClass}
                  value={form.preferred_name}
                  onChange={(e) => setForm({ ...form, preferred_name: e.target.value })}
                />
              )}
            </Field>
            <Field label="Phone number">
              {(p) => (
                <input
                  {...p}
                  type="tel"
                  className={inputClass}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              )}
            </Field>
            <Field label="Email address" hint="Contact the institution to change the address on your account.">
              {(p) => <input {...p} className={inputClass} value={profile?.email ?? ''} disabled />}
            </Field>

            <Button type="submit" loading={save.running}>
              Save changes
            </Button>
          </form>
        </Card>

        {enrollment && (
          <Card title="Enrolment status">
            {(() => {
              const x = enrollmentExplainer(enrollment.status);
              const box =
                x.tone === 'green'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : x.tone === 'amber'
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : x.tone === 'red'
                      ? 'border-red-300 bg-red-50 text-red-900'
                      : 'border-slate-300 bg-slate-50 text-slate-800';
              return (
                <div className={`mb-4 rounded-lg border p-4 ${box}`}>
                  <p className="text-sm font-bold">{x.headline}</p>
                  {enrollment.status_reason && (
                    <p className="text-sm mt-1">
                      <span className="font-semibold">Reason from the institution:</span>{' '}
                      {enrollment.status_reason}
                    </p>
                  )}
                  <p className="text-sm mt-2">{x.next}</p>
                </div>
              );
            })()}
            <dl className="grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">Course</dt>
                <dd className="font-semibold text-slate-900 mt-0.5">{enrollment.course.title}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">Status</dt>
                <dd className="mt-1">
                  <Badge tone={statusTone(enrollment.status)}>{statusLabel(enrollment.status)}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">Fees cleared</dt>
                <dd className="mt-1">
                  <Badge tone={enrollment.payment_cleared ? 'green' : 'amber'}>
                    {enrollment.payment_cleared ? 'Yes' : 'Awaiting payment'}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">Documents verified</dt>
                <dd className="mt-1">
                  <Badge tone={enrollment.documents_verified ? 'green' : 'amber'}>
                    {enrollment.documents_verified ? 'Yes' : 'Outstanding'}
                  </Badge>
                </dd>
              </div>
            </dl>
          </Card>
        )}

        <Card title="Invoices">
          {invoices.loading && <Spinner />}
          {invoices.error && <ErrorState error={invoices.error} onRetry={invoices.refetch} />}
          {invoices.settled && !invoices.data?.length && (
            <EmptyState
              icon="receipt_long"
              title="No invoices yet"
              body="An invoice appears here once the institution raises one for your enrolment."
            />
          )}
          <div className="space-y-3">
            {invoices.data?.map((inv) => (
              <InvoiceRow key={inv.id} invoice={inv} onPaid={() => { invoices.refetch(); payments.refetch(); }} />
            ))}
          </div>
        </Card>

        <Card title="Payment history">
          {payments.loading && <Spinner />}
          {payments.settled && !payments.data?.length && (
            <EmptyState icon="payments" title="No payments recorded" />
          )}
          <ul className="divide-y divide-slate-100 -m-5 mt-0">
            {payments.data?.map((p) => (
              <li key={p.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{fmtCurrency(p.amount)}</p>
                  <p className="text-xs text-slate-600">
                    {p.method} · {fmtDate(p.submitted_at)}
                    {p.reference && ` · ref ${p.reference}`}
                  </p>
                  {p.status === 'REJECTED' && p.rejection_reason && (
                    <p className="text-xs text-red-700 mt-1">{p.rejection_reason}</p>
                  )}
                </div>
                <Badge tone={statusTone(p.status)}>{statusLabel(p.status)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}

function InvoiceRow({ invoice, onPaid }: { invoice: Invoice; onPaid: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(invoice.total - invoice.amount_paid));
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [done, setDone] = useState(false);

  const pay = useAction(async () => {
    await api.declarePayment({
      invoiceId: invoice.id,
      amount: Number(amount),
      method: 'EFT',
      reference: reference || undefined,
      proof: proof ?? undefined,
    });
    setDone(true);
    setOpen(false);
    onPaid();
  });

  const outstanding = invoice.total - invoice.amount_paid;

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-bold text-slate-900">{invoice.invoice_number}</p>
          <p className="text-xs text-slate-600 mt-0.5">
            {invoice.description ?? 'Course fees'}
            {invoice.is_installment && ` · instalment ${invoice.installment_no} of ${invoice.installment_count}`}
          </p>
          <p className="text-xs text-slate-600">Due {fmtDate(invoice.due_at)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-extrabold text-slate-900">{fmtCurrency(invoice.total, invoice.currency)}</p>
          <Badge tone={statusTone(invoice.status)}>{statusLabel(invoice.status)}</Badge>
        </div>
      </div>

      {done && (
        <p className="mt-3 rounded-lg bg-emerald-50 border border-emerald-300 p-3 text-xs text-emerald-900">
          Payment submitted. Finance will verify it and your enrolment will be updated once approved.
        </p>
      )}

      {outstanding > 0 && !done && (
        <div className="mt-3">
          {!open ? (
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              Record a payment
            </Button>
          ) : (
            <div className="space-y-3 border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-600">
                Pay by EFT, then record the payment here and attach your proof of payment. Finance
                will verify it before your enrolment is activated.
              </p>

              <Field label="Amount paid" required>
                {(p) => (
                  <input
                    {...p}
                    type="number"
                    step="0.01"
                    min="0.01"
                    className={inputClass}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Your payment reference">
                {(p) => (
                  <input
                    {...p}
                    className={inputClass}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                )}
              </Field>

              <div>
                <label htmlFor={`proof-${invoice.id}`} className="block text-sm font-semibold text-slate-800">
                  Proof of payment
                </label>
                <input
                  id={`proof-${invoice.id}`}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-xs file:font-bold"
                  onChange={(e) => setProof(e.target.files?.[0] ?? null)}
                />
              </div>

              {pay.error && <ErrorState error={pay.error} />}

              <div className="flex gap-2">
                <Button size="sm" loading={pay.running} onClick={() => pay.run()}>
                  Submit payment
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
