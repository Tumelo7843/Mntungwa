import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PublicLayout } from '@/layouts/Layouts';
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
} from '@/components/ui';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/lib/auth';
import * as api from '@/services/lms';
import type { Course } from '@/lib/database.types';

export function HomePage() {
  const courses = useAsync(() => api.listPublishedCourses(), []);

  return (
    <PublicLayout>
      <section className="bg-primary text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-16 sm:py-24">
          <p className="text-primary-200 font-semibold uppercase tracking-widest text-xs">
            QCTO Accredited Skills Development Provider
          </p>
          <h1 className="mt-3 text-3xl sm:text-5xl font-black tracking-tight max-w-3xl">
            Occupational qualifications, assessed properly.
          </h1>
          <p className="mt-4 text-primary-100 max-w-2xl">
            Study at your own pace through structured modules, submit real evidence of your work,
            and have it assessed by registered assessors. Complete every requirement and your
            certificate is issued and independently verifiable.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/courses"
              className="bg-white text-primary font-bold px-5 py-3 rounded-lg text-sm hover:bg-primary-50"
            >
              Browse courses
            </Link>
            <Link
              to="/verify"
              className="border border-white/40 text-white font-bold px-5 py-3 rounded-lg text-sm hover:bg-white/10"
            >
              Verify a certificate
            </Link>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-8 py-14">
        <h2 className="text-xl font-extrabold text-slate-900">How the qualification works</h2>
        <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: 'menu_book', t: 'Study the material', d: 'Work through each module’s documents and lessons at your own pace.' },
            { icon: 'quiz', t: 'Check your knowledge', d: 'Formative assessments confirm you have understood before moving on.' },
            { icon: 'upload_file', t: 'Submit your evidence', d: 'Practical and workplace work is uploaded and marked by a registered assessor.' },
            { icon: 'workspace_premium', t: 'Earn your certificate', d: 'Pass every requirement and the final examination to be issued a certificate.' },
          ].map((s) => (
            <div key={s.t} className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <div className="rounded-lg bg-primary-50 text-primary p-2.5 w-fit">
                <Icon name={s.icon} />
              </div>
              <p className="font-bold text-slate-900 mt-3">{s.t}</p>
              <p className="text-sm text-slate-600 mt-1">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-8 pb-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-extrabold text-slate-900">Available courses</h2>
          <Link to="/courses" className="text-sm font-bold text-primary">
            View all
          </Link>
        </div>

        <div className="mt-5">
          {courses.loading && <Spinner label="Loading courses" />}
          {courses.error && <ErrorState error={courses.error} onRetry={courses.refetch} />}
          {courses.settled && !courses.error && !courses.data?.length && (
            <EmptyState
              icon="school"
              title="No courses published yet"
              body="Courses appear here once an administrator publishes them."
            />
          )}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {courses.data?.slice(0, 3).map((c) => (
              <CourseTile key={c.id} course={c} />
            ))}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

function CourseTile({ course }: { course: Course }) {
  return (
    <Link
      to={`/courses/${course.code}`}
      className="block bg-white rounded-xl border border-slate-200 shadow-card p-5 hover:border-primary transition-colors"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone="blue">{course.code}</Badge>
        {course.nqf_level && <Badge tone="slate">NQF {course.nqf_level}</Badge>}
        {course.total_credits && <Badge tone="slate">{course.total_credits} credits</Badge>}
      </div>
      <p className="font-bold text-slate-900 mt-3">{course.title}</p>
      {course.subtitle && <p className="text-xs text-slate-600 mt-0.5">{course.subtitle}</p>}
      <p className="text-sm text-slate-600 mt-2 line-clamp-3">{course.summary ?? course.description}</p>
      <p className="mt-4 text-sm font-extrabold text-primary">
        {course.price != null ? fmtCurrency(course.price) : 'Contact us for pricing'}
      </p>
    </Link>
  );
}

export function CatalogPage() {
  const courses = useAsync(() => api.listPublishedCourses(), []);

  return (
    <PublicLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-12">
        <h1 className="text-2xl font-extrabold text-slate-900">Courses</h1>
        <p className="text-sm text-slate-600 mt-1">
          Accredited occupational qualifications offered by Mntungwa IT Solution.
        </p>

        <div className="mt-8">
          {courses.loading && <Spinner label="Loading courses" />}
          {courses.error && <ErrorState error={courses.error} onRetry={courses.refetch} />}
          {courses.settled && !courses.error && !courses.data?.length && (
            <EmptyState icon="school" title="No courses published yet" />
          )}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {courses.data?.map((c) => (
              <CourseTile key={c.id} course={c} />
            ))}
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

export function CourseDetailPage() {
  const { code = '' } = useParams();
  const { session } = useAuth();
  const course = useAsync(() => api.getCourseByCode(code), [code]);
  const modules = useAsync(
    async () => (course.data ? api.listCourseModules(course.data.id) : []),
    [course.data?.id],
    { enabled: Boolean(course.data) },
  );

  if (course.loading) {
    return (
      <PublicLayout>
        <Spinner label="Loading course" />
      </PublicLayout>
    );
  }

  if (course.error) {
    return (
      <PublicLayout>
        <div className="max-w-3xl mx-auto px-4 py-12">
          <ErrorState error={course.error} onRetry={course.refetch} />
        </div>
      </PublicLayout>
    );
  }

  if (!course.data) {
    return (
      <PublicLayout>
        <div className="max-w-3xl mx-auto px-4 py-12">
          <EmptyState
            icon="search_off"
            title="Course not found"
            body="That course may have been unpublished."
            action={
              <Link to="/courses" className="text-sm font-bold text-primary">
                Back to courses
              </Link>
            }
          />
        </div>
      </PublicLayout>
    );
  }

  const c = course.data;

  return (
    <PublicLayout>
      <div className="bg-primary text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-12">
          <div className="flex gap-2 flex-wrap">
            <Badge tone="slate" className="!bg-white/15 !text-white !ring-white/25">
              {c.code}
            </Badge>
            {c.qualification_id && (
              <Badge tone="slate" className="!bg-white/15 !text-white !ring-white/25">
                SAQA {c.qualification_id}
              </Badge>
            )}
          </div>
          <h1 className="mt-3 text-3xl font-black">{c.title}</h1>
          {c.subtitle && <p className="mt-1 text-primary-100">{c.subtitle}</p>}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-10 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card title="About this qualification">
            <p className="text-sm text-slate-700 whitespace-pre-line">{c.description}</p>
          </Card>

          {c.outcomes.length > 0 && (
            <Card title="What you will be able to do">
              <ul className="space-y-2">
                {c.outcomes.map((o) => (
                  <li key={o} className="flex gap-2 text-sm text-slate-700">
                    <Icon name="check_circle" className="text-emerald-600 text-[18px] shrink-0" />
                    <span>{o}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {c.requirements.length > 0 && (
            <Card title="Entry requirements">
              <ul className="space-y-2">
                {c.requirements.map((r) => (
                  <li key={r} className="flex gap-2 text-sm text-slate-700">
                    <Icon name="arrow_right" className="text-slate-500 text-[18px] shrink-0" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={`Course structure${modules.data?.length ? ` (${modules.data.length} modules)` : ''}`}>
            {modules.loading && <Spinner label="Loading modules" />}
            {!modules.loading && !modules.data?.length && (
              <p className="text-sm text-slate-600">The module outline will be published shortly.</p>
            )}
            <ol className="divide-y divide-slate-100 -m-5 mt-0">
              {modules.data?.map((m) => (
                <li key={m.id} className="px-5 py-3 flex items-start gap-3">
                  <Badge tone="blue">{m.code}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">{m.title}</p>
                    {m.description && (
                      <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{m.description}</p>
                    )}
                  </div>
                  <span className="text-xs font-bold text-slate-500 shrink-0">{m.credits} cr</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <p className="text-2xl font-black text-slate-900">
              {c.price != null ? fmtCurrency(c.price) : 'Contact us'}
            </p>
            {c.price != null && (
              <p className="text-xs text-slate-600 mt-0.5">
                {c.price_includes_vat ? 'Includes VAT' : 'Excludes VAT'}
              </p>
            )}
            <dl className="mt-4 space-y-2 text-sm">
              {c.nqf_level && (
                <div className="flex justify-between">
                  <dt className="text-slate-600">NQF level</dt>
                  <dd className="font-semibold">{c.nqf_level}</dd>
                </div>
              )}
              {c.total_credits && (
                <div className="flex justify-between">
                  <dt className="text-slate-600">Credits</dt>
                  <dd className="font-semibold">{c.total_credits}</dd>
                </div>
              )}
              {c.duration_months && (
                <div className="flex justify-between">
                  <dt className="text-slate-600">Duration</dt>
                  <dd className="font-semibold">{c.duration_months} months</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-slate-600">Certificate</dt>
                <dd className="font-semibold">{c.issues_certificate ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
            <Link
              to={
                session
                  ? `/app/apply?course=${encodeURIComponent(c.code)}`
                  : `/register?course=${encodeURIComponent(c.code)}`
              }
              className="mt-5 block text-center bg-primary hover:bg-primary-700 text-white font-bold px-5 py-3 rounded-lg text-sm"
            >
              Apply to enrol
            </Link>
            {!session && (
              <p className="mt-2 text-center text-xs text-slate-500">
                You’ll create an account first, then confirm your enrolment.
              </p>
            )}
          </Card>
        </aside>
      </div>
    </PublicLayout>
  );
}

export function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', subject: '', message: '' });
  const [sent, setSent] = useState(false);
  const send = useAction(api.submitContactMessage);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await send.run(form);
    if (ok !== undefined) {
      setSent(true);
      setForm({ name: '', email: '', phone: '', subject: '', message: '' });
    }
  };

  return (
    <PublicLayout>
      <div className="max-w-2xl mx-auto px-4 sm:px-8 py-12">
        <h1 className="text-2xl font-extrabold text-slate-900">Contact us</h1>
        <p className="text-sm text-slate-600 mt-1">
          Send us a message and a member of our team will get back to you.
        </p>

        <Card className="mt-6">
          <LiveRegion>
            {sent && (
              <div className="mb-5 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 flex items-start gap-2">
                <Icon name="check_circle" className="text-[18px] mt-0.5" fill />
                <span>
                  Message sent. We have recorded your enquiry and will reply to the address you gave.
                </span>
              </div>
            )}
          </LiveRegion>

          {send.error && (
            <div className="mb-5">
              <ErrorState error={send.error} />
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Your name" required>
              {(p) => (
                <input
                  {...p}
                  className={inputClass}
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              )}
            </Field>
            <Field label="Email address" required>
              {(p) => (
                <input
                  {...p}
                  type="email"
                  className={inputClass}
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
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
            <Field label="Subject">
              {(p) => (
                <input
                  {...p}
                  className={inputClass}
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                />
              )}
            </Field>
            <Field label="Message" required hint="Up to 5000 characters.">
              {(p) => (
                <textarea
                  {...p}
                  rows={5}
                  maxLength={5000}
                  className={inputClass}
                  required
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                />
              )}
            </Field>

            <Button type="submit" loading={send.running} size="lg">
              Send message
            </Button>
          </form>
        </Card>
      </div>
    </PublicLayout>
  );
}

/** Public certificate verification (BR-010 / UC-CERT-003). */
export function VerifyCertificatePage() {
  const { certificateNumber } = useParams();
  const [params] = useSearchParams();
  const [number, setNumber] = useState(certificateNumber ?? '');
  const [query, setQuery] = useState(certificateNumber ?? '');

  const token = params.get('token') ?? undefined;
  const result = useAsync(
    async () => (query ? api.verifyCertificate(query, token) : null),
    [query, token],
    { enabled: Boolean(query) },
  );

  return (
    <PublicLayout>
      <div className="max-w-2xl mx-auto px-4 sm:px-8 py-12">
        <h1 className="text-2xl font-extrabold text-slate-900">Verify a certificate</h1>
        <p className="text-sm text-slate-600 mt-1">
          Enter the certificate number printed on the document to confirm it was issued by this
          institution and remains valid.
        </p>

        <Card className="mt-6">
          <form
            className="flex flex-col sm:flex-row gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(number.trim());
            }}
          >
            <div className="flex-1">
              <Field label="Certificate number">
                {(p) => (
                  <input
                    {...p}
                    className={inputClass}
                    placeholder="MIS-101869-2026-00017"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div className="sm:pt-7">
              <Button type="submit" size="lg" loading={result.loading}>
                Verify
              </Button>
            </div>
          </form>
        </Card>

        <LiveRegion>
          {result.loading && <Spinner label="Checking" />}
          {result.error && (
            <div className="mt-6">
              <ErrorState error={result.error} onRetry={result.refetch} />
            </div>
          )}

          {result.data && result.data.valid && (
            <div className="mt-6 rounded-xl border border-emerald-300 bg-emerald-50 p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-emerald-100 text-emerald-700 p-2">
                  <Icon name="verified" fill />
                </div>
                <div>
                  <p className="font-extrabold text-emerald-900">Valid certificate</p>
                  <p className="text-sm text-emerald-800">
                    Issued by Mntungwa IT Solution.
                  </p>
                </div>
              </div>
              <dl className="mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-emerald-800/70 font-semibold text-xs uppercase tracking-wide">Awarded to</dt>
                  <dd className="font-bold text-slate-900">{result.data.learner_name}</dd>
                </div>
                <div>
                  <dt className="text-emerald-800/70 font-semibold text-xs uppercase tracking-wide">Qualification</dt>
                  <dd className="font-bold text-slate-900">{result.data.course_title}</dd>
                </div>
                <div>
                  <dt className="text-emerald-800/70 font-semibold text-xs uppercase tracking-wide">Certificate number</dt>
                  <dd className="font-mono text-slate-900">{result.data.certificate_number}</dd>
                </div>
                <div>
                  <dt className="text-emerald-800/70 font-semibold text-xs uppercase tracking-wide">Date of issue</dt>
                  <dd className="font-bold text-slate-900">{fmtDate(result.data.issued_at)}</dd>
                </div>
                {result.data.nqf_level && (
                  <div>
                    <dt className="text-emerald-800/70 font-semibold text-xs uppercase tracking-wide">NQF level</dt>
                    <dd className="font-bold text-slate-900">{result.data.nqf_level}</dd>
                  </div>
                )}
                {result.data.credits != null && (
                  <div>
                    <dt className="text-emerald-800/70 font-semibold text-xs uppercase tracking-wide">Credits</dt>
                    <dd className="font-bold text-slate-900">{result.data.credits}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {result.data && !result.data.valid && (
            <div className="mt-6 rounded-xl border border-red-300 bg-red-50 p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-red-100 text-red-700 p-2">
                  <Icon name="gpp_bad" fill />
                </div>
                <div>
                  <p className="font-extrabold text-red-900">
                    {result.data.reason === 'REVOKED' ? 'Certificate revoked' : 'No matching certificate'}
                  </p>
                  <p className="text-sm text-red-800 mt-0.5">
                    {result.data.reason === 'REVOKED'
                      ? `This certificate was revoked on ${fmtDate(result.data.revoked_at)} and is no longer valid.`
                      : 'We could not find a certificate with that number. Check the number and try again.'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </LiveRegion>
      </div>
    </PublicLayout>
  );
}

export function NotFoundPage() {
  return (
    <PublicLayout>
      <div className="max-w-xl mx-auto px-4 py-20">
        <EmptyState
          icon="explore_off"
          title="Page not found"
          body="The page you were looking for does not exist or has moved."
          action={
            <Link
              to="/"
              className="inline-block bg-primary hover:bg-primary-700 text-white font-bold px-5 py-2.5 rounded-lg text-sm"
            >
              Back to home
            </Link>
          }
        />
      </div>
    </PublicLayout>
  );
}
