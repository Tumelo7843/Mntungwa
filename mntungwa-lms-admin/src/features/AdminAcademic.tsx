import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
  fileIcon,
  fmtBytes,
  fmtCurrency,
  fmtDateTime,
  inputClass,
  statusLabel,
  statusTone,
} from '@/components/ui';
import { useAction, useAsync } from '@/hooks/useAsync';
import * as api from '@/services/admin';
import type { CourseModule, QuestionOption } from '@/lib/database.types';

/* ========================================================================== */
/* COURSES                                                                     */
/* ========================================================================== */

export function CoursesPage() {
  const courses = useAsync(() => api.listCourses(), []);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', title: '', description: '' });

  const create = useAction(async () => {
    await api.saveCourse({
      code: form.code.trim(),
      title: form.title.trim(),
      description: form.description.trim() || null,
      publication_status: 'DRAFT',
    });
    setCreating(false);
    setForm({ code: '', title: '', description: '' });
    courses.refetch();
  });

  return (
    <AdminShell
      title="Courses & modules"
      actions={<Button size="sm" onClick={() => setCreating((c) => !c)}>New course</Button>}
    >
      <div className="space-y-4">
        {creating && (
          <Card title="Create a course">
            {create.error && <div className="mb-4"><ErrorState error={create.error} /></div>}
            <div className="space-y-4 max-w-xl">
              <Field label="Course code" required hint="A short unique code, e.g. OC-PM-101869.">
                {(p) => (
                  <input {...p} className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                )}
              </Field>
              <Field label="Title" required>
                {(p) => (
                  <input {...p} className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                )}
              </Field>
              <Field label="Description">
                {(p) => (
                  <textarea {...p} rows={3} className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                )}
              </Field>
              <div className="flex gap-2">
                <Button loading={create.running} disabled={!form.code || !form.title} onClick={() => create.run()}>
                  Create course
                </Button>
                <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </div>
          </Card>
        )}

        {courses.loading && <Spinner />}
        {courses.error && <ErrorState error={courses.error} onRetry={courses.refetch} />}
        {courses.settled && !courses.data?.length && (
          <EmptyState icon="school" title="No courses yet" body="Create your first course to begin building modules." />
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.data?.map((c) => (
            <Link
              key={c.id}
              to={`/courses/${c.id}`}
              className="block bg-white rounded-xl border border-slate-200 shadow-card p-5 hover:border-primary"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Badge tone="blue">{c.code}</Badge>
                <Badge tone={c.publication_status === 'PUBLISHED' ? 'green' : 'slate'}>
                  {c.publication_status}
                </Badge>
              </div>
              <p className="font-bold text-slate-900 mt-3">{c.title}</p>
              <p className="text-xs text-slate-600 mt-1 line-clamp-2">{c.description}</p>
              {c.price != null && (
                <p className="text-sm font-bold text-primary mt-3">{fmtCurrency(c.price)}</p>
              )}
            </Link>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}

export function CourseDetailPage() {
  const { courseId = '' } = useParams();
  const course = useAsync(() => api.getCourse(courseId), [courseId]);
  const modules = useAsync(() => api.listModules(courseId), [courseId]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', title: '', description: '', credits: '8' });

  const publishCourse = useAction(async () => {
    await api.saveCourse({ id: courseId, publication_status: 'PUBLISHED' });
    course.refetch();
  });

  const create = useAction(async () => {
    const nextSeq = (modules.data?.length ?? 0) + 1;
    const prev = modules.data?.[modules.data.length - 1];
    await api.saveModule({
      course_id: courseId,
      code: form.code.trim(),
      title: form.title.trim(),
      description: form.description.trim() || null,
      credits: Number(form.credits) || 0,
      sequence: nextSeq,
      // Chain onto the previous module so progression stays sequential.
      prerequisite_module_id: prev?.id ?? null,
      publication_status: 'DRAFT',
    });
    setCreating(false);
    setForm({ code: '', title: '', description: '', credits: '8' });
    modules.refetch();
  });

  return (
    <AdminShell
      title={course.data?.title ?? 'Course'}
      subtitle={course.data?.code}
      actions={<Button size="sm" onClick={() => setCreating((c) => !c)}>New module</Button>}
    >
      <div className="space-y-4">
        {course.data && course.data.publication_status !== 'PUBLISHED' && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-amber-900">
              This course is a draft. Learners cannot see it until it is published.
            </p>
            <Button size="sm" loading={publishCourse.running} onClick={() => publishCourse.run()}>
              Publish course
            </Button>
          </div>
        )}

        {creating && (
          <Card title="Create a module">
            {create.error && <div className="mb-4"><ErrorState error={create.error} /></div>}
            <div className="space-y-4 max-w-xl">
              <Field label="Module code" required hint="e.g. KM-01">
                {(p) => <input {...p} className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />}
              </Field>
              <Field label="Title" required>
                {(p) => <input {...p} className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
              </Field>
              <Field label="Description">
                {(p) => <textarea {...p} rows={3} className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
              </Field>
              <Field label="Credits">
                {(p) => <input {...p} type="number" min={0} className={inputClass} value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} />}
              </Field>
              <p className="text-xs text-slate-600">
                The new module is added at the end of the sequence and requires the module before it
                to be passed.
              </p>
              <div className="flex gap-2">
                <Button loading={create.running} disabled={!form.code || !form.title} onClick={() => create.run()}>
                  Create module
                </Button>
                <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </div>
          </Card>
        )}

        <Card title={`Modules (${modules.data?.length ?? 0})`}>
          {modules.loading && <Spinner />}
          {modules.error && <ErrorState error={modules.error} onRetry={modules.refetch} />}
          {modules.settled && !modules.data?.length && (
            <EmptyState icon="view_module" title="No modules yet" body="Add the first module to start building this course." />
          )}

          <ul className="divide-y divide-slate-100 -m-5 mt-0">
            {modules.data?.map((m: CourseModule) => (
              <li key={m.id}>
                <Link to={`/modules/${m.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50">
                  <span className="text-xs font-bold text-slate-400 w-6">{m.sequence}</span>
                  <Badge tone="blue">{m.code}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">{m.title}</p>
                    <p className="text-xs text-slate-600">{m.credits} credits</p>
                  </div>
                  <Badge tone={m.publication_status === 'PUBLISHED' ? 'green' : 'slate'}>
                    {m.publication_status}
                  </Badge>
                  <Icon name="chevron_right" className="text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AdminShell>
  );
}

/* ========================================================================== */
/* MODULE BUILDER — the first-module workflow lives here                       */
/* ========================================================================== */

export function ModuleBuilderPage() {
  const { moduleId = '' } = useParams();
  const [tab, setTab] = useState<'lessons' | 'documents' | 'formative' | 'summative' | 'publish'>('lessons');

  const module = useAsync(() => api.getModule(moduleId), [moduleId]);

  if (module.loading) return <AdminShell title="Module"><Spinner /></AdminShell>;
  if (module.error) return <AdminShell title="Module"><ErrorState error={module.error} onRetry={module.refetch} /></AdminShell>;
  if (!module.data) return <AdminShell title="Module"><EmptyState icon="search_off" title="Module not found" /></AdminShell>;

  const m = module.data;
  const tabs = [
    { id: 'lessons', label: 'Lessons', icon: 'menu_book' },
    { id: 'documents', label: 'Documents', icon: 'folder_open' },
    { id: 'formative', label: 'Knowledge check', icon: 'quiz' },
    { id: 'summative', label: 'Summative', icon: 'assignment' },
    { id: 'publish', label: 'Publish', icon: 'publish' },
  ] as const;

  return (
    <AdminShell
      title={`${m.code} — ${m.title}`}
      subtitle={`Sequence ${m.sequence} · ${m.credits} credits`}
      actions={
        <Badge tone={m.publication_status === 'PUBLISHED' ? 'green' : 'slate'}>
          {m.publication_status}
        </Badge>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon name={t.icon} className="text-[18px]" />
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'lessons' && <LessonsTab moduleId={moduleId} />}
        {tab === 'documents' && <DocumentsTab moduleId={moduleId} courseId={m.course_id} />}
        {tab === 'formative' && <FormativeTab moduleId={moduleId} />}
        {tab === 'summative' && <SummativeTab moduleId={moduleId} />}
        {tab === 'publish' && <PublishTab moduleId={moduleId} onChange={module.refetch} />}
      </div>
    </AdminShell>
  );
}

function LessonsTab({ moduleId }: { moduleId: string }) {
  const lessons = useAsync(() => api.listLessons(moduleId), [moduleId]);
  const [form, setForm] = useState({ title: '', summary: '', body: '' });

  const create = useAction(async () => {
    await api.saveLesson({
      module_id: moduleId,
      title: form.title.trim(),
      summary: form.summary.trim() || null,
      body: form.body.trim() || null,
      sequence: (lessons.data?.length ?? 0) + 1,
      publication_status: 'PUBLISHED',
      published_at: new Date().toISOString(),
    });
    setForm({ title: '', summary: '', body: '' });
    lessons.refetch();
  });

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Add a lesson">
        {create.error && <div className="mb-4"><ErrorState error={create.error} /></div>}
        <div className="space-y-4">
          <Field label="Lesson title" required>
            {(p) => <input {...p} className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
          </Field>
          <Field label="Summary">
            {(p) => <input {...p} className={inputClass} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />}
          </Field>
          <Field label="Lesson text" hint="Framing for the attached documents. Markdown is preserved as written.">
            {(p) => <textarea {...p} rows={6} className={inputClass} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />}
          </Field>
          <Button loading={create.running} disabled={!form.title.trim()} onClick={() => create.run()}>
            Add lesson
          </Button>
        </div>
      </Card>

      <Card title={`Lessons (${lessons.data?.length ?? 0})`}>
        {lessons.loading && <Spinner />}
        {lessons.settled && !lessons.data?.length && (
          <EmptyState icon="menu_book" title="No lessons yet" body="A module normally needs at least one lesson before it can be published." />
        )}
        <ul className="divide-y divide-slate-100 -m-5 mt-0">
          {lessons.data?.map((l) => (
            <li key={l.id} className="px-5 py-3 flex items-center gap-3">
              <span className="text-xs font-bold text-slate-400 w-5">{l.sequence}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800 truncate">{l.title}</p>
                {l.summary && <p className="text-xs text-slate-600 truncate">{l.summary}</p>}
              </div>
              <Badge tone={l.publication_status === 'PUBLISHED' ? 'green' : 'slate'}>
                {l.publication_status}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function DocumentsTab({ moduleId, courseId }: { moduleId: string; courseId: string }) {
  const resources = useAsync(() => api.listResources({ moduleId }), [moduleId]);
  const lessons = useAsync(() => api.listLessons(moduleId), [moduleId]);
  const [title, setTitle] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);

  const upload = useAction(async () => {
    if (!file) return;
    const r = await api.uploadResource({
      file,
      title: title.trim() || file.name,
      courseId,
      moduleId: lessonId ? undefined : moduleId,
      lessonId: lessonId || undefined,
    });
    setUploaded(r.title);
    setTitle('');
    setFile(null);
    resources.refetch();
  });

  const openDoc = useAction(async (r: Parameters<typeof api.getResourceUrl>[0]) => {
    const url = await api.getResourceUrl(r);
    window.open(url, '_blank', 'noopener,noreferrer');
  });

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Upload a document">
        <LiveRegion>
          {uploaded && (
            <p className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
              “{uploaded}” uploaded and stored.
            </p>
          )}
        </LiveRegion>
        {upload.error && <div className="mb-4"><ErrorState error={upload.error} /></div>}

        <div className="space-y-4">
          <Field label="Document title" hint="Defaults to the file name if left blank.">
            {(p) => <input {...p} className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>

          <Field label="Attach to" hint="Attach to a specific lesson, or leave as module-wide.">
            {(p) => (
              <select {...p} className={inputClass} value={lessonId} onChange={(e) => setLessonId(e.target.value)}>
                <option value="">Whole module</option>
                {lessons.data?.map((l) => (
                  <option key={l.id} value={l.id}>{l.title}</option>
                ))}
              </select>
            )}
          </Field>

          <div>
            <label htmlFor="doc-file" className="block text-sm font-semibold text-slate-800">
              File
            </label>
            <p className="text-xs text-slate-600 mt-1">
              PDF, Word, PowerPoint, Excel, text or images. Video is not accepted.
            </p>
            <input
              id="doc-file"
              type="file"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.webp"
              className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-bold file:text-white hover:file:bg-primary-700"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="text-xs text-slate-600 mt-2">
                {file.name} · {fmtBytes(file.size)}
              </p>
            )}
          </div>

          <Button loading={upload.running} disabled={!file} onClick={() => upload.run()}>
            Upload document
          </Button>
        </div>
      </Card>

      <Card title={`Documents (${resources.data?.length ?? 0})`}>
        {resources.loading && <Spinner />}
        {resources.settled && !resources.data?.length && (
          <EmptyState icon="folder_open" title="No documents yet" body="Upload the study material learners will work from." />
        )}
        {openDoc.error && <div className="mb-3"><ErrorState error={openDoc.error} /></div>}
        <ul className="divide-y divide-slate-100 -m-5 mt-0">
          {resources.data?.map((r) => (
            <li key={r.id} className="px-5 py-3 flex items-center gap-3">
              <Icon name={fileIcon(r.mime_type)} className="text-slate-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800 truncate">{r.title}</p>
                <p className="text-xs text-slate-600">
                  {r.file_name} · {fmtBytes(r.file_size_bytes)}
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => openDoc.run(r)} aria-label={`Open ${r.title}`}>
                Open
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function FormativeTab({ moduleId }: { moduleId: string }) {
  const assessments = useAsync(() => api.listFormative(moduleId), [moduleId]);
  const [selected, setSelected] = useState<string | null>(null);

  const create = useAction(async () => {
    const a = await api.saveFormative({
      module_id: moduleId,
      title: 'Knowledge check',
      instructions: 'Answer every question. You may retry; your best result is retained.',
      pass_mark: 50,
      is_required: true,
      publication_status: 'PUBLISHED',
      published_at: new Date().toISOString(),
    });
    setSelected(a.id);
    assessments.refetch();
  });

  const active = selected ?? assessments.data?.[0]?.id ?? null;

  return (
    <div className="space-y-4">
      {assessments.loading && <Spinner />}
      {assessments.settled && !assessments.data?.length && (
        <Card>
          <EmptyState
            icon="quiz"
            title="No knowledge check yet"
            body="Create one, then add questions. Correct answers are stored in the database and are never sent to a learner's browser."
            action={<Button loading={create.running} onClick={() => create.run()}>Create knowledge check</Button>}
          />
        </Card>
      )}

      {!!assessments.data?.length && (
        <div className="flex gap-2 flex-wrap">
          {assessments.data.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelected(a.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                active === a.id ? 'bg-primary text-white' : 'bg-white text-slate-700 border border-slate-300'
              }`}
            >
              {a.title}
            </button>
          ))}
        </div>
      )}

      {active && <QuestionBuilder assessmentId={active} />}
    </div>
  );
}

function QuestionBuilder({ assessmentId }: { assessmentId: string }) {
  const questions = useAsync(() => api.listFormativeQuestions(assessmentId), [assessmentId]);
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState([
    { label: '', is_correct: true },
    { label: '', is_correct: false },
    { label: '', is_correct: false },
    { label: '', is_correct: false },
  ]);

  const add = useAction(async () => {
    await api.saveQuestion({
      assessmentId,
      questionType: 'MULTIPLE_CHOICE',
      prompt,
      points: 1,
      sequence: (questions.data?.length ?? 0) + 1,
      options: options.filter((o) => o.label.trim()),
    });
    setPrompt('');
    setOptions([
      { label: '', is_correct: true },
      { label: '', is_correct: false },
      { label: '', is_correct: false },
      { label: '', is_correct: false },
    ]);
    questions.refetch();
  });

  const remove = useAction(async (id: string) => {
    await api.deleteQuestion(id);
    questions.refetch();
  });

  const filled = options.filter((o) => o.label.trim());
  const canAdd = prompt.trim().length > 0 && filled.length >= 2 && filled.some((o) => o.is_correct);

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Add a question">
        {add.error && <div className="mb-4"><ErrorState error={add.error} /></div>}
        <div className="space-y-4">
          <Field label="Question" required>
            {(p) => <textarea {...p} rows={2} className={inputClass} value={prompt} onChange={(e) => setPrompt(e.target.value)} />}
          </Field>

          <fieldset>
            <legend className="text-sm font-semibold text-slate-800">
              Answer options
              <span className="block text-xs font-normal text-slate-600 mt-0.5">
                Select the radio button next to the correct answer. At least two options are required.
              </span>
            </legend>
            <div className="mt-3 space-y-2">
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="correct"
                    checked={o.is_correct}
                    onChange={() => setOptions(options.map((x, j) => ({ ...x, is_correct: i === j })))}
                    className="h-4 w-4 text-primary focus:ring-primary"
                    aria-label={`Mark option ${i + 1} as correct`}
                  />
                  <input
                    className={inputClass}
                    placeholder={`Option ${i + 1}`}
                    aria-label={`Option ${i + 1} text`}
                    value={o.label}
                    onChange={(e) =>
                      setOptions(options.map((x, j) => (i === j ? { ...x, label: e.target.value } : x)))
                    }
                  />
                </div>
              ))}
            </div>
          </fieldset>

          <Button loading={add.running} disabled={!canAdd} onClick={() => add.run()}>
            Add question
          </Button>
        </div>
      </Card>

      <Card title={`Questions (${questions.data?.length ?? 0})`}>
        {questions.loading && <Spinner />}
        {questions.settled && !questions.data?.length && (
          <EmptyState icon="quiz" title="No questions yet" body="A published knowledge check needs at least one question." />
        )}
        <ol className="divide-y divide-slate-100 -m-5 mt-0">
          {questions.data?.map((q, i) => (
            <li key={q.id} className="px-5 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-slate-800">
                  <span className="text-slate-400 mr-1.5">{i + 1}.</span>
                  {q.prompt}
                </p>
                <button
                  onClick={() => remove.run(q.id)}
                  className="text-red-600 hover:text-red-800 shrink-0"
                  aria-label={`Delete question ${i + 1}`}
                >
                  <Icon name="delete" className="text-[18px]" />
                </button>
              </div>
              <ul className="mt-2 space-y-1 ml-5">
                {q.options.map((o: QuestionOption) => (
                  <li key={o.id} className="flex items-center gap-2 text-xs">
                    <Icon
                      name={o.is_correct ? 'check_circle' : 'radio_button_unchecked'}
                      className={o.is_correct ? 'text-emerald-600 text-[15px]' : 'text-slate-400 text-[15px]'}
                      fill={o.is_correct}
                    />
                    <span className={o.is_correct ? 'font-semibold text-slate-800' : 'text-slate-600'}>
                      {o.label}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function SummativeTab({ moduleId }: { moduleId: string }) {
  const assessments = useAsync(() => api.listSummative(moduleId), [moduleId]);
  const rubrics = useAsync(() => api.listRubrics(), []);
  const [form, setForm] = useState({ title: '', brief: '', minFiles: '1', maxFiles: '5', rubricId: '' });

  const create = useAction(async () => {
    await api.saveSummative({
      module_id: moduleId,
      title: form.title.trim(),
      task_brief: form.brief.trim() || null,
      instructions: 'Complete the task below and upload your evidence. A registered assessor will mark your submission.',
      pass_mark: 50,
      max_attempts: 3,
      requires_submission: true,
      has_questions: false,
      min_files: Number(form.minFiles) || 1,
      max_files: Number(form.maxFiles) || 5,
      question_weight: 0,
      submission_weight: 100,
      rubric_id: form.rubricId || null,
      publication_status: 'PUBLISHED',
      published_at: new Date().toISOString(),
    });
    setForm({ title: '', brief: '', minFiles: '1', maxFiles: '5', rubricId: '' });
    assessments.refetch();
  });

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Add a summative assessment">
        {create.error && <div className="mb-4"><ErrorState error={create.error} /></div>}
        <div className="space-y-4">
          <Field label="Title" required>
            {(p) => <input {...p} className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
          </Field>
          <Field label="Task brief" hint="What the learner must produce and submit.">
            {(p) => <textarea {...p} rows={4} className={inputClass} value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Minimum files">
              {(p) => <input {...p} type="number" min={0} className={inputClass} value={form.minFiles} onChange={(e) => setForm({ ...form, minFiles: e.target.value })} />}
            </Field>
            <Field label="Maximum files">
              {(p) => <input {...p} type="number" min={1} className={inputClass} value={form.maxFiles} onChange={(e) => setForm({ ...form, maxFiles: e.target.value })} />}
            </Field>
          </div>
          <Field label="Marking rubric" hint="Optional. Without one, assessors enter a percentage directly.">
            {(p) => (
              <select {...p} className={inputClass} value={form.rubricId} onChange={(e) => setForm({ ...form, rubricId: e.target.value })}>
                <option value="">No rubric</option>
                {rubrics.data?.map((r) => (
                  <option key={r.id} value={r.id}>{r.title}</option>
                ))}
              </select>
            )}
          </Field>
          <Button loading={create.running} disabled={!form.title.trim()} onClick={() => create.run()}>
            Add summative assessment
          </Button>
        </div>
      </Card>

      <Card title={`Summative assessments (${assessments.data?.length ?? 0})`}>
        {assessments.loading && <Spinner />}
        {assessments.settled && !assessments.data?.length && (
          <EmptyState icon="assignment" title="None yet" body="Add one if this module requires submitted evidence." />
        )}
        <ul className="divide-y divide-slate-100 -m-5 mt-0">
          {assessments.data?.map((s) => (
            <li key={s.id} className="px-5 py-3">
              <p className="text-sm font-semibold text-slate-800">{s.title}</p>
              <p className="text-xs text-slate-600 mt-0.5">
                Pass mark {s.pass_mark ?? 50}% · {s.min_files}–{s.max_files} files · up to{' '}
                {s.max_attempts} attempts
              </p>
              <Badge tone={s.publication_status === 'PUBLISHED' ? 'green' : 'slate'} className="mt-2">
                {s.publication_status}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function PublishTab({ moduleId, onChange }: { moduleId: string; onChange: () => void }) {
  const problems = useAsync(() => api.validateModuleForPublishing(moduleId), [moduleId]);
  const [message, setMessage] = useState<string | null>(null);

  const publish = useAction(async () => {
    await api.setModulePublication(moduleId, 'PUBLISHED');
    setMessage('Module published. Enrolled learners will see it as soon as their turn in the sequence arrives.');
    problems.refetch();
    onChange();
  });

  const unpublish = useAction(async () => {
    await api.setModulePublication(moduleId, 'DRAFT');
    setMessage('Module unpublished. It is now hidden from learners.');
    problems.refetch();
    onChange();
  });

  const ready = problems.data?.length === 0;

  return (
    <div className="max-w-2xl space-y-4">
      <Card title="Publishing checks">
        {problems.loading && <Spinner />}
        {problems.error && <ErrorState error={problems.error} onRetry={problems.refetch} />}

        {problems.settled && ready && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
            <Icon name="check_circle" className="text-emerald-700 mt-0.5" fill />
            <div>
              <p className="font-bold text-emerald-900 text-sm">Ready to publish</p>
              <p className="text-sm text-emerald-800 mt-0.5">
                Everything this module requires is in place.
              </p>
            </div>
          </div>
        )}

        {!!problems.data?.length && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="font-bold text-amber-900 text-sm">Not ready yet</p>
            <ul className="mt-2 space-y-1.5">
              {problems.data.map((p) => (
                <li key={p} className="flex gap-2 text-sm text-amber-900">
                  <Icon name="error" className="text-[18px] shrink-0" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <LiveRegion>
          {message && (
            <p className="mt-4 rounded-lg border border-primary-200 bg-primary-50 p-3 text-sm text-primary-800">
              {message}
            </p>
          )}
        </LiveRegion>

        {(publish.error || unpublish.error) && (
          <div className="mt-4"><ErrorState error={(publish.error ?? unpublish.error)!} /></div>
        )}

        <div className="mt-5 flex gap-2">
          <Button loading={publish.running} disabled={!ready} onClick={() => publish.run()}>
            Publish module
          </Button>
          <Button variant="secondary" loading={unpublish.running} onClick={() => unpublish.run()}>
            Unpublish
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ========================================================================== */
/* GRADING QUEUE                                                               */
/* ========================================================================== */

export function SubmissionsPage() {
  const queue = useAsync(() => api.listGradingQueue(), []);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <AdminShell title="Grading queue" subtitle="Submissions awaiting assessment">
      {queue.loading && <Spinner />}
      {queue.error && <ErrorState error={queue.error} onRetry={queue.refetch} />}
      {queue.settled && !queue.data?.length && (
        <Card>
          <EmptyState icon="task_alt" title="The queue is clear" body="Nothing is waiting to be graded." />
        </Card>
      )}

      <div className="space-y-3">
        {queue.data?.map((item) => (
          <Card key={item.id}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{item.enrollment?.profile?.full_name}</p>
                <p className="text-sm text-slate-600">
                  {item.assessment?.module?.code} — {item.assessment?.title}
                </p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
                  <span className="text-xs text-slate-500">
                    Attempt {item.attempt_number} · submitted {fmtDateTime(item.submitted_at)}
                  </span>
                </div>
              </div>
              <Button size="sm" onClick={() => setOpenId(openId === item.id ? null : item.id)}>
                {openId === item.id ? 'Close' : 'Assess'}
              </Button>
            </div>

            {openId === item.id && (
              <div className="mt-5 pt-5 border-t border-slate-200">
                <GradingPanel
                  attemptId={item.id}
                  rubricId={item.assessment?.rubric_id ?? null}
                  onGraded={() => {
                    setOpenId(null);
                    queue.refetch();
                  }}
                />
              </div>
            )}
          </Card>
        ))}
      </div>
    </AdminShell>
  );
}

function GradingPanel({
  attemptId,
  rubricId,
  onGraded,
}: {
  attemptId: string;
  rubricId: string | null;
  onGraded: () => void;
}) {
  const detail = useAsync(() => api.getSubmissionDetail(attemptId), [attemptId]);
  const criteria = useAsync(
    async () => (rubricId ? api.listRubricCriteria(rubricId) : []),
    [rubricId],
    { enabled: Boolean(rubricId) },
  );

  const [scores, setScores] = useState<Record<string, string>>({});
  const [rawScore, setRawScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [result, setResult] = useState<{ final_score: number; passed: boolean } | null>(null);

  const openFile = useAction(async (f: Parameters<typeof api.getSubmissionFileUrl>[0]) => {
    const url = await api.getSubmissionFileUrl(f);
    window.open(url, '_blank', 'noopener,noreferrer');
  });

  const grade = useAction(async () => {
    const r = await api.gradeSubmission({
      attemptId,
      criteriaScores: rubricId
        ? (criteria.data ?? []).map((c) => ({
            criterion_id: c.id,
            points: Number(scores[c.id] ?? 0),
          }))
        : undefined,
      rawScore: rubricId ? undefined : Number(rawScore),
      feedback: feedback.trim() || undefined,
      release: true,
    });
    setResult(r);
    setTimeout(onGraded, 1800);
  });

  const hasRubric = Boolean(rubricId) && (criteria.data?.length ?? 0) > 0;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-600 mb-2">
          Submitted evidence
        </p>
        {detail.loading && <Spinner />}
        {detail.settled && !detail.data?.versions.length && (
          <p className="text-sm text-slate-600">No files were attached to this submission.</p>
        )}
        {openFile.error && <ErrorState error={openFile.error} />}

        {detail.data?.versions.map((v) => (
          <div key={v.id} className="mb-3">
            <p className="text-xs font-semibold text-slate-700">
              Version {v.version_number} · {fmtDateTime(v.submitted_at)}
            </p>
            {v.note && <p className="text-xs text-slate-600 italic mt-0.5">“{v.note}”</p>}
            <ul className="mt-1.5 space-y-1">
              {v.files.map((f) => (
                <li key={f.id} className="flex items-center gap-2">
                  <Icon name={fileIcon(f.mime_type)} className="text-slate-500 text-[18px]" />
                  <button
                    onClick={() => openFile.run(f)}
                    className="text-sm text-primary font-semibold hover:underline truncate"
                  >
                    {f.file_name}
                  </button>
                  <span className="text-xs text-slate-500">{fmtBytes(f.file_size_bytes)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-600 mb-2">
          {hasRubric ? 'Rubric' : 'Score'}
        </p>

        {hasRubric ? (
          <div className="space-y-3">
            {criteria.data?.map((c) => (
              <div key={c.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`crit-${c.id}`} className="text-sm font-semibold text-slate-800">
                    {c.title}
                  </label>
                  {c.description && <p className="text-xs text-slate-600">{c.description}</p>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    id={`crit-${c.id}`}
                    type="number"
                    min={0}
                    max={c.max_points}
                    className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none"
                    value={scores[c.id] ?? ''}
                    onChange={(e) => setScores({ ...scores, [c.id]: e.target.value })}
                  />
                  <span className="text-xs text-slate-500">/ {c.max_points}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Field label="Score (%)" required hint="The system decides pass or fail against the effective pass mark.">
            {(p) => (
              <input
                {...p}
                type="number"
                min={0}
                max={100}
                className={inputClass}
                value={rawScore}
                onChange={(e) => setRawScore(e.target.value)}
              />
            )}
          </Field>
        )}
      </div>

      <Field label="Feedback for the learner">
        {(p) => (
          <textarea {...p} rows={3} className={inputClass} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        )}
      </Field>

      {grade.error && <ErrorState error={grade.error} />}

      <LiveRegion>
        {result && (
          <div className={`rounded-lg border p-4 text-sm ${result.passed ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
            Recorded {Number(result.final_score).toFixed(0)}% — {result.passed ? 'passed' : 'not yet competent'}.
            {result.passed && ' The learner’s next module has been unlocked.'}
          </div>
        )}
      </LiveRegion>

      <div className="flex items-center gap-3">
        <Button
          loading={grade.running}
          disabled={!hasRubric && !rawScore}
          onClick={() => grade.run()}
        >
          Record result and release
        </Button>
        <p className="text-xs text-slate-600">
          The final score is recalculated by the database; pass or fail is arithmetic.
        </p>
      </div>
    </div>
  );
}
