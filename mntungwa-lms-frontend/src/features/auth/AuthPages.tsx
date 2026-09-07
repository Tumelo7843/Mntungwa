import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '@/layouts/Layouts';
import {
  Button,
  ErrorState,
  Field,
  Icon,
  LiveRegion,
  Spinner,
  inputClass,
} from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/hooks/useAsync';
import { AppError } from '@/lib/supabase';

/**
 * Authentication screens, backed by Supabase Auth.
 *
 * The demo's login page listed every demo account and its password, with
 * one-click sign-in (audit S-02). Nothing of that kind appears here.
 */

export function LoginPage() {
  const { signIn, session, resendConfirmation } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const action = useAction(signIn);
  const resend = useAction(resendConfirmation);
  const [resent, setResent] = useState(false);

  // A `?course=` param (from "Apply to enrol" while signed out) sends the
  // learner to the application step once authenticated; an explicit `next`
  // always wins.
  const courseParam = params.get('course')?.trim() || null;
  const destination =
    params.get('next') ??
    (courseParam ? `/app/apply?course=${encodeURIComponent(courseParam)}` : '/app');

  if (session) return <Navigate to={destination} replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResent(false);
    const result = await action.run(email, password);
    if (result !== undefined) navigate(destination, { replace: true });
  };

  const onResend = async () => {
    const r = await resend.run(email);
    if (r !== undefined) setResent(true);
  };

  const needsConfirmation = action.error?.kind === 'EMAIL_UNCONFIRMED';

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Access your learner portal."
      footer={
        <>
          Don’t have an account?{' '}
          <Link to="/register" className="font-bold text-primary">
            Enrol now
          </Link>
        </>
      }
    >
      {action.error && (
        <div className="mb-5">
          <ErrorState error={action.error} />
        </div>
      )}

      {needsConfirmation && (
        <div className="mb-5 rounded-lg border border-primary-200 bg-primary-50 p-4 text-sm text-primary-800">
          <p>
            Still need to confirm <strong>{email.trim().toLowerCase()}</strong>? The link is only
            valid for a limited time and can be used once.
          </p>
          <LiveRegion>
            {resent && (
              <p className="mt-2 font-semibold text-emerald-800">
                New confirmation email sent. Check your inbox (and spam).
              </p>
            )}
            {resend.error && <p className="mt-2 font-semibold text-red-800">{resend.error.message}</p>}
          </LiveRegion>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-3"
            loading={resend.running}
            disabled={!email.trim() || resent}
            onClick={onResend}
          >
            Resend confirmation email
          </Button>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email address" required>
          {(p) => (
            <input
              {...p}
              type="email"
              autoComplete="email"
              className={inputClass}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>

        <Field label="Password" required>
          {(p) => (
            <input
              {...p}
              type="password"
              autoComplete="current-password"
              className={inputClass}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>

        <div className="text-right">
          <Link to="/forgot-password" className="text-sm font-semibold text-primary">
            Forgot your password?
          </Link>
        </div>

        <Button type="submit" size="lg" className="w-full" loading={action.running}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const course = params.get('course')?.trim() || null;
  const loginHref = course ? `/login?course=${encodeURIComponent(course)}` : '/login';
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirm: '' });
  const [done, setDone] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const action = useAction(signUp);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidation(null);

    if (form.password.length < 10) {
      setValidation('Choose a password of at least 10 characters.');
      return;
    }
    if (form.password !== form.confirm) {
      setValidation('The two passwords do not match.');
      return;
    }

    const result = await action.run({
      email: form.email,
      password: form.password,
      fullName: form.fullName,
      phone: form.phone,
    });
    if (result) {
      // If email confirmation is disabled the account is live immediately —
      // take the learner straight to the application step.
      if (!result.needsVerification) {
        navigate(course ? `/app/apply?course=${encodeURIComponent(course)}` : '/app', {
          replace: true,
        });
        return;
      }
      setDone(true);
    }
  };

  if (done) {
    return (
      <AuthLayout title="Check your email" subtitle="One more step before you can sign in.">
        <div className="rounded-lg border border-primary-200 bg-primary-50 p-4 text-sm text-primary-800 flex items-start gap-2">
          <Icon name="mark_email_unread" className="text-[18px] mt-0.5" />
          <span>
            We have sent a confirmation link to <strong>{form.email}</strong>. Open it to activate
            your account, then sign in
            {course ? ' to complete your course application' : ''}. The link expires in 24 hours.
          </span>
        </div>
        <Link to={loginHref} className="mt-5 block text-center text-sm font-bold text-primary">
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle={
        course
          ? 'Register, confirm your email, then submit your course application.'
          : 'Register, then apply to enrol on a course.'
      }
      footer={
        <>
          Already registered?{' '}
          <Link to={loginHref} className="font-bold text-primary">
            Sign in
          </Link>
        </>
      }
    >
      {action.error && (
        <div className="mb-5">
          <ErrorState error={action.error} />
        </div>
      )}
      {validation && (
        <div className="mb-5">
          <ErrorState error={new AppError('VALIDATION', validation)} />
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Full name" required>
          {(p) => (
            <input
              {...p}
              className={inputClass}
              autoComplete="name"
              required
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          )}
        </Field>

        <Field label="Email address" required>
          {(p) => (
            <input
              {...p}
              type="email"
              autoComplete="email"
              className={inputClass}
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          )}
        </Field>

        <Field label="Phone number">
          {(p) => (
            <input
              {...p}
              type="tel"
              autoComplete="tel"
              className={inputClass}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          )}
        </Field>

        <Field label="Password" required hint="At least 10 characters.">
          {(p) => (
            <input
              {...p}
              type="password"
              autoComplete="new-password"
              className={inputClass}
              required
              minLength={10}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          )}
        </Field>

        <Field label="Confirm password" required>
          {(p) => (
            <input
              {...p}
              type="password"
              autoComplete="new-password"
              className={inputClass}
              required
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            />
          )}
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={action.running}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const action = useAction(requestPasswordReset);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await action.run(email);
    // Always report the same outcome, whether or not the address exists —
    // otherwise this endpoint enumerates registered users.
    if (r !== undefined) setSent(true);
  };

  if (sent) {
    return (
      <AuthLayout title="Check your email">
        <p className="text-sm text-slate-700">
          If an account exists for <strong>{email}</strong>, a password reset link is on its way.
          The link expires in one hour.
        </p>
        <Link to="/login" className="mt-5 block text-center text-sm font-bold text-primary">
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We’ll email you a link to set a new one.">
      {action.error && (
        <div className="mb-5">
          <ErrorState error={action.error} />
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email address" required>
          {(p) => (
            <input
              {...p}
              type="email"
              autoComplete="email"
              className={inputClass}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={action.running}>
          Send reset link
        </Button>
      </form>
      <Link to="/login" className="mt-4 block text-center text-sm font-semibold text-slate-600">
        Back to sign in
      </Link>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { updatePassword, session } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const action = useAction(updatePassword);
  const navigate = useNavigate();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidation(null);
    if (password.length < 10) {
      setValidation('Choose a password of at least 10 characters.');
      return;
    }
    if (password !== confirm) {
      setValidation('The two passwords do not match.');
      return;
    }
    const r = await action.run(password);
    if (r !== undefined) {
      setDone(true);
      setTimeout(() => navigate('/app', { replace: true }), 1500);
    }
  };

  return (
    <AuthLayout title="Choose a new password">
      {!session && (
        <p className="mb-5 text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-lg p-3">
          Open this page from the link in your reset email. Without it we cannot verify who you are.
        </p>
      )}

      <LiveRegion>
        {done && (
          <p className="mb-5 text-sm text-emerald-900 bg-emerald-50 border border-emerald-300 rounded-lg p-3">
            Password updated. Taking you to your portal…
          </p>
        )}
      </LiveRegion>

      {action.error && (
        <div className="mb-5">
          <ErrorState error={action.error} />
        </div>
      )}
      {validation && (
        <div className="mb-5">
          <ErrorState error={new AppError('VALIDATION', validation)} />
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="New password" required hint="At least 10 characters.">
          {(p) => (
            <input
              {...p}
              type="password"
              autoComplete="new-password"
              className={inputClass}
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Field label="Confirm new password" required>
          {(p) => (
            <input
              {...p}
              type="password"
              autoComplete="new-password"
              className={inputClass}
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={action.running} disabled={!session}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}

/**
 * Landing point for the email-confirmation link.
 *
 * Supabase's `/auth/v1/verify` redirects here. On success the URL fragment
 * carries the session tokens (picked up by supabase-js) and a session appears.
 * On failure it carries `error` / `error_code` / `error_description` instead —
 * most often `otp_expired` ("Email link is invalid or has expired") when the
 * single-use link has expired or was pre-fetched by an email client. That case
 * must be shown, with a way to get a fresh link, not silently redirected away.
 */
export function AuthCallbackPage() {
  const { session, loading, resendConfirmation } = useAuth();
  const navigate = useNavigate();

  // Capture the callback params synchronously on first render, before
  // supabase-js strips the fragment from the URL.
  const [callbackError] = useState(() => {
    if (typeof window === 'undefined') return null;
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const search = new URLSearchParams(window.location.search);
    const code = hash.get('error_code') ?? search.get('error_code');
    const desc = hash.get('error_description') ?? search.get('error_description');
    const err = hash.get('error') ?? search.get('error');
    if (!code && !err && !desc) return null;
    return { err, code, desc: desc ? desc.replace(/\+/g, ' ') : null };
  });

  const [email, setEmail] = useState('');
  const [resent, setResent] = useState(false);
  const resend = useAction(resendConfirmation);

  useEffect(() => {
    if (callbackError) {
      if (import.meta.env.DEV) {
        console.error('Supabase email-confirmation callback error:', callbackError);
      }
      return;
    }
    if (!loading) {
      const t = setTimeout(() => navigate(session ? '/app' : '/login', { replace: true }), 800);
      return () => clearTimeout(t);
    }
  }, [callbackError, loading, session, navigate]);

  if (callbackError) {
    const expired = callbackError.code === 'otp_expired' || /expired|invalid/i.test(callbackError.desc ?? '');
    return (
      <AuthLayout
        title={expired ? 'This link has expired' : 'We could not confirm your account'}
        subtitle={
          expired
            ? 'Confirmation links can only be used once and time out. Request a fresh one below.'
            : callbackError.desc ?? 'Please request a new confirmation email.'
        }
      >
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await resend.run(email);
            if (r !== undefined) setResent(true);
          }}
        >
          <Field label="Email address" required>
            {(p) => (
              <input
                {...p}
                type="email"
                autoComplete="email"
                className={inputClass}
                required
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
              />
            )}
          </Field>

          <LiveRegion>
            {resent && (
              <p className="text-sm font-semibold text-emerald-800">
                Sent. Open the new link within the next little while, on this device if you can.
              </p>
            )}
            {resend.error && (
              <div>
                <ErrorState error={resend.error} />
              </div>
            )}
          </LiveRegion>

          <Button type="submit" size="lg" className="w-full" loading={resend.running} disabled={resent}>
            Send a new confirmation email
          </Button>
        </form>

        <Link to="/login" className="mt-5 block text-center text-sm font-bold text-primary">
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Confirming your account">
      <Spinner label="Just a moment" />
    </AuthLayout>
  );
}
