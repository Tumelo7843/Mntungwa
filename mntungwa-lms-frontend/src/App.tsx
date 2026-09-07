import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/lib/auth';
import { EnrollmentProvider } from '@/app/EnrollmentContext';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { ProtectedRoute } from '@/app/ProtectedRoute';

import {
  CatalogPage,
  ContactPage,
  CourseDetailPage,
  HomePage,
  NotFoundPage,
  VerifyCertificatePage,
} from '@/features/public/PublicPages';
import {
  AuthCallbackPage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
} from '@/features/auth/AuthPages';
import {
  DashboardPage,
  LessonPage,
  ModulePage,
  ResourceLibraryPage,
  ResultsPage,
  RoadmapPage,
} from '@/features/learning/LearningPages';
import {
  FinalExamAttemptPage,
  FinalExamPage,
  FormativeAssessmentPage,
  SummativeAssessmentPage,
} from '@/features/assessments/AssessmentPages';
import { CertificatePage, ProfilePage } from '@/features/certificates/CertificateAndProfile';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { ApplyPage } from '@/features/enrolment/ApplyPage';

/**
 * BrowserRouter, not HashRouter.
 *
 * The demo used HashRouter, which hides the SPA-refresh problem behind `#/`
 * rather than solving it, and produces unshareable URLs (audit C-08). The
 * rewrite rule in vercel.json handles refreshes properly.
 */
function Learner({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <EnrollmentProvider>{children}</EnrollmentProvider>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/" element={<HomePage />} />
            <Route path="/courses" element={<CatalogPage />} />
            <Route path="/courses/:code" element={<CourseDetailPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/verify" element={<VerifyCertificatePage />} />
            <Route path="/verify/:certificateNumber" element={<VerifyCertificatePage />} />

            {/* Auth */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />

            {/* Learner portal */}
            <Route path="/app" element={<Learner><DashboardPage /></Learner>} />
            <Route path="/app/apply" element={<Learner><ApplyPage /></Learner>} />
            <Route path="/app/roadmap" element={<Learner><RoadmapPage /></Learner>} />
            <Route path="/app/modules/:moduleId" element={<Learner><ModulePage /></Learner>} />
            <Route path="/app/lessons/:lessonId" element={<Learner><LessonPage /></Learner>} />
            <Route path="/app/resources" element={<Learner><ResourceLibraryPage /></Learner>} />
            <Route path="/app/formative/:assessmentId" element={<Learner><FormativeAssessmentPage /></Learner>} />
            <Route path="/app/summative/:assessmentId" element={<Learner><SummativeAssessmentPage /></Learner>} />
            <Route path="/app/final-exam" element={<Learner><FinalExamPage /></Learner>} />
            <Route path="/app/final-exam/:attemptId" element={<Learner><FinalExamAttemptPage /></Learner>} />
            <Route path="/app/results" element={<Learner><ResultsPage /></Learner>} />
            <Route path="/app/notifications" element={<Learner><NotificationsPage /></Learner>} />
            <Route path="/app/certificate" element={<Learner><CertificatePage /></Learner>} />
            <Route path="/app/profile" element={<Learner><ProfilePage /></Learner>} />

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
