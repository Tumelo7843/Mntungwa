import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AppShell } from '@/layouts/Layouts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  LiveRegion,
  Spinner,
  fmtCurrency,
  statusLabel,
  statusTone,
} from '@/components/ui';
import { useAction, useAsync } from '@/hooks/useAsync';
import * as api from '@/services/lms';
import { useEnrollment } from '@/app/EnrollmentContext';
import type { Course, Enrollment } from '@/lib/database.types';

type MyEnrolment = Enrollment & { course: Course };

/**
 * Course application (UC-ADMIN-001 learner half).
 *
 * The learner picks a published course and submits an application. The insert
 * goes through the `enrollments_apply_own` RLS policy, which pins the row to
 * status PENDING with every privileged flag false — the client cannot apply as
 * anything other than a pending applicant. The unique constraint
 * `enrollments_unique_per_course` makes a second application for the same course
 * a no-op that surfaces as a friendly "already applied" message rather than a
 * duplicate row.
 *
 * After a successful application the shared EnrollmentContext is refetched so
 * the dashboard, profile and nav reflect the new PENDING enrolment immediately,
 * without a manual refresh.
 */
export function ApplyPage() {
  const [params] = useSearchParams();
  const preselectCode = params.get('course')?.trim() || null;
  const navigate = useNavigate();

  const { enrollment, refetch: refetchEnrollment } = useEnrollment();

  const courses = useAsync(() => api.listPublishedCourses(), []);
  const mine = useAsync(() => api.listMyEnrollments(), []);

  const [submittedCourseId, setSubmittedCourseId] = useState<string | null>(null);

  const apply = useAction(async (course: Course) => {
    await api.applyForCourse(course.id);
    setSubmittedCourseId(course.id);
    // Refresh both this page's list and the app-wide enrolment state.
    mine.refetch();
    refetchEnrollment();
  });

  const enrolmentByCourse = useMemo(() => {
    const map = new Map<string, MyEnrolment>();
    for (const e of (mine.data ?? []) as MyEnrolment[]) map.set(e.course_id, e);
    return map;
  }, [mine.data]);

  const loading = courses.loading || mine.loading;
  const error = courses.error ?? mine.error;

  if (loading) {
    return (
      <AppShell title="Apply for a course">
        <Spinner label="Loading the course catalogue" />
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell title="Apply for a course">
        <ErrorState
          error={error}
          onRetry={() => {
            courses.refetch();
            mine.refetch();
          }}
        />
      </AppShell>
    );
  }

  const list = courses.data ?? [];
  // Show the preselected course first, then the rest by title.
  const ordered = [...list].sort((a, b) => {
    if (preselectCode) {
      if (a.code === preselectCode) return -1;
      if (b.code === preselectCode) return 1;
    }
    return a.title.localeCompare(b.title);
  });

  const openToApply = ordered.filter((c) => !enrolmentByCourse.has(c.id));

  return (
    <AppShell title="Apply for a course">
      <div className="max-w-3xl space-y-6">
        <p className="text-sm text-slate-600">
          Choose a course and submit your application. Once you have applied, the institution raises
          an invoice; your enrolment is activated after your payment is verified. You can track the
          status any time on your{' '}
          <Link to="/app/profile" className="font-semibold text-primary">
            profile page
          </Link>
          .
        </p>

        <LiveRegion>
          {apply.error && apply.error.kind === 'CONFLICT' && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              You have already applied for that course. Its current status is shown below.
            </div>
          )}
        </LiveRegion>
        {apply.error && apply.error.kind !== 'CONFLICT' && <ErrorState error={apply.error} />}

        {submittedCourseId && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5">
            <div className="flex items-start gap-3">
              <Icon name="check_circle" className="text-emerald-700 mt-0.5" fill />
              <div>
                <p className="font-bold text-emerald-900">Application submitted</p>
                <p className="text-sm text-emerald-800 mt-1">
                  Your application is now <strong>pending</strong>. The next step is to settle the
                  invoice the institution raises for your enrolment and upload your proof of payment.
                  Finance activates your enrolment once the payment is verified.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => navigate('/app')}>
                    Go to dashboard
                  </Button>
                  <Link
                    to="/app/profile"
                    className="inline-flex items-center rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-900"
                  >
                    View enrolment &amp; invoices
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {enrollment && enrollment.status === 'ACTIVE' && (
          <div className="rounded-lg border border-primary-200 bg-primary-50 p-4 text-sm text-primary-800">
            You have an active enrolment on <strong>{enrollment.course.title}</strong>. Applying for
            an additional course is allowed, but you study one course at a time.
          </div>
        )}

        {!list.length && (
          <EmptyState
            icon="school"
            title="No courses are published yet"
            body="Courses appear here once an administrator publishes them. Check back soon."
          />
        )}

        {!!list.length && !openToApply.length && !submittedCourseId && (
          <EmptyState
            icon="task_alt"
            title="You have applied for every available course"
            body="Track each application's status on your profile page."
            action={
              <Link to="/app/profile" className="text-sm font-bold text-primary">
                View my enrolments
              </Link>
            }
          />
        )}

        <div className="space-y-4">
          {ordered.map((c) => {
            const existing = enrolmentByCourse.get(c.id);
            const isPreselected = preselectCode != null && c.code === preselectCode;
            return (
              <Card
                key={c.id}
                className={isPreselected && !existing ? 'ring-2 ring-primary' : undefined}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge tone="blue">{c.code}</Badge>
                      {c.nqf_level && <Badge tone="slate">NQF {c.nqf_level}</Badge>}
                      {c.total_credits && <Badge tone="slate">{c.total_credits} credits</Badge>}
                    </div>
                    <p className="font-bold text-slate-900 mt-2">{c.title}</p>
                    {c.subtitle && <p className="text-xs text-slate-600 mt-0.5">{c.subtitle}</p>}
                    <p className="text-sm text-slate-600 mt-2 line-clamp-2">
                      {c.summary ?? c.description}
                    </p>
                    <p className="mt-3 text-sm font-extrabold text-primary">
                      {c.price != null ? fmtCurrency(c.price) : 'Contact us for pricing'}
                    </p>
                  </div>

                  <div className="shrink-0">
                    {existing ? (
                      <div className="text-right">
                        <Badge tone={statusTone(existing.status)}>
                          {statusLabel(existing.status)}
                        </Badge>
                        <p className="mt-2">
                          <Link
                            to="/app/profile"
                            className="text-xs font-bold text-primary"
                          >
                            View status
                          </Link>
                        </p>
                      </div>
                    ) : (
                      <Button
                        loading={apply.running}
                        onClick={() => apply.run(c)}
                        aria-label={`Apply for ${c.title}`}
                      >
                        Apply for this course
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        <p className="text-xs text-slate-500">
          Browsing details first?{' '}
          <Link to="/courses" className="font-semibold text-primary">
            View the full course catalogue
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}
