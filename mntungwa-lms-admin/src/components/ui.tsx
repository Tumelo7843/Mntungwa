import type { ReactNode } from 'react';
import { AppError } from '@/lib/supabase';

/**
 * Shared UI primitives.
 *
 * Ported from the demo's src/components/ui.jsx (audit §5 — keep the visual
 * identity), with the accessibility defects from audit §4.3 fixed:
 *   A-05 contrast, A-06 icon-button names, A-07 table semantics,
 *   A-09 live regions, A-10 focus visibility.
 */

export const Icon = ({
  name,
  className = '',
  fill = false,
}: {
  name: string;
  className?: string;
  fill?: boolean;
}) => (
  // Decorative by default: the surrounding control carries the accessible name.
  <span aria-hidden="true" className={`material-symbols-outlined ${fill ? 'icon-fill' : ''} ${className}`}>
    {name}
  </span>
);

type Tone = 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'violet';

const TONES: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-300',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  red: 'bg-red-50 text-red-800 ring-red-300',
  amber: 'bg-amber-50 text-amber-900 ring-amber-300',
  blue: 'bg-primary-50 text-primary-700 ring-primary-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-300',
};

export const Badge = ({
  tone = 'slate',
  children,
  className = '',
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset ${TONES[tone]} ${className}`}
  >
    {children}
  </span>
);

export const ProgressBar = ({
  pct,
  tone = 'bg-primary',
  h = 'h-2.5',
  label,
}: {
  pct: number;
  tone?: string;
  h?: string;
  label?: string;
}) => {
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div
      className={`w-full ${h} rounded-full bg-slate-200 overflow-hidden`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
    >
      <div className={`${h} ${tone} rounded-full transition-all duration-700`} style={{ width: `${value}%` }} />
    </div>
  );
};

export const StatCard = ({
  icon,
  label,
  value,
  sub,
  tone = 'text-primary bg-primary-50',
}: {
  icon: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
}) => (
  <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5 flex items-start gap-4">
    <div className={`rounded-lg p-2.5 shrink-0 ${tone}`}>
      <Icon name={icon} />
    </div>
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">{label}</p>
      <p className="text-2xl font-extrabold text-slate-900 mt-0.5 truncate">{value}</p>
      {sub && <p className="text-xs text-slate-600 mt-1">{sub}</p>}
    </div>
  </div>
);

export const Card = ({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section className={`bg-white rounded-xl border border-slate-200 shadow-card ${className}`}>
    {(title || action) && (
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        {title && <h3 className="font-bold text-slate-900 text-sm">{title}</h3>}
        {action}
      </div>
    )}
    <div className="p-5">{children}</div>
  </section>
);

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  type = 'button',
  ...rest
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants = {
    primary: 'bg-primary hover:bg-primary-700 text-white',
    secondary: 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-300',
    ghost: 'bg-transparent hover:bg-slate-100 text-slate-700',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    success: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2.5 text-sm', lg: 'px-5 py-3 text-sm' };

  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && (
        <span
          className="h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}

let fieldSeq = 0;
const nextId = () => `f${++fieldSeq}`;

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const id = nextId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-slate-800">
        {label}
        {required && (
          <span className="text-red-600 ml-0.5" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {hint && (
        <p id={hintId} className="text-xs text-slate-600">
          {hint}
        </p>
      )}
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error && (
        <p id={errId} className="text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none disabled:bg-slate-100';

/* -------------------------------------------------------------------------- */
/* State components — LOADING / EMPTY / ERROR / RETRY / FORBIDDEN / NOT_FOUND  */
/* -------------------------------------------------------------------------- */

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <div className="flex items-center justify-center gap-3 py-12 text-slate-600" role="status">
    <span
      className="h-5 w-5 rounded-full border-2 border-primary border-r-transparent animate-spin"
      aria-hidden="true"
    />
    <span className="text-sm font-semibold">{label}…</span>
  </div>
);

export const EmptyState = ({
  icon = 'inbox',
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) => (
  <div className="text-center py-12 px-6">
    <div className="mx-auto h-12 w-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
      <Icon name={icon} />
    </div>
    <p className="mt-3 font-bold text-slate-900">{title}</p>
    {body && <p className="mt-1 text-sm text-slate-600 max-w-md mx-auto">{body}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/** Error panel with retry. Never renders a raw database message. */
export function ErrorState({ error, onRetry }: { error: AppError; onRetry?: () => void }) {
  const copy: Record<string, { icon: string; title: string }> = {
    UNAUTHORIZED: { icon: 'lock', title: 'Please sign in again' },
    FORBIDDEN: { icon: 'block', title: 'You do not have access to this' },
    NOT_FOUND: { icon: 'search_off', title: 'Not found' },
    VALIDATION: { icon: 'error', title: 'That did not work' },
    CONFLICT: { icon: 'error', title: 'Already exists' },
    NETWORK: { icon: 'wifi_off', title: 'Connection problem' },
    UNKNOWN: { icon: 'error', title: 'Something went wrong' },
  };
  const c = copy[error.kind] ?? copy.UNKNOWN;

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6" role="alert">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-red-100 text-red-700 p-2 shrink-0">
          <Icon name={c.icon} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-red-900">{c.title}</p>
          <p className="text-sm text-red-800 mt-1">{error.message}</p>
          {onRetry && (
            <Button variant="danger" size="sm" className="mt-3" onClick={onRetry}>
              <Icon name="refresh" className="text-[16px]" />
              Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Announces results to screen readers (WCAG 4.1.3 — audit A-09). */
export const LiveRegion = ({ children }: { children: ReactNode }) => (
  <div role="status" aria-live="polite" aria-atomic="true">
    {children}
  </div>
);

export const SkipLink = () => (
  <a
    href="#main"
    className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-3 focus:left-3 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white"
  >
    Skip to main content
  </a>
);

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

export const fmtCurrency = (n: number | null | undefined, currency = 'ZAR') =>
  n == null
    ? '—'
    : new Intl.NumberFormat('en-ZA', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('en-ZA', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

export const fmtBytes = (b: number) => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

export const initials = (name: string) =>
  name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export const fileIcon = (mime: string) => {
  if (mime.includes('pdf')) return 'picture_as_pdf';
  if (mime.includes('word') || mime.includes('document')) return 'description';
  if (mime.includes('sheet') || mime.includes('excel')) return 'table_chart';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'co_present';
  if (mime.startsWith('image/')) return 'image';
  if (mime.includes('zip')) return 'folder_zip';
  return 'draft';
};

/** Visual status vocabulary shared by learner and admin views. */
export function statusTone(status: string): Tone {
  switch (status) {
    case 'PASSED':
    case 'COMPLETED':
    case 'ACTIVE':
    case 'APPROVED':
    case 'PAID':
    case 'ISSUED':
      return 'green';
    case 'FAILED':
    case 'REJECTED':
    case 'REVOKED':
    case 'OVERDUE':
      return 'red';
    case 'SUBMITTED':
    case 'UNDER_REVIEW':
    case 'RESUBMISSION_REQUIRED':
    case 'PENDING':
    case 'PENDING_PAYMENT':
    case 'IN_PROGRESS':
      return 'amber';
    case 'LOCKED':
      return 'slate';
    default:
      return 'slate';
  }
}

/** "NOT YET COMPETENT" is retained from the demo: correct QCTO vocabulary. */
export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    NOT_STARTED: 'Not started',
    IN_PROGRESS: 'In progress',
    COMPLETED: 'Completed',
    SUBMITTED: 'Submitted',
    UNDER_REVIEW: 'Under review',
    PASSED: 'Passed',
    FAILED: 'Not yet competent',
    RESUBMISSION_REQUIRED: 'Resubmission required',
    LOCKED: 'Locked',
    PENDING_PAYMENT: 'Awaiting payment',
    PENDING_VERIFICATION: 'Verify your email',
  };
  return map[status] ?? status.replace(/_/g, ' ').toLowerCase();
}
