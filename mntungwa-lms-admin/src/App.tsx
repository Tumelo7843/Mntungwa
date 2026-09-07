import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/lib/auth';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { StaffRoute } from '@/app/StaffRoute';

import {
  AdminLoginPage,
  AuditPage,
  DashboardPage,
  EnrollmentsPage,
  LearnersPage,
  MessagesPage,
  ReportsPage,
  SettingsPage,
  StaffPage,
} from '@/features/AdminCore';
import {
  CourseDetailPage,
  CoursesPage,
  ModuleBuilderPage,
  SubmissionsPage,
} from '@/features/AdminAcademic';
import {
  AnnouncementsPage,
  CertificatesPage,
  FinalExamsPage,
  InvoicesPage,
  PaymentsPage,
} from '@/features/AdminOperations';

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<AdminLoginPage />} />

            <Route path="/" element={<StaffRoute><DashboardPage /></StaffRoute>} />

            <Route path="/learners" element={<StaffRoute roles={['ADMIN', 'INSTRUCTOR', 'SUPPORT']}><LearnersPage /></StaffRoute>} />
            <Route path="/staff" element={<StaffRoute roles={['ADMIN']}><StaffPage /></StaffRoute>} />
            <Route path="/enrollments" element={<StaffRoute roles={['ADMIN', 'SUPPORT']}><EnrollmentsPage /></StaffRoute>} />

            <Route path="/courses" element={<StaffRoute roles={['ADMIN', 'INSTRUCTOR']}><CoursesPage /></StaffRoute>} />
            <Route path="/courses/:courseId" element={<StaffRoute roles={['ADMIN', 'INSTRUCTOR']}><CourseDetailPage /></StaffRoute>} />
            <Route path="/modules/:moduleId" element={<StaffRoute roles={['ADMIN', 'INSTRUCTOR']}><ModuleBuilderPage /></StaffRoute>} />
            <Route path="/final-exams" element={<StaffRoute roles={['ADMIN', 'INSTRUCTOR']}><FinalExamsPage /></StaffRoute>} />

            <Route path="/submissions" element={<StaffRoute roles={['ADMIN', 'ASSESSOR', 'INSTRUCTOR']}><SubmissionsPage /></StaffRoute>} />
            <Route path="/certificates" element={<StaffRoute roles={['ADMIN']}><CertificatesPage /></StaffRoute>} />

            <Route path="/payments" element={<StaffRoute roles={['ADMIN', 'FINANCE']}><PaymentsPage /></StaffRoute>} />
            <Route path="/invoices" element={<StaffRoute roles={['ADMIN', 'FINANCE']}><InvoicesPage /></StaffRoute>} />

            <Route path="/reports" element={<StaffRoute roles={['ADMIN', 'FINANCE']}><ReportsPage /></StaffRoute>} />
            <Route path="/announcements" element={<StaffRoute roles={['ADMIN']}><AnnouncementsPage /></StaffRoute>} />
            <Route path="/messages" element={<StaffRoute roles={['ADMIN', 'SUPPORT']}><MessagesPage /></StaffRoute>} />
            <Route path="/settings" element={<StaffRoute roles={['ADMIN']}><SettingsPage /></StaffRoute>} />
            <Route path="/audit" element={<StaffRoute roles={['ADMIN']}><AuditPage /></StaffRoute>} />

            <Route path="*" element={<StaffRoute><DashboardPage /></StaffRoute>} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
