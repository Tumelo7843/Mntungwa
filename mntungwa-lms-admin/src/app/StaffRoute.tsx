import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui';
import type { AppRole } from '@/lib/database.types';

/**
 * Staff route guard.
 *
 * As in the learner app, this is a convenience rather than a security control:
 * every table is protected by Row Level Security, so a learner who reaches an
 * admin URL sees empty screens, and privileged database functions refuse them
 * outright.
 */
export function StaffRoute({ children, roles }: { children: ReactNode; roles?: AppRole[] }) {
  const { session, roles: mine, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner label="Restoring your session" />
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  const isStaff = mine.some((r) => r !== 'LEARNER');
  if (!isStaff) return <Navigate to="/login" replace />;

  if (roles && !roles.some((r) => mine.includes(r))) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center">
            <span aria-hidden="true" className="material-symbols-outlined">block</span>
          </div>
          <h1 className="mt-4 font-extrabold text-slate-900">You do not have access to this area</h1>
          <p className="mt-2 text-sm text-slate-600">
            This section requires one of: {roles.join(', ')}. Ask an administrator if you need it.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
