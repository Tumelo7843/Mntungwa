import { useCallback, useEffect, useRef, useState } from 'react';
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
  Spinner,
  fmtBytes,
  fmtDateTime,
  statusLabel,
  statusTone,
} from '@/components/ui';
import { useAction, useAsync } from '@/hooks/useAsync';
import * as api from '@/services/lms';
import { useEnrollment } from '@/app/EnrollmentContext';
import type { FormativeResult, FinalExamResult } from '@/lib/database.types';

/* ========================================================================== */
/* FORMATIVE ASSESSMENT                                                        */
/*                                                                             */
/* The learner selects options and submits. The score comes back from the      */
/* database. Nothing in this file can compute or influence a result — the      */
/* correct answers are never sent to the browser.                              */
/* ========================================================================== */

export function FormativeAssessmentPage() {
  const { assessmentId = '' } = useParams();
  const { enrollment } = useEnrollment();
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<FormativeResult | null>(null);

  const assessment = useAsync(() => api.getFormativeAssessment(assessmentId), [assessmentId]);
  const history = useAsync(
    async () => (enrollment ? api.listFormativeAttempts(enrollment.id, assessmentId) : []),
    [enrollment?.id, assessmentId, result],
    { enabled: Boolean(enrollment) },
  );

  const start = useAction(async () => {
    const id = await api.startFormativeAttempt(assessmentId);
    setAttemptId(id);
    setAnswers({});
    setResult(null);
    return id;
  });

  const paper = useAsync(
    async () => (attemptId ? api.getFormativePaper(attemptId) : null),
    [attemptId],
    { enabled: Boolean(attemptId) },
  );

  const submit = useAction(async () => {
    if (!attemptId) return;
    // Persist every answer, then ask the database to grade.
    for (const [questionId, optionIds] of Object.entries(answers)) {
      await api.saveFormativeAnswer(attemptId, questionId, optionIds);
    }
    const r = await api.submitFormativeAttempt(attemptId);
    setResult(r);
    setAttemptId(null);
    return r;
  });

  const a = assessment.data;
  const questions = paper.data?.questions ?? [];
  const answeredCount = questions.filter((q) => (answers[q.id] ?? []).length > 0).length;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

  const toggle = (questionId: string, optionId: string, multi: boolean) => {
    setAnswers((prev) => {
      const current = prev[questionId] ?? [];
      if (!multi) return { ...prev, [questionId]: [optionId] };
      return {
        ...prev,
        [questionId]: current.includes(optionId)
          ? current.filter((x) => x !== optionId)
          : [...current, optionId],
      };
    });
  };

  if (assessment.loading) return <AppShell title="Knowledge check"><Spinner /></AppShell>;
  if (assessment.error) return <AppShell title="Knowledge check"><ErrorState error={assessment.error} onRetry={assessment.refetch} /></AppShell>;
  if (!a) return <AppShell title="Knowledge check"><EmptyState icon="search_off" title="Assessment not found" /></AppShell>;

  const best = history.data?.filter((h) => h.score_percent != null).sort((x, y) => (y.score_percent ?? 0) - (x.score_percent ?? 0))[0];
  const attemptsUsed = history.data?.length ?? 0;
  const outOfAttempts = a.max_attempts != null && attemptsUsed >= a.max_attempts;

  return (
    <AppShell title={a.title}>
      <div className="max-w-3xl space-y-6">
        {/* ---- Result banner ---- */}
        <LiveRegion>
          {result && (
            <div
              className={`rounded-xl border p-6 ${
                result.passed ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`rounded-full p-2 ${result.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
                  <Icon name={result.passed ? 'check_circle' : 'info'} fill />
                </div>
                <div>
                  <p className={`font-extrabold ${result.passed ? 'text-emerald-900' : 'text-amber-900'}`}>
                    {result.passed ? 'Passed' : 'Not yet competent'}
                  </p>
                  <p className={`text-sm mt-1 ${result.passed ? 'text-emerald-800' : 'text-amber-800'}`}>
                    You scored {Number(result.score_percent).toFixed(0)}% ({result.points_earned} of{' '}
                    {result.points_possible} marks) against a pass mark of {a.pass_mark ?? 50}%.
                    {!result.passed && ' Review the material and try again.'}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Link to={`/app/modules/${a.module_id}`} className="text-sm font-bold text-primary">
                      Back to module
                    </Link>
                    {!result.passed && !outOfAttempts && (
                      <button onClick={() => start.run()} className="text-sm font-bold text-primary">
                        Try again
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </LiveRegion>

        {/* ---- Instructions / start ---- */}
        {!attemptId && !result && (
          <Card title="Before you start">
            {a.instructions && <p className="text-sm text-slate-700">{a.instructions}</p>}
            <dl className="mt-4 grid sm:grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">Pass mark</dt>
                <dd className="font-bold text-slate-900">{a.pass_mark ?? 50}%</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">Attempts</dt>
                <dd className="font-bold text-slate-900">
                  {a.max_attempts ? `${attemptsUsed} of ${a.max_attempts} used` : 'Unlimited'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">Best score</dt>
                <dd className="font-bold text-slate-900">
                  {best ? `${Number(best.score_percent).toFixed(0)}%` : '—'}
                </dd>
              </div>
            </dl>

            {start.error && <div className="mt-4"><ErrorState error={start.error} /></div>}

            <div className="mt-5">
              <Button size="lg" loading={start.running} disabled={outOfAttempts} onClick={() => start.run()}>
                {best ? 'Retake knowledge check' : 'Start knowledge check'}
              </Button>
              {outOfAttempts && (
                <p className="text-xs text-slate-600 mt-2">
                  You have used all {a.max_attempts} attempts for this assessment.
                </p>
              )}
              {best?.passed && (
                <p className="text-xs text-slate-600 mt-2">
                  You have already passed. A further attempt cannot lower your recorded result.
                </p>
              )}
            </div>
          </Card>
        )}

        {/* ---- Paper ---- */}
        {attemptId && paper.loading && <Spinner label="Preparing your questions" />}
        {paper.error && <ErrorState error={paper.error} onRetry={paper.refetch} />}

        {attemptId && questions.length > 0 && (
          <>
            <ol className="space-y-4">
              {questions.map((q, i) => {
                const multi = q.question_type === 'MULTIPLE_SELECT';
                const selected = answers[q.id] ?? [];
                return (
                  <li key={q.id}>
                    <Card>
                      <fieldset>
                        <legend className="font-bold text-slate-900 text-sm">
                          <span className="text-slate-500 mr-2">{i + 1}.</span>
                          {q.prompt}
                        </legend>
                        {multi && (
                          <p className="text-xs text-slate-600 mt-1 ml-6">Select all that apply.</p>
                        )}
                        <div className="mt-4 space-y-2" role={multi ? 'group' : 'radiogroup'}>
                          {q.options.map((o) => {
                            const checked = selected.includes(o.id);
                            return (
                              <label
                                key={o.id}
                                className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                                  checked ? 'border-primary bg-primary-50' : 'border-slate-200 hover:bg-slate-50'
                                }`}
                              >
                                <input
                                  type={multi ? 'checkbox' : 'radio'}
                                  name={q.id}
                                  value={o.id}
                                  checked={checked}
                                  onChange={() => toggle(q.id, o.id, multi)}
                                  className="mt-0.5 h-4 w-4 text-primary focus:ring-primary"
                                />
                                <span className="text-sm text-slate-800">{o.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    </Card>
                  </li>
                );
              })}
            </ol>

            {submit.error && <ErrorState error={submit.error} />}

            <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-slate-200 -mx-4 sm:-mx-8 px-4 sm:px-8 py-4 flex items-center justify-between gap-4">
              <p className="text-sm font-semibold text-slate-700">
                {answeredCount} of {questions.length} answered
              </p>
              <Button size="lg" loading={submit.running} disabled={!allAnswered} onClick={() => submit.run()}>
                Submit answers
              </Button>
            </div>
          </>
        )}

        {/* ---- History ---- */}
        {!!history.data?.length && !attemptId && (
          <Card title="Your attempts">
            <ul className="divide-y divide-slate-100 -m-5 mt-0">
              {history.data.map((h) => (
                <li key={h.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Attempt {h.attempt_number}</p>
                    <p className="text-xs text-slate-600">{fmtDateTime(h.submitted_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-900">
                      {h.score_percent != null ? `${Number(h.score_percent).toFixed(0)}%` : '—'}
                    </span>
                    {h.passed != null && (
                      <Badge tone={h.passed ? 'green' : 'red'}>{h.passed ? 'Passed' : 'Not yet'}</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

/* ========================================================================== */
/* SUMMATIVE ASSESSMENT / PoE SUBMISSION                                       */
/* ========================================================================== */

export function SummativeAssessmentPage() {
  const { assessmentId = '' } = useParams();
  const { enrollment } = useEnrollment();
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const assessment = useAsync(() => api.getSummativeAssessment(assessmentId), [assessmentId]);
  const attempts = useAsync(
    async () => (enrollment ? api.listSummativeAttempts(enrollment.id, assessmentId) : []),
    [enrollment?.id, assessmentId, submitted],
    { enabled: Boolean(enrollment) },
  );

  const latest = attempts.data?.[0];
  const canWork = latest && ['DRAFT', 'OPEN', 'RESUBMISSION_REQUIRED'].includes(latest.status);

  const start = useAction(async () => {
    await api.startSummativeAttempt(assessmentId);
    attempts.refetch();
  });

  const submit = useAction(async () => {
    if (!latest || !enrollment) return;

    if (files.length) {
      await api.uploadSubmissionFiles({
        enrollmentId: enrollment.id,
        assessmentId,
        attemptId: latest.id,
        files,
        note,
      });
    }
    await api.submitSummativeAttempt(latest.id, note);
    setFiles([]);
    setNote('');
    setSubmitted(true);
    attempts.refetch();
  });

  if (assessment.loading) return <AppShell title="Summative assessment"><Spinner /></AppShell>;
  if (assessment.error) return <AppShell title="Summative assessment"><ErrorState error={assessment.error} onRetry={assessment.refetch} /></AppShell>;
  if (!assessment.data) return <AppShell title="Summative assessment"><EmptyState icon="search_off" title="Assessment not found" /></AppShell>;

  const s = assessment.data;

  return (
    <AppShell title={s.title}>
      <div className="max-w-3xl space-y-6">
        {latest && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={statusTone(latest.status)}>{statusLabel(latest.status)}</Badge>
            <span className="text-xs font-semibold text-slate-600">
              Attempt {latest.attempt_number} of {s.max_attempts}
            </span>
          </div>
        )}

        <Card title="Task brief">
          {s.instructions && <p className="text-sm text-slate-700">{s.instructions}</p>}
          {s.task_brief && (
            <p className="text-sm text-slate-700 mt-3 whitespace-pre-line border-l-2 border-primary-200 pl-4">
              {s.task_brief}
            </p>
          )}
          <dl className="mt-4 grid sm:grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">Pass mark</dt>
              <dd className="font-bold text-slate-900">{s.pass_mark ?? 50}%</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">Files required</dt>
              <dd className="font-bold text-slate-900">
                {s.min_files} to {s.max_files}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">Marked by</dt>
              <dd className="font-bold text-slate-900">Registered assessor</dd>
            </div>
          </dl>
        </Card>

        {/* Result once graded */}
        {latest && ['PASSED', 'FAILED', 'RESUBMISSION_REQUIRED'].includes(latest.status) && (
          <Card title="Assessor decision">
            <div className="flex items-center gap-3">
              <Badge tone={statusTone(latest.status)}>{statusLabel(latest.status)}</Badge>
              {latest.final_score != null && (
                <span className="text-sm font-bold text-slate-900">
                  {Number(latest.final_score).toFixed(0)}%
                </span>
              )}
            </div>
            {latest.assessor_feedback && (
              <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Feedback</p>
                <p className="text-sm text-slate-800 mt-1 whitespace-pre-line">{latest.assessor_feedback}</p>
              </div>
            )}
          </Card>
        )}

        {/* Start */}
        {!latest && (
          <Card>
            {start.error && <div className="mb-4"><ErrorState error={start.error} /></div>}
            <Button size="lg" loading={start.running} onClick={() => start.run()}>
              Start this assessment
            </Button>
          </Card>
        )}

        {/* Upload + submit */}
        {canWork && (
          <Card title="Upload your evidence">
            <div className="space-y-4">
              <div>
                <label htmlFor="evidence" className="block text-sm font-semibold text-slate-800">
                  Choose files
                </label>
                <p className="text-xs text-slate-600 mt-1">
                  PDF, Word, Excel, images or a ZIP archive. Up to {s.max_files} files.
                </p>
                <input
                  id="evidence"
                  type="file"
                  multiple
                  className="mt-2 block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-bold file:text-white hover:file:bg-primary-700"
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, s.max_files))}
                />
              </div>

              {files.length > 0 && (
                <ul className="space-y-1.5">
                  {files.map((f) => (
                    <li key={f.name} className="flex items-center gap-2 text-sm text-slate-700">
                      <Icon name="draft" className="text-[18px] text-slate-500" />
                      <span className="truncate flex-1">{f.name}</span>
                      <span className="text-xs text-slate-500">{fmtBytes(f.size)}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div>
                <label htmlFor="note" className="block text-sm font-semibold text-slate-800">
                  Note for the assessor (optional)
                </label>
                <textarea
                  id="note"
                  rows={3}
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              {submit.error && <ErrorState error={submit.error} />}

              <Button
                size="lg"
                loading={submit.running}
                disabled={files.length < s.min_files}
                onClick={() => submit.run()}
              >
                Submit for assessment
              </Button>
              {files.length < s.min_files && (
                <p className="text-xs text-slate-600">
                  Attach at least {s.min_files} file{s.min_files === 1 ? '' : 's'} before submitting.
                </p>
              )}
            </div>
          </Card>
        )}

        <LiveRegion>
          {submitted && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
              Submitted. An assessor will review your evidence and you will be notified when the
              result is released.
            </div>
          )}
        </LiveRegion>
      </div>
    </AppShell>
  );
}

/* ========================================================================== */
/* FINAL EXAMINATION                                                           */
/* ========================================================================== */

export function FinalExamPage() {
  const { enrollment } = useEnrollment();
  const navigate = useNavigate();

  const eligibility = useAsync(
    async () => (enrollment ? api.checkFinalExamEligibility(enrollment.id) : null),
    [enrollment?.id],
    { enabled: Boolean(enrollment) },
  );
  const exam = useAsync(
    async () => (enrollment ? api.getFinalExam(enrollment.course_id) : null),
    [enrollment?.course_id],
    { enabled: Boolean(enrollment) },
  );

  const start = useAction(async () => {
    if (!enrollment) return;
    const id = await api.startFinalExamAttempt(enrollment.id);
    navigate(`/app/final-exam/${id}`);
  });

  if (eligibility.loading) return <AppShell title="Final examination"><Spinner /></AppShell>;
  if (eligibility.error) return <AppShell title="Final examination"><ErrorState error={eligibility.error} onRetry={eligibility.refetch} /></AppShell>;

  const v = eligibility.data;

  return (
    <AppShell title="Final examination">
      <div className="max-w-3xl space-y-6">
        {exam.data && (
          <Card title={exam.data.title}>
            {exam.data.instructions && <p className="text-sm text-slate-700">{exam.data.instructions}</p>}
            <dl className="mt-4 grid sm:grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">Duration</dt>
                <dd className="font-bold text-slate-900">{exam.data.duration_minutes} minutes</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">Pass mark</dt>
                <dd className="font-bold text-slate-900">{exam.data.pass_mark}%</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-600">Attempts</dt>
                <dd className="font-bold text-slate-900">{exam.data.max_attempts}</dd>
              </div>
            </dl>
          </Card>
        )}

        <Card title="Your eligibility">
          <p className="text-sm text-slate-600 mb-4">
            Every requirement below is checked by the system when you start the examination.
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

          {start.error && <div className="mt-5"><ErrorState error={start.error} /></div>}

          <div className="mt-6">
            {v?.reason === 'ALREADY_PASSED' ? (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
                You have already passed the final examination.
              </div>
            ) : v?.reason === 'NO_EXAM_PUBLISHED' ? (
              <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
                The final examination has not been published for this course yet.
              </div>
            ) : (
              <>
                <Button size="lg" loading={start.running} disabled={!v?.eligible} onClick={() => start.run()}>
                  Start the final examination
                </Button>
                {!v?.eligible && (
                  <p className="text-xs text-slate-600 mt-2">
                    Complete the outstanding requirements above to unlock the examination.
                  </p>
                )}
              </>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

/** The exam itself. The countdown is a courtesy; the deadline is enforced server-side. */
export function FinalExamAttemptPage() {
  const { attemptId = '' } = useParams();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<FinalExamResult | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const autoSubmitted = useRef(false);

  const paper = useAsync(() => api.getExamPaper(attemptId), [attemptId]);

  const doSubmit = useCallback(async () => {
    for (const [qid, optionIds] of Object.entries(answers)) {
      await api.saveExamAnswer(attemptId, qid, optionIds).catch(() => undefined);
    }
    return api.submitExam(attemptId);
  }, [attemptId, answers]);

  const submit = useAction(async () => {
    const r = await doSubmit();
    setResult(r);
    return r;
  });

  // Countdown from the server-stamped expiry.
  useEffect(() => {
    const expires = paper.data?.attempt.expires_at;
    if (!expires || result) return;

    const tick = () => {
      const ms = new Date(expires).getTime() - Date.now();
      setRemaining(Math.max(0, Math.floor(ms / 1000)));
      if (ms <= 0 && !autoSubmitted.current) {
        autoSubmitted.current = true;
        submit.run();
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [paper.data?.attempt.expires_at, result, submit]);

  if (paper.loading) return <AppShell title="Final examination"><Spinner label="Preparing your paper" /></AppShell>;
  if (paper.error) return <AppShell title="Final examination"><ErrorState error={paper.error} onRetry={paper.refetch} /></AppShell>;

  const questions = paper.data?.questions ?? [];
  const answered = questions.filter((q) => (answers[q.id] ?? []).length).length;

  const mm = remaining != null ? String(Math.floor(remaining / 60)).padStart(2, '0') : '--';
  const ss = remaining != null ? String(remaining % 60).padStart(2, '0') : '--';

  if (result) {
    return (
      <AppShell title="Final examination">
        <div className="max-w-2xl">
          <LiveRegion>
            {result.status === 'SUBMITTED' ? (
              <Card>
                <EmptyState
                  icon="hourglass_top"
                  title="Submitted for marking"
                  body="Your paper contains questions that require an assessor. You will be notified when your result is released."
                  action={<Link to="/app/results" className="text-sm font-bold text-primary">Go to results</Link>}
                />
              </Card>
            ) : (
              <div className={`rounded-xl border p-6 ${result.passed ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
                <p className={`text-2xl font-black ${result.passed ? 'text-emerald-900' : 'text-amber-900'}`}>
                  {Number(result.score_percent).toFixed(0)}%
                </p>
                <p className={`font-extrabold mt-1 ${result.passed ? 'text-emerald-900' : 'text-amber-900'}`}>
                  {result.passed ? 'You passed the final examination' : 'Not yet competent'}
                </p>
                <div className="mt-4 flex gap-3">
                  <Link to="/app/certificate" className="text-sm font-bold text-primary">Certificate status</Link>
                  <Link to="/app" className="text-sm font-semibold text-slate-600">Dashboard</Link>
                </div>
              </div>
            )}
          </LiveRegion>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Final examination">
      <div className="max-w-3xl space-y-4">
        <div className="sticky top-16 z-20 bg-white border border-slate-200 rounded-xl shadow-card px-5 py-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">
            {answered} of {questions.length} answered
          </p>
          <div className={`flex items-center gap-2 font-mono font-bold ${remaining != null && remaining < 300 ? 'text-red-700' : 'text-slate-900'}`}>
            <Icon name="timer" className="text-[18px]" />
            <span aria-label={`Time remaining ${mm} minutes ${ss} seconds`}>{mm}:{ss}</span>
          </div>
        </div>

        <ol className="space-y-4">
          {questions.map((q, i) => {
            const multi = q.question_type === 'MULTIPLE_SELECT';
            const selected = answers[q.id] ?? [];
            return (
              <li key={q.id}>
                <Card>
                  <fieldset>
                    <legend className="font-bold text-slate-900 text-sm">
                      <span className="text-slate-500 mr-2">{i + 1}.</span>
                      {q.prompt}
                    </legend>
                    <div className="mt-4 space-y-2" role={multi ? 'group' : 'radiogroup'}>
                      {q.options.map((o) => {
                        const checked = selected.includes(o.id);
                        return (
                          <label
                            key={o.id}
                            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${
                              checked ? 'border-primary bg-primary-50' : 'border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type={multi ? 'checkbox' : 'radio'}
                              name={q.id}
                              checked={checked}
                              onChange={() =>
                                setAnswers((prev) => {
                                  const cur = prev[q.id] ?? [];
                                  if (!multi) return { ...prev, [q.id]: [o.id] };
                                  return {
                                    ...prev,
                                    [q.id]: cur.includes(o.id) ? cur.filter((x) => x !== o.id) : [...cur, o.id],
                                  };
                                })
                              }
                              className="mt-0.5 h-4 w-4 text-primary focus:ring-primary"
                            />
                            <span className="text-sm text-slate-800">{o.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                </Card>
              </li>
            );
          })}
        </ol>

        {submit.error && <ErrorState error={submit.error} />}

        <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-slate-200 -mx-4 sm:-mx-8 px-4 sm:px-8 py-4">
          <Button size="lg" loading={submit.running} onClick={() => submit.run()}>
            Submit examination
          </Button>
          <p className="text-xs text-slate-600 mt-2">
            Once submitted you cannot change your answers.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
