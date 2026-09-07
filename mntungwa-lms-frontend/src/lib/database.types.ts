/**
 * Database types for the Mntungwa LMS.
 *
 * Hand-maintained to match `mntungwa-lms-backend/supabase/migrations`.
 * Once the backend is deployed, regenerate instead of editing by hand:
 *
 *   supabase gen types typescript --project-id <ref> > src/lib/database.types.ts
 *
 * Only the columns the applications actually read are declared. Anything the
 * client is not permitted to write (scores, statuses, eligibility) is typed
 * readonly-in-spirit: there is no Insert/Update shape for it, because those
 * values are produced by database functions.
 */

export type AppRole = 'ADMIN' | 'INSTRUCTOR' | 'ASSESSOR' | 'LEARNER' | 'FINANCE' | 'SUPPORT';

export type AccountStatus =
  | 'PENDING_VERIFICATION'
  | 'PENDING_PAYMENT'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'WITHDRAWN';

export type PublicationStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export type EnrollmentStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'COMPLETED'
  | 'WITHDRAWN'
  | 'EXPIRED';

export type ProgressStatus =
  | 'LOCKED'
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'PASSED'
  | 'FAILED'
  | 'RESUBMISSION_REQUIRED';

export type SubmissionStatus =
  | 'DRAFT'
  | 'OPEN'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'PASSED'
  | 'FAILED'
  | 'RESUBMISSION_REQUIRED'
  | 'CLOSED';

export type AttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'GRADED' | 'ABANDONED' | 'EXPIRED';

export type QuestionType =
  | 'MULTIPLE_CHOICE'
  | 'TRUE_FALSE'
  | 'MULTIPLE_SELECT'
  | 'SHORT_ANSWER'
  | 'ESSAY'
  | 'FILE_UPLOAD';

export type CertificateStatus = 'ISSUED' | 'REVOKED' | 'REPLACED';

export type InvoiceStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'
  | 'CANCELLED';

export type PaymentStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
export type PaymentMethod = 'EFT' | 'CASH' | 'CARD' | 'BURSARY' | 'EMPLOYER' | 'OTHER';

export interface Institution {
  id: string;
  name: string;
  legal_name: string | null;
  accreditation_body: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  province: string | null;
  country: string;
  logo_path: string | null;
  accent_color: string;
}

export interface InstitutionSettings {
  institution_id: string;
  default_pass_mark: number;
  min_cohort_size: number;
  certificate_prefix: string;
  certificate_signatory_name: string | null;
  certificate_signatory_title: string | null;
  max_resource_bytes: number;
  max_submission_bytes: number;
  allowed_resource_mime: string[];
  allowed_submission_mime: string[];
  currency: string;
  vat_rate: number;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  preferred_name: string | null;
  phone: string | null;
  id_number: string | null;
  avatar_path: string | null;
  account_status: AccountStatus;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  profile_id: string;
  role: AppRole;
  granted_at: string;
}

export interface Cohort {
  id: string;
  code: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  summary: string | null;
  qualification_body: string | null;
  qualification_id: string | null;
  nqf_level: number | null;
  total_credits: number | null;
  outcomes: string[];
  requirements: string[];
  target_audience: string | null;
  duration_months: number | null;
  pass_mark: number | null;
  require_final_exam: boolean;
  issues_certificate: boolean;
  price: number | null;
  price_includes_vat: boolean;
  publication_status: PublicationStatus;
  published_at: string | null;
  created_at: string;
}

export interface CourseModule {
  id: string;
  course_id: string;
  code: string;
  title: string;
  description: string | null;
  track: string | null;
  sequence: number;
  credits: number;
  outcomes: string[];
  estimated_hours: number | null;
  prerequisite_module_id: string | null;
  is_required: boolean;
  pass_mark: number | null;
  require_all_lessons: boolean;
  require_formative: boolean;
  require_summative: boolean;
  publication_status: PublicationStatus;
  published_at: string | null;
}

export interface Lesson {
  id: string;
  module_id: string;
  title: string;
  summary: string | null;
  body: string | null;
  sequence: number;
  estimated_minutes: number | null;
  is_required: boolean;
  publication_status: PublicationStatus;
  published_at: string | null;
}

export interface LearningResource {
  id: string;
  lesson_id: string | null;
  module_id: string | null;
  course_id: string | null;
  title: string;
  description: string | null;
  category: string | null;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  version: number;
  is_archived: boolean;
  is_downloadable: boolean;
  sequence: number;
  created_at: string;
}

export interface Enrollment {
  id: string;
  profile_id: string;
  course_id: string;
  cohort_id: string | null;
  status: EnrollmentStatus;
  status_reason: string | null;
  status_changed_at: string | null;
  documents_verified: boolean;
  payment_cleared: boolean;
  applied_at: string;
  activated_at: string | null;
  completed_at: string | null;
  modules_total: number;
  modules_passed: number;
  credits_earned: number;
  progress_percent: number;
  final_exam_passed: boolean;
  course_completed: boolean;
}

export interface LessonProgress {
  id: string;
  enrollment_id: string;
  lesson_id: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  completed_at: string | null;
}

export interface ModuleProgress {
  id: string;
  enrollment_id: string;
  module_id: string;
  status: ProgressStatus;
  lessons_total: number;
  lessons_completed: number;
  formatives_required: number;
  formatives_passed: number;
  summatives_required: number;
  summatives_passed: number;
  best_score: number | null;
  credits_awarded: number;
  unlocked_at: string | null;
  completed_at: string | null;
  passed_at: string | null;
}

export interface FormativeAssessment {
  id: string;
  module_id: string;
  lesson_id: string | null;
  title: string;
  instructions: string | null;
  pass_mark: number | null;
  max_attempts: number | null;
  is_required: boolean;
  time_limit_minutes: number | null;
  show_correct_answers: boolean;
  sequence: number;
  publication_status: PublicationStatus;
  published_at: string | null;
}

export interface FormativeQuestion {
  id: string;
  assessment_id: string;
  question_type: QuestionType;
  prompt: string;
  help_text: string | null;
  explanation: string | null;
  points: number;
  sequence: number;
  is_active: boolean;
}

/** Safe view. Deliberately has no `is_correct` — see backend docs/RLS.md. */
export interface QuestionOptionPublic {
  id: string;
  question_id: string;
  label: string;
  sequence: number;
}

/** Base table. Only readable by staff. */
export interface QuestionOption extends QuestionOptionPublic {
  is_correct: boolean;
  feedback: string | null;
}

export interface FormativeAttempt {
  id: string;
  enrollment_id: string;
  assessment_id: string;
  attempt_number: number;
  status: AttemptStatus;
  question_ids: string[];
  started_at: string;
  expires_at: string | null;
  submitted_at: string | null;
  points_earned: number | null;
  points_possible: number | null;
  score_percent: number | null;
  passed: boolean | null;
}

export interface FormativeAnswer {
  id: string;
  attempt_id: string;
  question_id: string;
  selected_option_ids: string[];
  text_answer: string | null;
  is_correct: boolean | null;
  points_awarded: number | null;
}

export interface SummativeAssessment {
  id: string;
  module_id: string;
  title: string;
  instructions: string | null;
  task_brief: string | null;
  pass_mark: number | null;
  max_attempts: number;
  is_required: boolean;
  has_questions: boolean;
  requires_submission: boolean;
  min_files: number;
  max_files: number;
  allow_resubmission: boolean;
  question_weight: number;
  submission_weight: number;
  rubric_id: string | null;
  due_at: string | null;
  sequence: number;
  publication_status: PublicationStatus;
  published_at: string | null;
}

export interface SummativeAttempt {
  id: string;
  enrollment_id: string;
  assessment_id: string;
  attempt_number: number;
  status: SubmissionStatus;
  started_at: string;
  submitted_at: string | null;
  graded_at: string | null;
  assigned_assessor_id: string | null;
  question_score: number | null;
  submission_score: number | null;
  final_score: number | null;
  passed: boolean | null;
  assessor_feedback: string | null;
}

export interface Submission {
  id: string;
  attempt_id: string;
  enrollment_id: string;
  status: SubmissionStatus;
  current_version: number;
  first_submitted_at: string | null;
  last_submitted_at: string | null;
  learner_note: string | null;
}

export interface SubmissionVersion {
  id: string;
  submission_id: string;
  version_number: number;
  submitted_at: string;
  note: string | null;
}

export interface SubmissionFile {
  id: string;
  version_id: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_at: string;
}

export interface Rubric {
  id: string;
  code: string | null;
  title: string;
  description: string | null;
  total_points: number;
  is_active: boolean;
}

export interface RubricCriterion {
  id: string;
  rubric_id: string;
  title: string;
  description: string | null;
  max_points: number;
  weight: number;
  sequence: number;
}

export interface Grade {
  id: string;
  summative_attempt_id: string | null;
  final_exam_attempt_id: string | null;
  enrollment_id: string;
  rubric_id: string | null;
  score_percent: number;
  pass_mark_applied: number;
  passed: boolean;
  graded_at: string;
  released_at: string | null;
  is_superseded: boolean;
}

export interface Feedback {
  id: string;
  submission_id: string | null;
  summative_attempt_id: string | null;
  enrollment_id: string;
  author_id: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
}

export interface FinalExam {
  id: string;
  course_id: string;
  title: string;
  instructions: string | null;
  duration_minutes: number;
  pass_mark: number;
  max_attempts: number;
  retake_wait_hours: number;
  questions_per_attempt: number | null;
  requires_manual_marking: boolean;
  publication_status: PublicationStatus;
  published_at: string | null;
}

export interface FinalExamQuestion {
  id: string;
  exam_id: string;
  module_id: string | null;
  question_type: QuestionType;
  prompt: string;
  points: number;
  sequence: number;
  is_active: boolean;
}

export interface FinalExamAttempt {
  id: string;
  enrollment_id: string;
  exam_id: string;
  attempt_number: number;
  status: AttemptStatus;
  question_ids: string[];
  started_at: string;
  expires_at: string;
  submitted_at: string | null;
  score_percent: number | null;
  passed: boolean | null;
  requires_manual_marking: boolean;
  released_at: string | null;
}

export interface Certificate {
  id: string;
  certificate_number: string;
  verification_token: string;
  enrollment_id: string;
  profile_id: string;
  course_id: string;
  learner_name: string;
  course_title: string;
  qualification_id: string | null;
  nqf_level: number | null;
  credits_awarded: number | null;
  status: CertificateStatus;
  issued_at: string;
  completion_date: string | null;
  final_score: number | null;
  storage_path: string | null;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  profile_id: string;
  enrollment_id: string | null;
  course_id: string | null;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  vat_amount: number;
  total: number;
  amount_paid: number;
  is_installment: boolean;
  installment_no: number | null;
  installment_count: number | null;
  issued_at: string | null;
  due_at: string | null;
  description: string | null;
}

export interface Payment {
  id: string;
  invoice_id: string;
  profile_id: string;
  status: PaymentStatus;
  method: PaymentMethod;
  amount: number;
  reference: string | null;
  paid_on: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

export interface Notification {
  id: string;
  profile_id: string;
  event_type: string;
  title: string;
  body: string | null;
  link_path: string | null;
  resource_type: string | null;
  resource_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  course_id: string | null;
  cohort_id: string | null;
  audience_roles: AppRole[];
  is_pinned: boolean;
  publish_at: string;
  expires_at: string | null;
  publication_status: PublicationStatus;
}

export interface AuditLog {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  actor_roles: AppRole[];
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_label: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  status: string;
  created_at: string;
}

/* -------------------------------------------------------------------------- */
/* Return shapes of the backend's business functions.                          */
/* -------------------------------------------------------------------------- */

export interface EligibilityCheck {
  key: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface EligibilityVerdict {
  eligible: boolean;
  reason:
    | 'ELIGIBLE'
    | 'REQUIREMENTS_OUTSTANDING'
    | 'ALREADY_PASSED'
    | 'ALREADY_ISSUED'
    | 'NO_EXAM_PUBLISHED';
  exam_id?: string;
  credits_earned?: number;
  final_score?: number | null;
  checks: EligibilityCheck[];
}

export interface FormativeResult {
  score_percent: number;
  passed: boolean;
  points_earned: number;
  points_possible: number;
}

export interface FinalExamResult {
  status: 'SUBMITTED' | 'GRADED';
  awaiting_marking?: boolean;
  score_percent?: number;
  passed?: boolean;
}

export interface CertificateVerification {
  valid: boolean;
  reason: 'VALID' | 'NOT_FOUND' | 'REVOKED' | 'REPLACED';
  certificate_number?: string;
  learner_name?: string;
  course_title?: string;
  qualification_id?: string | null;
  nqf_level?: number | null;
  credits?: number | null;
  issued_at?: string;
  completion_date?: string | null;
  revoked_at?: string;
}
