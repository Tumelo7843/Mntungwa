import { useCallback, useEffect, useRef, useState } from 'react';
import { AppError, toAppError } from '@/lib/supabase';

/**
 * Minimal server-state hook.
 *
 * The brief requires every screen to model LOADING / EMPTY / SUCCESS / ERROR /
 * RETRY. Rather than pull in a data-fetching library, this gives exactly those
 * states in ~60 lines, with the retry and refetch the UI needs.
 */

export interface AsyncState<T> {
  data: T | null;
  error: AppError | null;
  loading: boolean;
  /** True once at least one attempt has settled — avoids flashing empty states. */
  settled: boolean;
  refetch: () => void;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
  options: { enabled?: boolean } = {},
): AsyncState<T> {
  const enabled = options.enabled ?? true;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [settled, setSettled] = useState(false);
  const [tick, setTick] = useState(0);

  // Keep the latest fn without making it a dependency, so callers can pass an
  // inline arrow without causing an infinite refetch loop.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fnRef
      .current()
      .then((result) => {
        if (!active) return;
        setData(result);
      })
      .catch((err) => {
        if (!active) return;
        setError(toAppError(err));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setSettled(true);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  return { data, error, loading, settled, refetch };
}

/**
 * Wrapper for a user-initiated action (submit, upload, grade).
 * Tracks in-flight state and normalises the error, so buttons can disable
 * themselves and surface a readable message.
 */
export function useAction<Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const run = useCallback(
    async (...args: Args): Promise<R | undefined> => {
      setRunning(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (err) {
        setError(toAppError(err));
        return undefined;
      } finally {
        setRunning(false);
      }
    },
    [fn],
  );

  return { run, running, error, clearError: () => setError(null) };
}
