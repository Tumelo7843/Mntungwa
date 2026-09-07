import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAsync } from '@/hooks/useAsync';
import * as api from '@/services/lms';
import type { Course, Enrollment } from '@/lib/database.types';
import { AppError } from '@/lib/supabase';

/**
 * The learner's current enrollment, loaded once and shared.
 *
 * Almost every learner screen needs it, and it is the anchor RLS uses to
 * decide what the learner may see. Fetching it per page would mean a round
 * trip on every navigation.
 */
interface EnrollmentState {
  enrollment: (Enrollment & { course: Course }) | null;
  loading: boolean;
  error: AppError | null;
  refetch: () => void;
}

const Ctx = createContext<EnrollmentState | null>(null);

export function EnrollmentProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, refetch } = useAsync(() => api.getMyPrimaryEnrollment(), []);

  const value = useMemo<EnrollmentState>(
    () => ({ enrollment: data ?? null, loading, error, refetch }),
    [data, loading, error, refetch],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEnrollment(): EnrollmentState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useEnrollment must be used inside <EnrollmentProvider>');
  return ctx;
}
