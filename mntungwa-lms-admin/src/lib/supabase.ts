import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client.
 *
 * Uses the ANON key only. Row Level Security in the backend is what constrains
 * this key — see mntungwa-lms-backend/docs/RLS.md. The service-role key
 * bypasses every policy and must never appear in a browser bundle.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Supabase is not configured. Copy .env.example to .env and set ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  );
}

// Guard against the most damaging possible misconfiguration. A service-role
// JWT carries "role":"service_role"; if one is pasted into the anon variable
// it would hand every visitor full database access.
if (anonKey.split('.').length === 3) {
  try {
    const payload = JSON.parse(atob(anonKey.split('.')[1]));
    if (payload?.role === 'service_role') {
      throw new Error(
        'VITE_SUPABASE_ANON_KEY contains a SERVICE ROLE key. This key bypasses ' +
          'all Row Level Security and must never be used in a browser. Replace it ' +
          'with the anon/public key.',
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('SERVICE ROLE')) throw err;
    // Not decodable as JSON — nothing to assert, carry on.
  }
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Turn a Postgres/PostgREST error into something a learner should read.
 *
 * The brief requires that raw database errors are never shown to ordinary
 * users. Postgres error codes map onto the states the UI already models.
 */
export type AppErrorKind =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'NETWORK'
  | 'UNKNOWN';

export class AppError extends Error {
  kind: AppErrorKind;
  detail?: string;

  constructor(kind: AppErrorKind, message: string, detail?: string) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
    this.detail = detail;
  }
}

interface RawError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  status?: number;
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const e = (error ?? {}) as RawError;
  const raw = e.message ?? String(error);

  // Messages raised deliberately by our own database functions are written for
  // humans, so they are surfaced as-is.
  const isOurs =
    /not eligible|attempt limit|module is locked|already been submitted|time limit|no active enrollment|at least .* file|only an? (administrator|assessor|finance)|requirements not satisfied|reason is required|not your/i.test(
      raw,
    );

  if (e.code === '42501' || e.status === 403) {
    return new AppError('FORBIDDEN', isOurs ? raw : 'You do not have permission to do that.');
  }
  if (e.code === 'PGRST301' || e.status === 401) {
    return new AppError('UNAUTHORIZED', 'Your session has expired. Please sign in again.');
  }
  if (e.code === 'P0002' || e.code === 'PGRST116' || e.status === 404) {
    return new AppError('NOT_FOUND', isOurs ? raw : 'We could not find what you were looking for.');
  }
  if (e.code === '23505') {
    return new AppError('CONFLICT', 'That record already exists.');
  }
  if (e.code === '23514' || e.code === '23502') {
    return new AppError('VALIDATION', isOurs ? raw : 'Some of the information provided is not valid.');
  }
  if (e.code === '42P01' || e.code === 'PGRST205') {
    return new AppError(
      'UNKNOWN',
      'The database is not set up yet. Run the backend migrations first.',
      raw,
    );
  }
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError')) {
    return new AppError('NETWORK', 'Could not reach the server. Check your connection.');
  }

  if (isOurs) return new AppError('VALIDATION', raw);

  return new AppError('UNKNOWN', 'Something went wrong. Please try again.', raw);
}

/** Unwrap a Supabase response, throwing a normalised AppError on failure. */
export function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw toAppError(res.error);
  if (res.data === null) throw new AppError('NOT_FOUND', 'No data was returned.');
  return res.data;
}

/** Same, but null is a legitimate result (maybeSingle). */
export function unwrapMaybe<T>(res: { data: T | null; error: unknown }): T | null {
  if (res.error) throw toAppError(res.error);
  return res.data;
}
