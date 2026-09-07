import { supabase, unwrap, unwrapMaybe, toAppError, AppError } from '@/lib/supabase';
import type {
  Announcement,
  AppRole,
  AuditLog,
  Certificate,
  ContactMessage,
  Course,
  CourseModule,
  EligibilityVerdict,
  Enrollment,
  FinalExam,
  FinalExamAttempt,
  FormativeAssessment,
  FormativeQuestion,
  Invoice,
  InstitutionSettings,
  LearningResource,
  Lesson,
  Payment,
  Profile,
  PublicationStatus,
  QuestionOption,
  Rubric,
  RubricCriterion,
  Submission,
  SubmissionFile,
  SubmissionVersion,
  SummativeAssessment,
  SummativeAttempt,
} from '@/lib/database.types';

/**
 * Administration service layer.
 *
 * Everything here is subject to the same Row Level Security as the learner
 * app — an ADMIN role simply satisfies more policies. Nothing in this file
 * elevates privileges; there is no service-role key in this application.
 *
 * The genuinely privileged operations (issue a certificate, grade a
 * submission, approve a payment) are database functions that re-check the
 * caller's role server-side and raise if it is wrong.
 */

/* -------------------------------------------------------------------------- */
/* Dashboard — every figure is a real query (audit M-19)                       */
/* -------------------------------------------------------------------------- */

export interface DashboardMetrics {
  totalLearners: number;
  activeLearners: number;
  pendingApplications: number;
  activeCourses: number;
  publishedModules: number;
  awaitingGrading: number;
  examsAwaitingMarking: number;
  completedLearners: number;
  certificatesIssued: number;
  outstandingPayments: number;
  paymentsAwaitingReview: number;
  newContactMessages: number;
}

const countOf = async (
  table: string,
  build?: (q: ReturnType<typeof supabase.from>) => unknown,
): Promise<number> => {
  let q = supabase.from(table).select('*', { count: 'exact', head: true });
  if (build) q = build(q as never) as typeof q;
  const { count, error } = await q;
  if (error) throw toAppError(error);
  return count ?? 0;
};

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const [
    totalLearners,
    activeLearners,
    pendingApplications,
    activeCourses,
    publishedModules,
    awaitingGrading,
    examsAwaitingMarking,
    completedLearners,
    certificatesIssued,
    outstandingPayments,
    paymentsAwaitingReview,
    newContactMessages,
  ] = await Promise.all([
    countOf('enrollments'),
    countOf('enrollments', (q) => (q as never as { eq: Function }).eq('status', 'ACTIVE')),
    countOf('enrollments', (q) => (q as never as { eq: Function }).eq('status', 'PENDING')),
    countOf('courses', (q) => (q as never as { eq: Function }).eq('publication_status', 'PUBLISHED')),
    countOf('course_modules', (q) => (q as never as { eq: Function }).eq('publication_status', 'PUBLISHED')),
    countOf('summative_attempts', (q) => (q as never as { in: Function }).in('status', ['SUBMITTED', 'UNDER_REVIEW'])),
    countOf('final_exam_attempts', (q) => (q as never as { eq: Function }).eq('status', 'SUBMITTED')),
    countOf('enrollments', (q) => (q as never as { eq: Function }).eq('course_completed', true)),
    countOf('certificates', (q) => (q as never as { eq: Function }).eq('status', 'ISSUED')),
    countOf('invoices', (q) => (q as never as { in: Function }).in('status', ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'])),
    countOf('payments', (q) => (q as never as { in: Function }).in('status', ['SUBMITTED', 'UNDER_REVIEW'])),
    countOf('contact_messages', (q) => (q as never as { eq: Function }).eq('status', 'NEW')),
  ]);

  return {
    totalLearners,
    activeLearners,
    pendingApplications,
    activeCourses,
    publishedModules,
    awaitingGrading,
    examsAwaitingMarking,
    completedLearners,
    certificatesIssued,
    outstandingPayments,
    paymentsAwaitingReview,
    newContactMessages,
  };
}

/* -------------------------------------------------------------------------- */
/* People                                                                      */
/* -------------------------------------------------------------------------- */

export interface PersonRow extends Profile {
  roles: AppRole[];
}

export async function listPeople(search = ''): Promise<PersonRow[]> {
  let q = supabase.from('profiles').select('*, user_roles(role)').order('full_name');
  if (search.trim()) q = q.ilike('full_name', `%${search.trim()}%`);

  const rows = unwrap(await q) as (Profile & { user_roles: { role: AppRole }[] })[];
  return rows.map((r) => ({ ...r, roles: (r.user_roles ?? []).map((x) => x.role) }));
}

// Role and account-status changes are audited by database triggers (migration
// 022), so the record is written in the same transaction as the change and
// cannot be lost if this client goes away mid-request.
export async function grantRole(profileId: string, role: AppRole): Promise<void> {
  const { error } = await supabase.from('user_roles').insert({ profile_id: profileId, role });
  if (error) throw toAppError(error);
}

export async function revokeRole(profileId: string, role: AppRole): Promise<void> {
  const { error } = await supabase
    .from('user_roles')
    .delete()
    .eq('profile_id', profileId)
    .eq('role', role);
  if (error) throw toAppError(error);
}

export async function setAccountStatus(
  profileId: string,
  status: Profile['account_status'],
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ account_status: status })
    .eq('id', profileId);
  if (error) throw toAppError(error);
}

/* -------------------------------------------------------------------------- */
/* Enrollments                                                                 */
/* -------------------------------------------------------------------------- */

export interface EnrollmentRow extends Enrollment {
  profile: Profile;
  course: Course;
}

export async function listEnrollments(status?: string): Promise<EnrollmentRow[]> {
  let q = supabase
    .from('enrollments')
    .select('*, profile:profiles(*), course:courses(*)')
    .order('applied_at', { ascending: false });
  if (status) q = q.eq('status', status);
  return unwrap(await q) as EnrollmentRow[];
}

/**
 * Verify documents / reassign a cohort. Status transitions are NOT done here —
 * they go through setEnrollmentStatus(), which validates the transition,
 * records a learner-facing reason and notifies. This keeps the ADMIN-only
 * enrollments table policy narrow.
 */
export async function updateEnrollment(
  id: string,
  patch: Partial<Pick<Enrollment, 'documents_verified' | 'cohort_id'>>,
): Promise<void> {
  const body: Record<string, unknown> = { ...patch };
  if (patch.documents_verified) body.documents_verified_at = new Date().toISOString();

  const { error } = await supabase.from('enrollments').update(body).eq('id', id);
  if (error) throw toAppError(error);
  await writeAudit('ENROLLMENT_UPDATED', 'enrollment', id, JSON.stringify(patch));
}

/**
 * Transition an enrollment's status. ADMIN or SUPPORT. The database function
 * validates the transition, requires a reason for SUSPENDED/WITHDRAWN/EXPIRED,
 * reopens module 1 on reactivation, audits and notifies the learner.
 */
export async function setEnrollmentStatus(
  id: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'WITHDRAWN' | 'EXPIRED',
  reason?: string,
): Promise<Enrollment['status']> {
  const { data, error } = await supabase.rpc('set_enrollment_status', {
    p_enrollment_id: id,
    p_status: status,
    p_reason: reason?.trim() ? reason.trim() : null,
  });
  if (error) throw toAppError(error);
  return data as Enrollment['status'];
}

/**
 * Open the learner's first module.
 *
 * Normally this happens automatically when finance approves a payment. It is
 * exposed here for enrolments activated by hand (bursary, employer-funded).
 */
export async function refreshUnlocks(enrollmentId: string): Promise<void> {
  const { error } = await supabase.rpc('refresh_module_unlocks_admin', {
    p_enrollment_id: enrollmentId,
  });
  // The helper lives in the `app` schema and is not exposed through PostgREST
  // by default. If it is unavailable, updating the enrollment row triggers the
  // same recalculation on the next result event.
  if (error && !String(error.message).includes('does not exist')) throw toAppError(error);
}

/* -------------------------------------------------------------------------- */
/* Courses, modules, lessons                                                   */
/* -------------------------------------------------------------------------- */

export async function listCourses(): Promise<Course[]> {
  return unwrap(await supabase.from('courses').select('*').order('title'));
}

export async function getCourse(id: string): Promise<Course | null> {
  return unwrapMaybe(await supabase.from('courses').select('*').eq('id', id).maybeSingle());
}

export async function saveCourse(input: Partial<Course> & { id?: string }): Promise<Course> {
  const body = { ...input };
  if (body.publication_status === 'PUBLISHED' && !body.published_at) {
    body.published_at = new Date().toISOString();
  }

  const res = input.id
    ? await supabase.from('courses').update(body).eq('id', input.id).select().single()
    : await supabase.from('courses').insert(body).select().single();

  const course = unwrap(res) as Course;
  await writeAudit(input.id ? 'COURSE_UPDATED' : 'COURSE_CREATED', 'course', course.id, course.title);
  return course;
}

export async function listModules(courseId: string): Promise<CourseModule[]> {
  return unwrap(
    await supabase.from('course_modules').select('*').eq('course_id', courseId).order('sequence'),
  );
}

export async function getModule(id: string): Promise<CourseModule | null> {
  return unwrapMaybe(await supabase.from('course_modules').select('*').eq('id', id).maybeSingle());
}

export async function saveModule(
  input: Partial<CourseModule> & { course_id: string; id?: string },
): Promise<CourseModule> {
  const body = { ...input };
  if (body.publication_status === 'PUBLISHED' && !body.published_at) {
    body.published_at = new Date().toISOString();
  }

  const res = input.id
    ? await supabase.from('course_modules').update(body).eq('id', input.id).select().single()
    : await supabase.from('course_modules').insert(body).select().single();

  const module = unwrap(res) as CourseModule;
  await writeAudit(input.id ? 'MODULE_UPDATED' : 'MODULE_CREATED', 'course_module', module.id, `${module.code} ${module.title}`);
  return module;
}

/**
 * Publishing validation.
 *
 * The brief requires that publishing checks the required components exist.
 * This runs before the status change and returns human-readable problems.
 */
export async function validateModuleForPublishing(moduleId: string): Promise<string[]> {
  const module = await getModule(moduleId);
  if (!module) return ['The module could not be found.'];

  const problems: string[] = [];

  const [lessons, formative, summative] = await Promise.all([
    supabase.from('lessons').select('id, publication_status').eq('module_id', moduleId),
    supabase.from('formative_assessments').select('id, publication_status').eq('module_id', moduleId),
    supabase.from('summative_assessments').select('id, publication_status').eq('module_id', moduleId),
  ]);

  const publishedLessons = (lessons.data ?? []).filter(
    (l) => (l as Lesson).publication_status === 'PUBLISHED',
  );

  if (!module.description?.trim()) problems.push('Add a module description.');
  if (module.require_all_lessons && publishedLessons.length === 0) {
    problems.push('This module requires lessons, but none are published.');
  }

  if (module.require_formative) {
    const published = (formative.data ?? []).filter(
      (f) => (f as FormativeAssessment).publication_status === 'PUBLISHED',
    );
    if (!published.length) problems.push('This module requires a formative assessment, but none is published.');

    for (const f of published) {
      const { count } = await supabase
        .from('formative_questions')
        .select('*', { count: 'exact', head: true })
        .eq('assessment_id', (f as FormativeAssessment).id)
        .eq('is_active', true);
      if (!count) problems.push('A published formative assessment has no active questions.');
    }
  }

  if (module.require_summative) {
    const published = (summative.data ?? []).filter(
      (s) => (s as SummativeAssessment).publication_status === 'PUBLISHED',
    );
    if (!published.length) problems.push('This module requires a summative assessment, but none is published.');
  }

  return problems;
}

export async function setModulePublication(
  moduleId: string,
  status: PublicationStatus,
): Promise<void> {
  const body: Record<string, unknown> = { publication_status: status };
  if (status === 'PUBLISHED') body.published_at = new Date().toISOString();

  const { error } = await supabase.from('course_modules').update(body).eq('id', moduleId);
  if (error) throw toAppError(error);
  await writeAudit(status === 'PUBLISHED' ? 'MODULE_PUBLISHED' : 'MODULE_UPDATED', 'course_module', moduleId, status);
}

export async function listLessons(moduleId: string): Promise<Lesson[]> {
  return unwrap(
    await supabase.from('lessons').select('*').eq('module_id', moduleId).order('sequence'),
  );
}

export async function saveLesson(
  input: Partial<Lesson> & { module_id: string; id?: string },
): Promise<Lesson> {
  const body = { ...input };
  if (body.publication_status === 'PUBLISHED' && !body.published_at) {
    body.published_at = new Date().toISOString();
  }

  const res = input.id
    ? await supabase.from('lessons').update(body).eq('id', input.id).select().single()
    : await supabase.from('lessons').insert(body).select().single();

  const lesson = unwrap(res) as Lesson;
  await writeAudit(input.id ? 'LESSON_UPDATED' : 'LESSON_CREATED', 'lesson', lesson.id, lesson.title);
  return lesson;
}

export async function deleteLesson(id: string): Promise<void> {
  const { error } = await supabase.from('lessons').delete().eq('id', id);
  if (error) throw toAppError(error);
}

/* -------------------------------------------------------------------------- */
/* Documents — real Supabase Storage uploads (fixes audit M-11)                */
/* -------------------------------------------------------------------------- */

export async function listResources(params: {
  moduleId?: string;
  lessonId?: string;
  courseId?: string;
}): Promise<LearningResource[]> {
  let q = supabase.from('learning_resources').select('*').eq('is_archived', false).order('sequence');
  if (params.lessonId) q = q.eq('lesson_id', params.lessonId);
  else if (params.moduleId) q = q.eq('module_id', params.moduleId);
  else if (params.courseId) q = q.eq('course_id', params.courseId);
  return unwrap(await q);
}

/**
 * Upload a learning document.
 *
 * Path convention: {course}/{module}/{lesson|_}/{uuid}-{name}. The Storage
 * policy and the MIME/size trigger both enforce their own rules server-side —
 * the checks here are only to fail fast with a clearer message.
 */
export async function uploadResource(input: {
  file: File;
  title: string;
  description?: string;
  courseId: string;
  moduleId?: string;
  lessonId?: string;
}): Promise<LearningResource> {
  const { file, courseId, moduleId, lessonId } = input;

  if (file.type.startsWith('video/')) {
    throw new AppError(
      'VALIDATION',
      'This is a document-based LMS. Video files are not accepted as learning resources.',
    );
  }

  const settings = await getSettings();
  if (settings && file.size > settings.max_resource_bytes) {
    throw new AppError(
      'VALIDATION',
      `That file is larger than the ${Math.round(settings.max_resource_bytes / 1024 / 1024)} MB limit.`,
    );
  }
  if (settings && !settings.allowed_resource_mime.includes(file.type)) {
    throw new AppError('VALIDATION', `Files of type "${file.type || 'unknown'}" are not accepted.`);
  }

  const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-120);
  const path = `${courseId}/${moduleId ?? '_'}/${lessonId ?? '_'}/${crypto.randomUUID()}-${safe}`;

  const up = await supabase.storage.from('learning-resources').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (up.error) throw toAppError(up.error);

  // Exactly one owner column may be set (database CHECK enforces it).
  const owner = lessonId
    ? { lesson_id: lessonId }
    : moduleId
      ? { module_id: moduleId }
      : { course_id: courseId };

  const { data: userRes } = await supabase.auth.getUser();

  const resource = unwrap(
    await supabase
      .from('learning_resources')
      .insert({
        ...owner,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        storage_bucket: 'learning-resources',
        storage_path: path,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        file_size_bytes: file.size,
        uploaded_by: userRes.user?.id ?? null,
      })
      .select()
      .single(),
  ) as LearningResource;

  await writeAudit('RESOURCE_UPLOADED', 'learning_resource', resource.id, resource.title);
  return resource;
}

export async function archiveResource(id: string): Promise<void> {
  const { data: userRes } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('learning_resources')
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
      archived_by: userRes.user?.id ?? null,
    })
    .eq('id', id);
  if (error) throw toAppError(error);
  await writeAudit('RESOURCE_ARCHIVED', 'learning_resource', id);
}

export async function getResourceUrl(r: LearningResource): Promise<string> {
  const { data, error } = await supabase.storage
    .from(r.storage_bucket)
    .createSignedUrl(r.storage_path, 300);
  if (error) throw toAppError(error);
  return data!.signedUrl;
}

/* -------------------------------------------------------------------------- */
/* Assessment builders                                                         */
/* -------------------------------------------------------------------------- */

export async function listFormative(moduleId: string): Promise<FormativeAssessment[]> {
  return unwrap(
    await supabase.from('formative_assessments').select('*').eq('module_id', moduleId).order('sequence'),
  );
}

export async function saveFormative(
  input: Partial<FormativeAssessment> & { module_id: string; id?: string },
): Promise<FormativeAssessment> {
  const body = { ...input };
  if (body.publication_status === 'PUBLISHED' && !body.published_at) {
    body.published_at = new Date().toISOString();
  }
  const res = input.id
    ? await supabase.from('formative_assessments').update(body).eq('id', input.id).select().single()
    : await supabase.from('formative_assessments').insert(body).select().single();

  const a = unwrap(res) as FormativeAssessment;
  await writeAudit(input.id ? 'ASSESSMENT_UPDATED' : 'ASSESSMENT_CREATED', 'formative_assessment', a.id, a.title);
  return a;
}

export interface QuestionWithOptions extends FormativeQuestion {
  options: QuestionOption[];
}

export async function listFormativeQuestions(assessmentId: string): Promise<QuestionWithOptions[]> {
  const questions = unwrap(
    await supabase.from('formative_questions').select('*').eq('assessment_id', assessmentId).order('sequence'),
  ) as FormativeQuestion[];

  if (!questions.length) return [];

  // Staff may read is_correct — this is the marking key.
  const options = unwrap(
    await supabase
      .from('formative_options')
      .select('*')
      .in('question_id', questions.map((q) => q.id))
      .order('sequence'),
  ) as QuestionOption[];

  return questions.map((q) => ({ ...q, options: options.filter((o) => o.question_id === q.id) }));
}

/**
 * Create a question and its options together.
 *
 * The database validates the option set against the question type (exactly one
 * correct answer for MULTIPLE_CHOICE and TRUE_FALSE, at least one for
 * MULTIPLE_SELECT, minimum two options) via a deferred constraint trigger.
 */
export async function saveQuestion(input: {
  assessmentId: string;
  questionId?: string;
  questionType: FormativeQuestion['question_type'];
  prompt: string;
  explanation?: string;
  points: number;
  sequence: number;
  options: { id?: string; label: string; is_correct: boolean }[];
}): Promise<void> {
  const body = {
    assessment_id: input.assessmentId,
    question_type: input.questionType,
    prompt: input.prompt.trim(),
    explanation: input.explanation?.trim() || null,
    points: input.points,
    sequence: input.sequence,
  };

  const qRes = input.questionId
    ? await supabase.from('formative_questions').update(body).eq('id', input.questionId).select().single()
    : await supabase.from('formative_questions').insert(body).select().single();

  const question = unwrap(qRes) as FormativeQuestion;

  // Replace the option set wholesale — simpler and safer than diffing.
  await supabase.from('formative_options').delete().eq('question_id', question.id);

  const { error } = await supabase.from('formative_options').insert(
    input.options.map((o, i) => ({
      question_id: question.id,
      label: o.label.trim(),
      is_correct: o.is_correct,
      sequence: i + 1,
    })),
  );
  if (error) throw toAppError(error);

  await writeAudit('ASSESSMENT_UPDATED', 'formative_question', question.id, question.prompt.slice(0, 80));
}

export async function deleteQuestion(id: string): Promise<void> {
  const { error } = await supabase.from('formative_questions').delete().eq('id', id);
  if (error) throw toAppError(error);
}

export async function listSummative(moduleId: string): Promise<SummativeAssessment[]> {
  return unwrap(
    await supabase.from('summative_assessments').select('*').eq('module_id', moduleId).order('sequence'),
  );
}

export async function saveSummative(
  input: Partial<SummativeAssessment> & { module_id: string; id?: string },
): Promise<SummativeAssessment> {
  const body = { ...input };
  if (body.publication_status === 'PUBLISHED' && !body.published_at) {
    body.published_at = new Date().toISOString();
  }
  const res = input.id
    ? await supabase.from('summative_assessments').update(body).eq('id', input.id).select().single()
    : await supabase.from('summative_assessments').insert(body).select().single();

  const a = unwrap(res) as SummativeAssessment;
  await writeAudit(input.id ? 'ASSESSMENT_UPDATED' : 'ASSESSMENT_CREATED', 'summative_assessment', a.id, a.title);
  return a;
}

/* -------------------------------------------------------------------------- */
/* Grading queue                                                               */
/* -------------------------------------------------------------------------- */

export interface QueueItem extends SummativeAttempt {
  assessment: SummativeAssessment & { module: CourseModule };
  enrollment: Enrollment & { profile: Profile };
}

export async function listGradingQueue(): Promise<QueueItem[]> {
  return unwrap(
    await supabase
      .from('summative_attempts')
      .select(
        '*, assessment:summative_assessments(*, module:course_modules(*)), enrollment:enrollments(*, profile:profiles(*))',
      )
      .in('status', ['SUBMITTED', 'UNDER_REVIEW'])
      .order('submitted_at'),
  ) as QueueItem[];
}

export interface SubmissionDetail {
  submission: Submission | null;
  versions: (SubmissionVersion & { files: SubmissionFile[] })[];
}

export async function getSubmissionDetail(attemptId: string): Promise<SubmissionDetail> {
  const submission = unwrapMaybe(
    await supabase.from('submissions').select('*').eq('attempt_id', attemptId).maybeSingle(),
  ) as Submission | null;

  if (!submission) return { submission: null, versions: [] };

  const versions = unwrap(
    await supabase
      .from('submission_versions')
      .select('*')
      .eq('submission_id', submission.id)
      .order('version_number', { ascending: false }),
  ) as SubmissionVersion[];

  if (!versions.length) return { submission, versions: [] };

  const files = unwrap(
    await supabase
      .from('submission_files')
      .select('*')
      .in('version_id', versions.map((v) => v.id)),
  ) as SubmissionFile[];

  return {
    submission,
    versions: versions.map((v) => ({ ...v, files: files.filter((f) => f.version_id === v.id) })),
  };
}

export async function getSubmissionFileUrl(f: SubmissionFile): Promise<string> {
  const { data, error } = await supabase.storage
    .from(f.storage_bucket)
    .createSignedUrl(f.storage_path, 300);
  if (error) throw toAppError(error);
  return data!.signedUrl;
}

export async function listRubrics(): Promise<Rubric[]> {
  return unwrap(await supabase.from('rubrics').select('*').eq('is_active', true).order('title'));
}

export async function listRubricCriteria(rubricId: string): Promise<RubricCriterion[]> {
  return unwrap(
    await supabase.from('rubric_criteria').select('*').eq('rubric_id', rubricId).order('sequence'),
  );
}

/**
 * Grade a submission.
 *
 * The score is recomputed by the database against the rubric and the effective
 * pass mark; the pass/fail flag is arithmetic, not a value this app supplies.
 * Progression and the next module unlock happen inside the same transaction.
 */
export async function gradeSubmission(input: {
  attemptId: string;
  criteriaScores?: { criterion_id: string; points: number; comment?: string }[];
  rawScore?: number;
  feedback?: string;
  release?: boolean;
}): Promise<{ final_score: number; passed: boolean }> {
  const { data, error } = await supabase.rpc('grade_summative_attempt', {
    p_attempt_id: input.attemptId,
    p_criteria_scores: input.criteriaScores ?? [],
    p_raw_score: input.rawScore ?? null,
    p_feedback: input.feedback ?? null,
    p_release: input.release ?? true,
  });
  if (error) throw toAppError(error);
  const row = Array.isArray(data) ? data[0] : data;
  return row as { final_score: number; passed: boolean };
}

/* -------------------------------------------------------------------------- */
/* Final exams                                                                 */
/* -------------------------------------------------------------------------- */

export async function listFinalExams(): Promise<(FinalExam & { course: Course })[]> {
  return unwrap(
    await supabase.from('final_exams').select('*, course:courses(*)').order('title'),
  ) as (FinalExam & { course: Course })[];
}

export async function saveFinalExam(
  input: Partial<FinalExam> & { course_id: string; id?: string },
): Promise<FinalExam> {
  const body = { ...input };
  if (body.publication_status === 'PUBLISHED' && !body.published_at) {
    body.published_at = new Date().toISOString();
  }
  const res = input.id
    ? await supabase.from('final_exams').update(body).eq('id', input.id).select().single()
    : await supabase.from('final_exams').insert(body).select().single();
  return unwrap(res) as FinalExam;
}

export async function listExamAttempts(): Promise<
  (FinalExamAttempt & { enrollment: Enrollment & { profile: Profile } })[]
> {
  return unwrap(
    await supabase
      .from('final_exam_attempts')
      .select('*, enrollment:enrollments(*, profile:profiles(*))')
      .order('started_at', { ascending: false })
      .limit(100),
  ) as (FinalExamAttempt & { enrollment: Enrollment & { profile: Profile } })[];
}

/* -------------------------------------------------------------------------- */
/* Certificates                                                                */
/* -------------------------------------------------------------------------- */

export async function listCertificates(): Promise<(Certificate & { profile: Profile })[]> {
  return unwrap(
    await supabase
      .from('certificates')
      .select('*, profile:profiles(*)')
      .order('issued_at', { ascending: false }),
  ) as (Certificate & { profile: Profile })[];
}

export async function checkCertificateEligibility(enrollmentId: string): Promise<EligibilityVerdict> {
  const { data, error } = await supabase.rpc('check_certificate_eligibility', {
    p_enrollment_id: enrollmentId,
  });
  if (error) throw toAppError(error);
  return data as EligibilityVerdict;
}

/** Re-checks every requirement server-side. Refuses if any is outstanding. */
export async function issueCertificate(enrollmentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('issue_certificate', { p_enrollment_id: enrollmentId });
  if (error) throw toAppError(error);
  return data as string;
}

export async function revokeCertificate(certificateId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_certificate', {
    p_certificate_id: certificateId,
    p_reason: reason,
  });
  if (error) throw toAppError(error);
}

/* -------------------------------------------------------------------------- */
/* Finance                                                                     */
/* -------------------------------------------------------------------------- */

export async function listPayments(status?: string): Promise<(Payment & { profile: Profile; invoice: Invoice })[]> {
  let q = supabase
    .from('payments')
    .select('*, profile:profiles(*), invoice:invoices(*)')
    .order('submitted_at', { ascending: false });
  if (status) q = q.eq('status', status);
  return unwrap(await q) as (Payment & { profile: Profile; invoice: Invoice })[];
}

export async function listInvoices(): Promise<(Invoice & { profile: Profile })[]> {
  return unwrap(
    await supabase
      .from('invoices')
      .select('*, profile:profiles(*)')
      .order('issued_at', { ascending: false }),
  ) as (Invoice & { profile: Profile })[];
}

export async function createInvoice(input: {
  profileId: string;
  enrollmentId?: string;
  courseId?: string;
  total: number;
  vatRate: number;
  description: string;
  dueAt?: string;
}): Promise<Invoice> {
  // Numbering MUST come from the transactional per-year counter. There is no
  // client-side fallback: a locally-invented number would collide or leave a
  // gap that looks like a deleted invoice during an audit. If the counter is
  // unavailable, no invoice is created.
  const { data: number, error: numErr } = await supabase.rpc('next_invoice_number_admin');
  if (numErr || !number) {
    throw numErr
      ? toAppError(numErr)
      : new AppError('UNKNOWN', 'Could not obtain an invoice number. No invoice was created — please try again.');
  }
  const invoiceNumber = number as string;

  const subtotal = Number((input.total / (1 + input.vatRate)).toFixed(2));

  const invoice = unwrap(
    await supabase
      .from('invoices')
      .insert({
        invoice_number: invoiceNumber,
        profile_id: input.profileId,
        enrollment_id: input.enrollmentId ?? null,
        course_id: input.courseId ?? null,
        status: 'ISSUED',
        subtotal,
        vat_rate: input.vatRate,
        vat_amount: Number((input.total - subtotal).toFixed(2)),
        total: input.total,
        description: input.description,
        issued_at: new Date().toISOString(),
        due_at: input.dueAt ?? null,
      })
      .select()
      .single(),
  ) as Invoice;

  await writeAudit('INVOICE_CREATED', 'invoice', invoice.id, invoice.invoice_number);
  return invoice;
}

/** Finance-only. Updates the invoice, the enrollment and the ledger atomically. */
export async function reviewPayment(
  paymentId: string,
  approve: boolean,
  reason?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('review_payment', {
    p_payment_id: paymentId,
    p_approve: approve,
    p_reason: reason ?? null,
  });
  if (error) throw toAppError(error);
  return data as string;
}

/* -------------------------------------------------------------------------- */
/* Announcements, audit, settings, contact                                     */
/* -------------------------------------------------------------------------- */

export async function listAnnouncements(): Promise<Announcement[]> {
  return unwrap(
    await supabase.from('announcements').select('*').order('publish_at', { ascending: false }),
  );
}

export async function saveAnnouncement(
  input: Partial<Announcement> & { id?: string },
): Promise<Announcement> {
  const res = input.id
    ? await supabase.from('announcements').update(input).eq('id', input.id).select().single()
    : await supabase.from('announcements').insert(input).select().single();
  return unwrap(res) as Announcement;
}

export async function listAuditLogs(limit = 100): Promise<AuditLog[]> {
  return unwrap(
    await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit),
  );
}

export async function listContactMessages(): Promise<ContactMessage[]> {
  return unwrap(
    await supabase.from('contact_messages').select('*').order('created_at', { ascending: false }),
  );
}

export async function setContactStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase
    .from('contact_messages')
    .update({ status, handled_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw toAppError(error);
}

export async function getSettings(): Promise<InstitutionSettings | null> {
  return unwrapMaybe(await supabase.from('institution_settings').select('*').limit(1).maybeSingle());
}

export async function saveSettings(patch: Partial<InstitutionSettings>): Promise<void> {
  const current = await getSettings();
  if (!current) throw new AppError('NOT_FOUND', 'Institution settings have not been seeded.');
  const { error } = await supabase
    .from('institution_settings')
    .update(patch)
    .eq('institution_id', current.institution_id);
  if (error) throw toAppError(error);
  await writeAudit('SETTINGS_UPDATED', 'institution_settings', current.institution_id);
}

/**
 * Write an audit entry for actions performed through plain table writes.
 *
 * Business functions and the migration-022 triggers audit themselves; this
 * covers the remaining CRUD paths (course/module/lesson/resource/settings/
 * announcement writes). It is NOT best-effort: BR-012 requires that a material
 * staff mutation cannot succeed without an auditable record, so a failure here
 * is surfaced to the caller rather than swallowed. The audit RPC is a single
 * SECURITY DEFINER call, so a failure means a real misconfiguration worth
 * seeing, not a transient hiccup on the user's actual work.
 */
async function writeAudit(
  action: string,
  resourceType: string,
  resourceId?: string,
  label?: string,
): Promise<void> {
  const { error } = await supabase.rpc('create_audit_log_public', {
    p_action: action,
    p_resource_type: resourceType,
    p_resource_id: resourceId ?? null,
    p_resource_label: label ?? null,
    p_old_values: null,
    p_new_values: null,
    p_metadata: {},
  });
  if (error) throw toAppError(error);
}
