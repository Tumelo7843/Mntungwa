import { supabase, unwrap, unwrapMaybe, toAppError, AppError } from '@/lib/supabase';
import type {
  Announcement,
  Certificate,
  CertificateVerification,
  Course,
  CourseModule,
  EligibilityVerdict,
  Enrollment,
  FinalExam,
  FinalExamAttempt,
  FinalExamQuestion,
  FinalExamResult,
  FormativeAssessment,
  FormativeAttempt,
  FormativeQuestion,
  FormativeResult,
  Grade,
  Institution,
  Invoice,
  LearningResource,
  Lesson,
  LessonProgress,
  ModuleProgress,
  Notification,
  Payment,
  Profile,
  QuestionOptionPublic,
  Submission,
  SummativeAssessment,
  SummativeAttempt,
} from '@/lib/database.types';

/**
 * Service layer.
 *
 * The single place the learner app talks to the database. Components never
 * import `supabase` directly.
 *
 * Note what is absent: nothing here writes a score, a status, a credit total
 * or an eligibility flag. Those are produced by database functions
 * (`submit_formative_attempt`, `grade_summative_attempt`,
 * `check_certificate_eligibility`, …) which the client can only invoke, not
 * override. See mntungwa-lms-backend/docs/RLS.md.
 */

/* -------------------------------------------------------------------------- */
/* Institution & catalogue (public)                                            */
/* -------------------------------------------------------------------------- */

export async function getInstitution(): Promise<Institution | null> {
  return unwrapMaybe(await supabase.from('institution').select('*').limit(1).maybeSingle());
}

export async function listPublishedCourses(): Promise<Course[]> {
  return unwrap(
    await supabase
      .from('courses')
      .select('*')
      .eq('publication_status', 'PUBLISHED')
      .order('title'),
  );
}

export async function getCourseByCode(code: string): Promise<Course | null> {
  return unwrapMaybe(
    await supabase.from('courses').select('*').eq('code', code).maybeSingle(),
  );
}

export async function getCourse(courseId: string): Promise<Course | null> {
  return unwrapMaybe(await supabase.from('courses').select('*').eq('id', courseId).maybeSingle());
}

/** Public module outline for the catalogue. Only titles — never content. */
export async function listCourseModules(courseId: string): Promise<CourseModule[]> {
  return unwrap(
    await supabase
      .from('course_modules')
      .select('*')
      .eq('course_id', courseId)
      .eq('publication_status', 'PUBLISHED')
      .order('sequence'),
  );
}

export async function submitContactMessage(input: {
  name: string;
  email: string;
  phone?: string;
  subject?: string;
  message: string;
}): Promise<void> {
  const { error } = await supabase.from('contact_messages').insert({
    name: input.name.trim(),
    email: input.email.trim(),
    phone: input.phone?.trim() || null,
    subject: input.subject?.trim() || null,
    message: input.message.trim(),
    status: 'NEW',
  });
  if (error) throw toAppError(error);
}

/* -------------------------------------------------------------------------- */
/* Enrollment                                                                  */
/* -------------------------------------------------------------------------- */

export async function listMyEnrollments(): Promise<(Enrollment & { course: Course })[]> {
  return unwrap(
    await supabase
      .from('enrollments')
      .select('*, course:courses(*)')
      .order('applied_at', { ascending: false }),
  ) as (Enrollment & { course: Course })[];
}

export async function getMyPrimaryEnrollment(): Promise<(Enrollment & { course: Course }) | null> {
  const all = await listMyEnrollments();
  // Prefer an active enrollment, then the most recent of any status.
  return all.find((e) => e.status === 'ACTIVE') ?? all[0] ?? null;
}

/** Apply for a course. RLS pins status to PENDING and all flags to false. */
export async function applyForCourse(courseId: string, cohortId?: string): Promise<Enrollment> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) throw new AppError('UNAUTHORIZED', 'Please sign in to enrol.');

  return unwrap(
    await supabase
      .from('enrollments')
      .insert({ profile_id: uid, course_id: courseId, cohort_id: cohortId ?? null, status: 'PENDING' })
      .select()
      .single(),
  );
}

/* -------------------------------------------------------------------------- */
/* Roadmap & progress                                                          */
/* -------------------------------------------------------------------------- */

export interface RoadmapEntry {
  module: CourseModule;
  progress: ModuleProgress | null;
}

export async function getRoadmap(enrollment: Enrollment): Promise<RoadmapEntry[]> {
  const [modules, progress] = await Promise.all([
    listCourseModules(enrollment.course_id),
    supabase.from('module_progress').select('*').eq('enrollment_id', enrollment.id),
  ]);
  if (progress.error) throw toAppError(progress.error);

  const byModule = new Map((progress.data as ModuleProgress[]).map((p) => [p.module_id, p]));
  return modules.map((module) => ({ module, progress: byModule.get(module.id) ?? null }));
}

/** First module that is open but not yet passed — the demo's currentModuleId. */
export function currentModule(roadmap: RoadmapEntry[]): RoadmapEntry | null {
  return (
    roadmap.find((r) => r.progress && !['LOCKED', 'PASSED'].includes(r.progress.status)) ?? null
  );
}

export async function getModule(moduleId: string): Promise<CourseModule | null> {
  return unwrapMaybe(
    await supabase.from('course_modules').select('*').eq('id', moduleId).maybeSingle(),
  );
}

export async function getModuleProgress(
  enrollmentId: string,
  moduleId: string,
): Promise<ModuleProgress | null> {
  return unwrapMaybe(
    await supabase
      .from('module_progress')
      .select('*')
      .eq('enrollment_id', enrollmentId)
      .eq('module_id', moduleId)
      .maybeSingle(),
  );
}

/**
 * Everything needed to render a module page.
 * If the module is locked, RLS returns nothing for lessons and assessments —
 * that is the intended behaviour, not an error.
 */
export interface ModuleDetail {
  module: CourseModule;
  progress: ModuleProgress | null;
  lessons: (Lesson & { done: boolean })[];
  resources: LearningResource[];
  formative: FormativeAssessment[];
  summative: SummativeAssessment[];
  attempts: { formative: FormativeAttempt[]; summative: SummativeAttempt[] };
}

export async function getModuleDetail(
  enrollmentId: string,
  moduleId: string,
): Promise<ModuleDetail> {
  const module = await getModule(moduleId);
  if (!module) throw new AppError('NOT_FOUND', 'That module could not be found.');

  const [progress, lessonsRes, moduleResRes, formativeRes, summativeRes, lessonProgRes] =
    await Promise.all([
      getModuleProgress(enrollmentId, moduleId),
      supabase
        .from('lessons')
        .select('*')
        .eq('module_id', moduleId)
        .eq('publication_status', 'PUBLISHED')
        .order('sequence'),
      supabase
        .from('learning_resources')
        .select('*')
        .eq('module_id', moduleId)
        .eq('is_archived', false)
        .order('sequence'),
      supabase
        .from('formative_assessments')
        .select('*')
        .eq('module_id', moduleId)
        .eq('publication_status', 'PUBLISHED')
        .order('sequence'),
      supabase
        .from('summative_assessments')
        .select('*')
        .eq('module_id', moduleId)
        .eq('publication_status', 'PUBLISHED')
        .order('sequence'),
      supabase.from('lesson_progress').select('*').eq('enrollment_id', enrollmentId),
    ]);

  for (const r of [lessonsRes, moduleResRes, formativeRes, summativeRes, lessonProgRes]) {
    if (r.error) throw toAppError(r.error);
  }

  const lessons = (lessonsRes.data ?? []) as Lesson[];
  const lessonIds = lessons.map((l) => l.id);

  // Lesson-scoped resources, fetched only when there are lessons to scope to.
  let lessonResources: LearningResource[] = [];
  if (lessonIds.length) {
    const res = await supabase
      .from('learning_resources')
      .select('*')
      .in('lesson_id', lessonIds)
      .eq('is_archived', false)
      .order('sequence');
    if (res.error) throw toAppError(res.error);
    lessonResources = (res.data ?? []) as LearningResource[];
  }

  const formative = (formativeRes.data ?? []) as FormativeAssessment[];
  const summative = (summativeRes.data ?? []) as SummativeAssessment[];

  const [fAtt, sAtt] = await Promise.all([
    formative.length
      ? supabase
          .from('formative_attempts')
          .select('*')
          .eq('enrollment_id', enrollmentId)
          .in('assessment_id', formative.map((f) => f.id))
      : Promise.resolve({ data: [], error: null }),
    summative.length
      ? supabase
          .from('summative_attempts')
          .select('*')
          .eq('enrollment_id', enrollmentId)
          .in('assessment_id', summative.map((s) => s.id))
      : Promise.resolve({ data: [], error: null }),
  ]);

  const done = new Set(
    ((lessonProgRes.data ?? []) as LessonProgress[])
      .filter((p) => p.status === 'COMPLETED')
      .map((p) => p.lesson_id),
  );

  return {
    module,
    progress,
    lessons: lessons.map((l) => ({ ...l, done: done.has(l.id) })),
    resources: [...((moduleResRes.data ?? []) as LearningResource[]), ...lessonResources],
    formative,
    summative,
    attempts: {
      formative: (fAtt.data ?? []) as FormativeAttempt[],
      summative: (sAtt.data ?? []) as SummativeAttempt[],
    },
  };
}

export async function getLesson(
  lessonId: string,
): Promise<{ lesson: Lesson; resources: LearningResource[] } | null> {
  const lesson = unwrapMaybe(
    await supabase.from('lessons').select('*').eq('id', lessonId).maybeSingle(),
  ) as Lesson | null;
  if (!lesson) return null;

  const resources = unwrap(
    await supabase
      .from('learning_resources')
      .select('*')
      .eq('lesson_id', lessonId)
      .eq('is_archived', false)
      .order('sequence'),
  ) as LearningResource[];

  return { lesson, resources };
}

/** Calls the database function, which also recalculates module progress. */
export async function completeLesson(lessonId: string): Promise<string> {
  const { data, error } = await supabase.rpc('complete_lesson', { p_lesson_id: lessonId });
  if (error) throw toAppError(error);
  return data as string;
}

/**
 * Signed URL for a private document. The Storage policy is evaluated when the
 * URL is minted, so an unauthorised learner cannot obtain one.
 */
export async function getResourceUrl(resource: LearningResource): Promise<string> {
  const { data, error } = await supabase.storage
    .from(resource.storage_bucket)
    .createSignedUrl(resource.storage_path, 300);
  if (error) throw toAppError(error);
  if (!data?.signedUrl) throw new AppError('FORBIDDEN', 'You do not have access to that document.');
  return data.signedUrl;
}

/* -------------------------------------------------------------------------- */
/* Formative assessment                                                        */
/* -------------------------------------------------------------------------- */

export async function getFormativeAssessment(id: string): Promise<FormativeAssessment | null> {
  return unwrapMaybe(
    await supabase.from('formative_assessments').select('*').eq('id', id).maybeSingle(),
  );
}

export async function listFormativeAttempts(
  enrollmentId: string,
  assessmentId: string,
): Promise<FormativeAttempt[]> {
  return unwrap(
    await supabase
      .from('formative_attempts')
      .select('*')
      .eq('enrollment_id', enrollmentId)
      .eq('assessment_id', assessmentId)
      .order('attempt_number', { ascending: false }),
  );
}

export async function startFormativeAttempt(assessmentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_formative_attempt', {
    p_assessment_id: assessmentId,
  });
  if (error) throw toAppError(error);
  return data as string;
}

export interface AttemptPaper {
  attempt: FormativeAttempt;
  questions: (FormativeQuestion & { options: QuestionOptionPublic[] })[];
}

/**
 * Load the paper for an attempt.
 *
 * Options come from `formative_options_public`, a view that structurally omits
 * `is_correct`. The base table grants learners no read access at all — this is
 * the fix for the demo shipping 20 answer keys in its JavaScript bundle.
 */
export async function getFormativePaper(attemptId: string): Promise<AttemptPaper> {
  const attempt = unwrap(
    await supabase.from('formative_attempts').select('*').eq('id', attemptId).single(),
  ) as FormativeAttempt;

  if (!attempt.question_ids.length) {
    return { attempt, questions: [] };
  }

  const [qRes, oRes] = await Promise.all([
    supabase.from('formative_questions').select('*').in('id', attempt.question_ids),
    supabase.from('formative_options_public').select('*').in('question_id', attempt.question_ids),
  ]);
  if (qRes.error) throw toAppError(qRes.error);
  if (oRes.error) throw toAppError(oRes.error);

  const options = (oRes.data ?? []) as QuestionOptionPublic[];
  const questions = (qRes.data ?? []) as FormativeQuestion[];

  // Preserve the order fixed at attempt start rather than re-sorting.
  const ordered = attempt.question_ids
    .map((id) => questions.find((q) => q.id === id))
    .filter((q): q is FormativeQuestion => Boolean(q));

  return {
    attempt,
    questions: ordered.map((q) => ({
      ...q,
      options: options.filter((o) => o.question_id === q.id).sort((a, b) => a.sequence - b.sequence),
    })),
  };
}

export async function saveFormativeAnswer(
  attemptId: string,
  questionId: string,
  optionIds: string[],
): Promise<void> {
  const { error } = await supabase.rpc('save_formative_answer', {
    p_attempt_id: attemptId,
    p_question_id: questionId,
    p_option_ids: optionIds,
    p_text: null,
  });
  if (error) throw toAppError(error);
}

/** Grading happens in the database. The client sends no score. */
export async function submitFormativeAttempt(attemptId: string): Promise<FormativeResult> {
  const { data, error } = await supabase.rpc('submit_formative_attempt', {
    p_attempt_id: attemptId,
  });
  if (error) throw toAppError(error);
  const row = Array.isArray(data) ? data[0] : data;
  return row as FormativeResult;
}

/* -------------------------------------------------------------------------- */
/* Summative assessment & submissions                                          */
/* -------------------------------------------------------------------------- */

export async function getSummativeAssessment(id: string): Promise<SummativeAssessment | null> {
  return unwrapMaybe(
    await supabase.from('summative_assessments').select('*').eq('id', id).maybeSingle(),
  );
}

export async function listSummativeAttempts(
  enrollmentId: string,
  assessmentId: string,
): Promise<SummativeAttempt[]> {
  return unwrap(
    await supabase
      .from('summative_attempts')
      .select('*')
      .eq('enrollment_id', enrollmentId)
      .eq('assessment_id', assessmentId)
      .order('attempt_number', { ascending: false }),
  );
}

export async function startSummativeAttempt(assessmentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_summative_attempt', {
    p_assessment_id: assessmentId,
  });
  if (error) throw toAppError(error);
  return data as string;
}

export async function getSubmission(attemptId: string): Promise<Submission | null> {
  return unwrapMaybe(
    await supabase.from('submissions').select('*').eq('attempt_id', attemptId).maybeSingle(),
  );
}

export interface UploadedEvidence {
  fileName: string;
  size: number;
}

/**
 * Upload evidence for a submission.
 *
 * Atomicity: every file is uploaded to a staging folder first, then
 * `finalize_submission_version` writes the version row and all file rows in a
 * single database transaction. A failure part-way therefore leaves no orphaned
 * `submission_versions` / `submission_files` rows — only staged Storage objects,
 * which this function removes on its way out via the narrow
 * `learner_submissions_delete_orphan` policy (own enrollment folder, object not
 * yet referenced by any metadata row).
 *
 * Path convention is load-bearing: the Storage policy reads segment 1 as the
 * enrollment id and only permits a learner to write under their own, and the
 * finalize function rejects any path outside `{enrollment}/{assessment}/`.
 * See mntungwa-lms-backend/docs/STORAGE.md.
 */
export async function uploadSubmissionFiles(params: {
  enrollmentId: string;
  assessmentId: string;
  attemptId: string;
  files: File[];
  note?: string;
}): Promise<UploadedEvidence[]> {
  const { enrollmentId, assessmentId, attemptId, files, note } = params;
  if (!files.length) throw new AppError('VALIDATION', 'Choose at least one file to upload.');

  const stagingId = crypto.randomUUID();
  const uploadedPaths: string[] = [];
  const fileMeta: {
    storage_path: string;
    file_name: string;
    mime_type: string;
    file_size_bytes: number;
  }[] = [];

  const cleanupStaged = async () => {
    if (!uploadedPaths.length) return;
    // Best-effort: the finalize transaction has already rolled back, so these
    // objects are unreferenced and safe to drop. A failure here is logged, not
    // thrown — it must not mask the original error.
    const { error } = await supabase.storage.from('learner-submissions').remove(uploadedPaths);
    if (error) console.warn('Could not remove staged upload objects:', error.message);
  };

  try {
    for (const file of files) {
      const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-120);
      const path = `${enrollmentId}/${assessmentId}/${stagingId}/${crypto.randomUUID()}-${safeName}`;

      const up = await supabase.storage.from('learner-submissions').upload(path, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
      if (up.error) throw toAppError(up.error);

      uploadedPaths.push(path);
      fileMeta.push({
        storage_path: path,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        file_size_bytes: file.size,
      });
    }

    const { error } = await supabase.rpc('finalize_submission_version', {
      p_attempt_id: attemptId,
      p_note: note ?? null,
      p_files: fileMeta,
    });
    if (error) throw toAppError(error);
  } catch (err) {
    await cleanupStaged();
    throw err instanceof AppError ? err : toAppError(err);
  }

  return files.map((f) => ({ fileName: f.name, size: f.size }));
}

/** Refuses server-side if the required evidence is missing. */
export async function submitSummativeAttempt(attemptId: string, note?: string): Promise<string> {
  const { data, error } = await supabase.rpc('submit_summative_attempt', {
    p_attempt_id: attemptId,
    p_note: note ?? null,
  });
  if (error) throw toAppError(error);
  return data as string;
}

export async function listMyFeedback(enrollmentId: string, attemptId: string) {
  return unwrap(
    await supabase
      .from('feedback')
      .select('*')
      .eq('enrollment_id', enrollmentId)
      .eq('summative_attempt_id', attemptId)
      .order('created_at'),
  );
}

/* -------------------------------------------------------------------------- */
/* Final exam                                                                  */
/* -------------------------------------------------------------------------- */

export async function getFinalExam(courseId: string): Promise<FinalExam | null> {
  return unwrapMaybe(
    await supabase
      .from('final_exams')
      .select('*')
      .eq('course_id', courseId)
      .eq('publication_status', 'PUBLISHED')
      .maybeSingle(),
  );
}

/** Server-evaluated. The client never decides eligibility. */
export async function checkFinalExamEligibility(
  enrollmentId: string,
): Promise<EligibilityVerdict> {
  const { data, error } = await supabase.rpc('check_final_exam_eligibility', {
    p_enrollment_id: enrollmentId,
  });
  if (error) throw toAppError(error);
  return data as EligibilityVerdict;
}

export async function listFinalExamAttempts(enrollmentId: string): Promise<FinalExamAttempt[]> {
  return unwrap(
    await supabase
      .from('final_exam_attempts')
      .select('*')
      .eq('enrollment_id', enrollmentId)
      .order('attempt_number', { ascending: false }),
  );
}

export async function startFinalExamAttempt(enrollmentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_final_exam_attempt', {
    p_enrollment_id: enrollmentId,
  });
  if (error) throw toAppError(error);
  return data as string;
}

export interface ExamPaper {
  attempt: FinalExamAttempt;
  questions: (FinalExamQuestion & { options: QuestionOptionPublic[] })[];
}

export async function getExamPaper(attemptId: string): Promise<ExamPaper> {
  const attempt = unwrap(
    await supabase.from('final_exam_attempts').select('*').eq('id', attemptId).single(),
  ) as FinalExamAttempt;

  if (!attempt.question_ids.length) return { attempt, questions: [] };

  const [qRes, oRes] = await Promise.all([
    supabase.from('final_exam_questions').select('*').in('id', attempt.question_ids),
    supabase.from('final_exam_options_public').select('*').in('question_id', attempt.question_ids),
  ]);
  if (qRes.error) throw toAppError(qRes.error);
  if (oRes.error) throw toAppError(oRes.error);

  const questions = (qRes.data ?? []) as FinalExamQuestion[];
  const options = (oRes.data ?? []) as QuestionOptionPublic[];

  const ordered = attempt.question_ids
    .map((id) => questions.find((q) => q.id === id))
    .filter((q): q is FinalExamQuestion => Boolean(q));

  return {
    attempt,
    questions: ordered.map((q) => ({
      ...q,
      options: options.filter((o) => o.question_id === q.id).sort((a, b) => a.sequence - b.sequence),
    })),
  };
}

export async function saveExamAnswer(
  attemptId: string,
  questionId: string,
  optionIds: string[],
): Promise<void> {
  const { error } = await supabase.rpc('save_final_exam_answer', {
    p_attempt_id: attemptId,
    p_question_id: questionId,
    p_option_ids: optionIds,
    p_text: null,
  });
  if (error) throw toAppError(error);
}

export async function submitExam(attemptId: string): Promise<FinalExamResult> {
  const { data, error } = await supabase.rpc('submit_final_exam_attempt', {
    p_attempt_id: attemptId,
  });
  if (error) throw toAppError(error);
  return data as FinalExamResult;
}

/* -------------------------------------------------------------------------- */
/* Results & certificate                                                       */
/* -------------------------------------------------------------------------- */

/** RLS returns only released grades. Unreleased results are invisible. */
export async function listMyGrades(enrollmentId: string): Promise<Grade[]> {
  return unwrap(
    await supabase
      .from('grades')
      .select('*')
      .eq('enrollment_id', enrollmentId)
      .eq('is_superseded', false)
      .order('graded_at', { ascending: false }),
  );
}

export async function checkCertificateEligibility(
  enrollmentId: string,
): Promise<EligibilityVerdict> {
  const { data, error } = await supabase.rpc('check_certificate_eligibility', {
    p_enrollment_id: enrollmentId,
  });
  if (error) throw toAppError(error);
  return data as EligibilityVerdict;
}

export async function getMyCertificate(enrollmentId: string): Promise<Certificate | null> {
  return unwrapMaybe(
    await supabase
      .from('certificates')
      .select('*')
      .eq('enrollment_id', enrollmentId)
      .eq('status', 'ISSUED')
      .maybeSingle(),
  );
}

/** Public. Returns only what appears on the certificate face. */
export async function verifyCertificate(
  certificateNumber: string,
  token?: string,
): Promise<CertificateVerification> {
  const { data, error } = await supabase.rpc('verify_certificate', {
    p_certificate_number: certificateNumber,
    p_token: token ?? null,
  });
  if (error) throw toAppError(error);
  return data as CertificateVerification;
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

export async function listMyInvoices(): Promise<Invoice[]> {
  return unwrap(
    await supabase.from('invoices').select('*').order('issued_at', { ascending: false }),
  );
}

export async function listMyPayments(): Promise<Payment[]> {
  return unwrap(
    await supabase.from('payments').select('*').order('submitted_at', { ascending: false }),
  );
}

/**
 * Declare a payment and attach proof.
 * RLS pins status to SUBMITTED — a learner cannot record their own payment as
 * approved. Finance reviews it via review_payment().
 */
export async function declarePayment(input: {
  invoiceId: string;
  amount: number;
  method: 'EFT' | 'CASH' | 'CARD' | 'BURSARY' | 'EMPLOYER' | 'OTHER';
  reference?: string;
  paidOn?: string;
  proof?: File;
}): Promise<Payment> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) throw new AppError('UNAUTHORIZED', 'Please sign in.');

  const payment = unwrap(
    await supabase
      .from('payments')
      .insert({
        invoice_id: input.invoiceId,
        profile_id: uid,
        status: 'SUBMITTED',
        method: input.method,
        amount: input.amount,
        reference: input.reference ?? null,
        paid_on: input.paidOn ?? null,
      })
      .select()
      .single(),
  ) as Payment;

  if (input.proof) {
    // Segment 1 must be the profile id — the Storage policy checks it.
    const safe = input.proof.name.replace(/[^\w.\-]+/g, '_').slice(-120);
    const path = `${uid}/${input.invoiceId}/${crypto.randomUUID()}-${safe}`;

    const up = await supabase.storage.from('payment-proofs').upload(path, input.proof, {
      contentType: input.proof.type || 'application/octet-stream',
    });
    if (up.error) throw toAppError(up.error);

    const meta = await supabase.from('payment_proofs').insert({
      payment_id: payment.id,
      storage_bucket: 'payment-proofs',
      storage_path: path,
      file_name: input.proof.name,
      mime_type: input.proof.type || 'application/octet-stream',
      file_size_bytes: input.proof.size,
    });
    if (meta.error) throw toAppError(meta.error);
  }

  return payment;
}

/* -------------------------------------------------------------------------- */
/* Notifications, announcements, profile                                       */
/* -------------------------------------------------------------------------- */

export async function listNotifications(limit = 50): Promise<Notification[]> {
  return unwrap(
    await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit),
  );
}

/** Unread count for the navigation badge. RLS scopes it to the caller's rows. */
export async function countUnreadNotifications(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false);
  if (error) throw toAppError(error);
  return count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw toAppError(error);
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('is_read', false);
  if (error) throw toAppError(error);
}

export async function listAnnouncements(): Promise<Announcement[]> {
  return unwrap(
    await supabase
      .from('announcements')
      .select('*')
      .order('is_pinned', { ascending: false })
      .order('publish_at', { ascending: false })
      .limit(10),
  );
}

export async function updateMyProfile(patch: {
  full_name?: string;
  preferred_name?: string | null;
  phone?: string | null;
}): Promise<Profile> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) throw new AppError('UNAUTHORIZED', 'Please sign in.');

  // account_status and email are deliberately not settable here: a database
  // trigger rejects those changes from anyone but an administrator.
  return unwrap(
    await supabase.from('profiles').update(patch).eq('id', uid).select().single(),
  );
}
