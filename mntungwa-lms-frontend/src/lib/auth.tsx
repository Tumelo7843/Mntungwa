import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, toAppError } from '@/lib/supabase';
import type { AppRole, Profile } from '@/lib/database.types';

/**
 * Authentication state.
 *
 * Replaces the demo's AppContext, which held every user (with plaintext
 * passwords) in localStorage and treated `sessionUserId` as authentication.
 * This provider holds the session and the caller's own profile — nothing else.
 * All other data is fetched per-feature through the service layer.
 */

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<{ needsVerification: boolean }>;
  signOut: () => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  hasRole: (...roles: AppRole[]) => boolean;
}

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    // RLS restricts both queries to the caller's own rows.
    const [profileRes, rolesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('user_roles').select('role').eq('profile_id', userId),
    ]);

    setProfile((profileRes.data as Profile) ?? null);
    setRoles(((rolesRes.data as { role: AppRole }[]) ?? []).map((r) => r.role));
  }, []);

  useEffect(() => {
    let active = true;

    // Session restoration on page load.
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active) return;
        setSession(data.session);
        if (data.session?.user) await loadProfile(data.session.user.id);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!active) return;
      setSession(next);
      if (next?.user) {
        await loadProfile(next.user.id);
      } else {
        setProfile(null);
        setRoles([]);
      }
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      if (import.meta.env.DEV) {
        // Diagnostic only — never the password, token, or key.
        console.error('Supabase login error:', {
          message: error.message,
          status: error.status,
          code: (error as { code?: string }).code,
        });
      }
      // toAppError classifies GoTrue codes: invalid_credentials (kept
      // deliberately non-enumerating), email_not_confirmed, rate limits.
      throw toAppError(error);
    }
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    const { data, error } = await supabase.auth.signUp({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      options: {
        // Consumed by the backend's handle_new_user() trigger, which creates
        // the profile. Metadata never grants a role — staff roles are assigned
        // by an administrator.
        data: { full_name: input.fullName.trim(), phone: input.phone?.trim() ?? null },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) throw toAppError(error);

    // With email confirmation enabled there is no session until the address is
    // confirmed. That is the expected path.
    return { needsVerification: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setRoles([]);
  }, []);

  // Re-send the sign-up confirmation email. Needed because a confirmation link
  // is single-use and time-limited: if it expires, or an email client / scanner
  // pre-fetches it, the first click fails and the learner is otherwise stuck
  // with an unconfirmed account and no way forward.
  const resendConfirmation = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      if (import.meta.env.DEV) {
        console.error('Supabase resend-confirmation error:', {
          message: error.message,
          status: error.status,
          code: (error as { code?: string }).code,
        });
      }
      throw toAppError(error);
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) throw toAppError(error);
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw toAppError(error);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const hasRole = useCallback(
    (...check: AppRole[]) => check.some((r) => roles.includes(r)),
    [roles],
  );

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      roles,
      loading,
      signIn,
      signUp,
      signOut,
      resendConfirmation,
      requestPasswordReset,
      updatePassword,
      refreshProfile,
      hasRole,
    }),
    [
      session,
      profile,
      roles,
      loading,
      signIn,
      signUp,
      signOut,
      resendConfirmation,
      requestPasswordReset,
      updatePassword,
      refreshProfile,
      hasRole,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
