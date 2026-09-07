import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '@/layouts/Layouts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  LiveRegion,
  ProgressBar,
  Spinner,
  StatCard,
  fileIcon,
  fmtBytes,
  statusLabel,
  statusTone,
} from '@/components/ui';
import { useAction, useAsync } from '@/hooks/useAsync';
import * as api from '@/services/lms';
import type { LearningResource } from '@/lib/database.types';
import { useEnrollment } from '@/app/EnrollmentContext';

/** Opens a private document via a short-lived signed URL. */
function ResourceLink({ resource }: { resource: LearningResource }) {
  const open = useAction(async () => {
    const url = await api.getResourceUrl(resource);
    window.open(url, '_blank', 'noopener,noreferrer');
  });

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <div className="rounded-lg bg-slate-100 text-slate-600 p-2 shrink-0">
        <Icon name={fileIcon(resource.mime_type)} className="text-[20px]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 truncate">{resource.title}</p>
        <p className="text-xs text-slate-600">
          {resource.file_name} · {fmtBytes(resource.file_size_bytes)}
          {resource.version > 1 && ` · v${resource.version}`}
        </p>
        {open.error && <p className="text-xs text-red-700 mt-1">{open.error.message}</p>}
      </div>
      <Button
        variant="secondary"
        size="sm"
        loading={open.running}
        onClick={() => open.run()}
        aria-label={`Open ${resource.title}`}
      >
        <Icon name="open_in_new" className="text-[16px]" />
        Open
      </Button>
    </li>
  );
}

export function DashboardPage() {
  const { enrollment, loading, error, refetch } = useEnrollment();

  const roadmap = useAsync(
    async () => (enrollment ? api.getRoadmap(enrollment) : []),
    [enrollment?.id],
    { enabled: Boolean(enrollment) },
  );
  const grades = useAsync(
    async () => (enrollment ? api.listMyGrades(enrollment.id) : []),
    [enrollment?.id],
    { enabled: Boolean(enrollment) },
  );

  if (loading) return <AppShell title="Dashboard"><Spinner /></AppShell>;
  if (error) return <AppShell title="Dashboard"><ErrorState error={error} onRetry={refetch} /></AppShell>;

  if (!enrollment) {
    return (
      <AppShell title="Dashboard">
        <EmptyState
          icon="school"
          title="You are not enrolled on a course yet"
          body="Apply for a course to get started. Once your enrolment is activated your learning material will appear here."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/app/apply" className="inline-block bg-primary hover:bg-primary-700 text-white font-bold px-5 py-2.5 rounded-lg text-sm">
                Apply for a course
              </Link>
              <Link to="/courses" className="inline-block bg-white border border-slate-300 text-slate-800 font-bold px-5 py-2.5 rounded-lg text-sm">
                Browse the catalogue
              </Link>
            </div>
          }
        />
      </AppShell>
    );
  }

  const current = roadmap.data ? api.currentModule(roadmap.data) : null;
  const pending = enrollment.status !== 'ACTIVE';

  return (
    <AppShell title="Dashboard">
      <div className="space-y-6">
        {pending && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 flex items-start gap-3">
            <Icon name="hourglass_top" className="text-amber-700 mt-0.5" />
            <div>
              <p className="font-bold text-amber-900">Your enrolment is {statusLabel(enrollment.status)}</p>
              <p className="text-sm text-amber-800 mt-1">
                Learning material unlocks once your fees are cleared and your documents are verified.
                You can track this on your profile page.
              </p>
              <Link to="/app/profile" className="inline-block mt-3 text-sm font-bold text-amber-900 underline">
                View payment status
              </Link>
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Enrolled on</p>
          <h2 className="text-xl font-extrabold text-slate-900 mt-0.5">{enrollment.course.title}</h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon="donut_large" label="Progress" value={`${Math.round(enrollment.progress_percent)}%`} sub={`${enrollment.modules_passed} of ${enrollment.modules_total} modules`} />
          <StatCard icon="military_tech" label="Credits earned" value={enrollment.credits_earned} sub={enrollment.course.total_credits ? `of ${enrollment.course.total_credits}` : undefined} tone="text-violet-700 bg-violet-50" />
          <StatCard icon="fact_check" label="Final examination" value={enrollment.final_exam_passed ? 'Passed' : 'Outstanding'} tone={enrollment.final_exam_passed ? 'text-emerald-700 bg-emerald-50' : 'text-slate-600 bg-slate-100'} />
          <StatCard icon="workspace_premium" label="Certificate" value={enrollment.course_completed ? 'Ready' : 'Locked'} tone={enrollment.course_completed ? 'text-emerald-700 bg-emerald-50' : 'text-slate-600 bg-slate-100'} />
        </div>

        <Card title="Overall completion">
          <ProgressBar pct={enrollment.progress_percent} h="h-3" label="Course completion" />
          <p className="text-xs text-slate-600 mt-2">
            Every required module must be passed before the final examination becomes available.
          </p>
        </Card>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card title="Continue where you left off">
            {roadmap.loading && <Spinner />}
            {roadmap.error && <ErrorState error={roadmap.error} onRetry={roadmap.refetch} />}
            {roadmap.settled && !current && !roadmap.error && (
              <EmptyState
                icon="check_circle"
                title={enrollment.course_completed ? 'All modules complete' : 'Nothing open yet'}
                body={
                  enrollment.course_completed
                    ? 'You have completed every module on this course.'
                    : 'Your first module opens as soon as your enrolment is active.'
                }
              />
            )}
            {current && (
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone="blue">{current.module.code}</Badge>
                  <Badge tone={statusTone(current.progress?.status ?? 'LOCKED')}>
                    {statusLabel(current.progress?.status ?? 'LOCKED')}
                  </Badge>
                </div>
                <p className="font-bold text-slate-900 mt-3">{current.module.title}</p>
                <p className="text-sm text-slate-600 mt-1 line-clamp-2">{current.module.description}</p>
                <Link
                  to={`/app/modules/${current.module.id}`}
                  className="mt-4 inline-flex items-center gap-2 bg-primary hover:bg-primary-700 text-white font-bold px-4 py-2.5 rounded-lg text-sm"
                >
                  Open module
                  <Icon name="arrow_forward" className="text-[18px]" />
                </Link>
              </div>
            )}
          </Card>

          <Card title="Recent results" action={<Link to="/app/results" className="text-xs font-bold text-primary">View all</Link>}>
            {grades.loading && <Spinner />}
            {grades.settled && !grades.data?.length && (
              <EmptyState icon="grading" title="No results released yet" body="Results appear here once an assessor has marked and released them." />
            )}
            <ul className="divide-y divide-slate-100 -m-5 mt-0">
              {grades.data?.slice(0, 5).map((g) => (
                <li key={g.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700">
                    {Number(g.score_percent).toFixed(0)}% against a {Number(g.pass_mark_applied).toFixed(0)}% pass mark
                  </span>
                  <Badge tone={g.passed ? 'green' : 'red'}>{g.passed ? 'Passed' : 'Not yet competent'}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

export function RoadmapPage() {
  const { enrollment, loading } = useEnrollment();
  const roadmap = useAsync(
    async () => (enrollment ? api.getRoadmap(enrollment) : []),
    [enrollment?.id],
    { enabled: Boolean(enrollment) },
  );

  if (loading || roadmap.loading) return <AppShell title="Course roadmap"><Spinner /></AppShell>;
  if (!enrollment) return <AppShell title="Course roadmap"><EmptyState icon="route" title="No active enrolment" /></AppShell>;
  if (roadmap.error) return <AppShell title="Course roadmap"><ErrorState error={roadmap.error} onRetry={roadmap.refetch} /></AppShell>;

  return (
    <AppShell title="Course roadmap">
      <p className="text-sm text-slate-600 mb-6">
        Modules unlock in sequence. Each one opens when the module before it has been passed.
      </p>

      <ol className="space-y-2">
        {roadmap.data?.map((entry, i) => {
          const status = entry.progress?.status ?? 'LOCKED';
          const locked = status === 'LOCKED';
          const passed = status === 'PASSED';

          const body = (
            <div
              className={`flex items-center gap-4 rounded-xl border p-4 transition-colors ${
                locked ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white shadow-card hover:border-primary'
              }`}
            >
              <div
                className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 font-bold text-sm ${
                  passed ? 'bg-emerald-100 text-emerald-700' : locked ? 'bg-slate-200 text-slate-500' : 'bg-primary text-white'
                }`}
              >
                {passed ? <Icon name="check" className="text-[20px]" /> : locked ? <Icon name="lock" className="text-[18px]" /> : i + 1}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone={locked ? 'slate' : 'blue'}>{entry.module.code}</Badge>
                  <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
                  <span className="text-xs text-slate-500 font-semibold">{entry.module.credits} credits</span>
                </div>
                <p className={`font-semibold mt-1.5 truncate ${locked ? 'text-slate-500' : 'text-slate-900'}`}>
                  {entry.module.title}
                </p>
              </div>

              {!locked && <Icon name="chevron_right" className="text-slate-400 shrink-0" />}
            </div>
          );

          return (
            <li key={entry.module.id}>
              {locked ? body : <Link to={`/app/modules/${entry.module.id}`}>{body}</Link>}
            </li>
          );
        })}
      </ol>
    </AppShell>
  );
}

export function ModulePage() {
  const { moduleId = '' } = useParams();
  const { enrollment } = useEnrollment();

  const detail = useAsync(
    async () => (enrollment ? api.getModuleDetail(enrollment.id, moduleId) : null),
    [enrollment?.id, moduleId],
    { enabled: Boolean(enrollment) },
  );

  if (detail.loading) return <AppShell title="Module"><Spinner /></AppShell>;
  if (detail.error) return <AppShell title="Module"><ErrorState error={detail.error} onRetry={detail.refetch} /></AppShell>;
  if (!detail.data) return <AppShell title="Module"><EmptyState icon="search_off" title="Module not found" /></AppShell>;

  const d = detail.data;
  const status = d.progress?.status ?? 'LOCKED';

  if (status === 'LOCKED') {
    return (
      <AppShell title={d.module.title}>
        <EmptyState
          icon="lock"
          title="This module is locked"
          body="Pass the module before it to unlock this one."
          action={<Link to="/app/roadmap" className="text-sm font-bold text-primary">Back to roadmap</Link>}
        />
      </AppShell>
    );
  }

  const bestFormative = (assessmentId: string) =>
    d.attempts.formative
      .filter((a) => a.assessment_id === assessmentId && a.score_percent != null)
      .sort((a, b) => (b.score_percent ?? 0) - (a.score_percent ?? 0))[0];

  const latestSummative = (assessmentId: string) =>
    d.attempts.summative
      .filter((a) => a.assessment_id === assessmentId)
      .sort((a, b) => b.attempt_number - a.attempt_number)[0];

  return (
    <AppShell title={`${d.module.code} — ${d.module.title}`}>
      <div className="space-y-6">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone="blue">{d.module.code}</Badge>
          <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
          <span className="text-xs font-semibold text-slate-600">{d.module.credits} credits</span>
        </div>

        {d.module.description && <p className="text-sm text-slate-700 max-w-3xl">{d.module.description}</p>}

        {d.module.outcomes.length > 0 && (
          <Card title="Learning outcomes">
            <ul className="space-y-2">
              {d.module.outcomes.map((o) => (
                <li key={o} className="flex gap-2 text-sm text-slate-700">
                  <Icon name="check_circle" className="text-emerald-600 text-[18px] shrink-0" />
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title={`Lessons (${d.lessons.filter((l) => l.done).length}/${d.lessons.length} complete)`}>
          {!d.lessons.length && <EmptyState icon="menu_book" title="No lessons published yet" />}
          <ul className="divide-y divide-slate-100 -m-5 mt-0">
            {d.lessons.map((l) => (
              <li key={l.id}>
                <Link to={`/app/lessons/${l.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50">
                  <Icon
                    name={l.done ? 'check_circle' : 'radio_button_unchecked'}
                    className={l.done ? 'text-emerald-600' : 'text-slate-400'}
                    fill={l.done}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">{l.title}</p>
                    {l.estimated_minutes && <p className="text-xs text-slate-600">About {l.estimated_minutes} minutes</p>}
                  </div>
                  <Icon name="chevron_right" className="text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        {d.resources.length > 0 && (
          <Card title="Module documents">
            <ul className="divide-y divide-slate-100 -m-5 mt-0">
              {d.resources.map((r) => (
                <ResourceLink key={r.id} resource={r} />
              ))}
            </ul>
          </Card>
        )}

        {d.formative.length > 0 && (
          <Card title="Knowledge checks">
            <ul className="divide-y divide-slate-100 -m-5 mt-0">
              {d.formative.map((f) => {
                const best = bestFormative(f.id);
                return (
                  <li key={f.id} className="px-5 py-3.5 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800">{f.title}</p>
                      <p className="text-xs text-slate-600">
                        Pass mark {f.pass_mark ?? 50}%
                        {f.max_attempts ? ` · ${f.max_attempts} attempts` : ' · unlimited attempts'}
                        {best && ` · best ${Number(best.score_percent).toFixed(0)}%`}
                      </p>
                    </div>
                    {best?.passed && <Badge tone="green">Passed</Badge>}
                    <Link
                      to={`/app/formative/${f.id}`}
                      className="text-sm font-bold text-primary shrink-0"
                    >
                      {best ? 'Retake' : 'Start'}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {d.summative.length > 0 && (
          <Card title="Summative assessment">
            <ul className="divide-y divide-slate-100 -m-5 mt-0">
              {d.summative.map((s) => {
                const att = latestSummative(s.id);
                return (
                  <li key={s.id} className="px-5 py-3.5 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800">{s.title}</p>
                      <p className="text-xs text-slate-600">
                        Assessor marked · pass mark {s.pass_mark ?? 50}%
                        {att && ` · attempt ${att.attempt_number} of ${s.max_attempts}`}
                      </p>
                    </div>
                    {att && <Badge tone={statusTone(att.status)}>{statusLabel(att.status)}</Badge>}
                    <Link to={`/app/summative/${s.id}`} className="text-sm font-bold text-primary shrink-0">
                      Open
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

export function LessonPage() {
  const { lessonId = '' } = useParams();
  const navigate = useNavigate();
  const lesson = useAsync(() => api.getLesson(lessonId), [lessonId]);
  const complete = useAction(api.completeLesson);

  if (lesson.loading) return <AppShell title="Lesson"><Spinner /></AppShell>;
  if (lesson.error) return <AppShell title="Lesson"><ErrorState error={lesson.error} onRetry={lesson.refetch} /></AppShell>;
  if (!lesson.data) return <AppShell title="Lesson"><EmptyState icon="search_off" title="Lesson not found" /></AppShell>;

  const { lesson: l, resources } = lesson.data;

  const onComplete = async () => {
    const r = await complete.run(l.id);
    if (r !== undefined) navigate(`/app/modules/${l.module_id}`);
  };

  return (
    <AppShell title={l.title}>
      <div className="max-w-3xl space-y-6">
        {l.summary && <p className="text-sm text-slate-600">{l.summary}</p>}

        {l.body && (
          <Card>
            <div className="prose prose-slate max-w-none text-sm text-slate-800 whitespace-pre-line leading-relaxed">
              {l.body}
            </div>
          </Card>
        )}

        <Card title="Study documents">
          {!resources.length && (
            <EmptyState
              icon="folder_open"
              title="No documents attached"
              body="Your facilitator has not attached documents to this lesson yet."
            />
          )}
          <ul className="divide-y divide-slate-100 -m-5 mt-0">
            {resources.map((r) => (
              <ResourceLink key={r.id} resource={r} />
            ))}
          </ul>
        </Card>

        {complete.error && <ErrorState error={complete.error} />}

        <div className="flex items-center gap-3">
          <Button size="lg" loading={complete.running} onClick={onComplete}>
            <Icon name="check" className="text-[18px]" />
            Mark lesson complete
          </Button>
          <Link to={`/app/modules/${l.module_id}`} className="text-sm font-semibold text-slate-600">
            Back to module
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

export function ResourceLibraryPage() {
  const { enrollment } = useEnrollment();
  const roadmap = useAsync(
    async () => (enrollment ? api.getRoadmap(enrollment) : []),
    [enrollment?.id],
    { enabled: Boolean(enrollment) },
  );

  const open = roadmap.data?.filter((r) => r.progress && r.progress.status !== 'LOCKED') ?? [];

  return (
    <AppShell title="Documents">
      <p className="text-sm text-slate-600 mb-6">
        Documents become available as each module unlocks.
      </p>

      {roadmap.loading && <Spinner />}
      {roadmap.error && <ErrorState error={roadmap.error} onRetry={roadmap.refetch} />}
      {roadmap.settled && !open.length && (
        <EmptyState icon="folder_open" title="No documents available yet" body="Your first module opens once your enrolment is active." />
      )}

      <div className="space-y-3">
        {open.map((entry) => (
          <Link
            key={entry.module.id}
            to={`/app/modules/${entry.module.id}`}
            className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 shadow-card p-4 hover:border-primary"
          >
            <div className="rounded-lg bg-primary-50 text-primary p-2.5">
              <Icon name="folder_open" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 truncate">
                {entry.module.code} — {entry.module.title}
              </p>
              <p className="text-xs text-slate-600">Open the module to view its documents</p>
            </div>
            <Icon name="chevron_right" className="text-slate-400" />
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

export function ResultsPage() {
  const { enrollment } = useEnrollment();
  const grades = useAsync(
    async () => (enrollment ? api.listMyGrades(enrollment.id) : []),
    [enrollment?.id],
    { enabled: Boolean(enrollment) },
  );

  return (
    <AppShell title="Results">
      <LiveRegion>
        {grades.loading && <Spinner />}
      </LiveRegion>
      {grades.error && <ErrorState error={grades.error} onRetry={grades.refetch} />}
      {grades.settled && !grades.data?.length && !grades.error && (
        <EmptyState
          icon="grading"
          title="No results released"
          body="Results appear here once an assessor has marked your work and released the result."
        />
      )}

      {!!grades.data?.length && (
        <Card>
          <div className="overflow-x-auto -m-5">
            <table className="w-full text-sm">
              <caption className="sr-only">Your released assessment results</caption>
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th scope="col" className="text-left font-bold text-slate-700 px-5 py-3">Assessment</th>
                  <th scope="col" className="text-left font-bold text-slate-700 px-5 py-3">Score</th>
                  <th scope="col" className="text-left font-bold text-slate-700 px-5 py-3">Pass mark</th>
                  <th scope="col" className="text-left font-bold text-slate-700 px-5 py-3">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {grades.data.map((g) => (
                  <tr key={g.id}>
                    <td className="px-5 py-3 text-slate-700">
                      {g.final_exam_attempt_id ? 'Final examination' : 'Summative assessment'}
                    </td>
                    <td className="px-5 py-3 font-bold text-slate-900">{Number(g.score_percent).toFixed(0)}%</td>
                    <td className="px-5 py-3 text-slate-600">{Number(g.pass_mark_applied).toFixed(0)}%</td>
                    <td className="px-5 py-3">
                      <Badge tone={g.passed ? 'green' : 'red'}>{g.passed ? 'Passed' : 'Not yet competent'}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </AppShell>
  );
}
