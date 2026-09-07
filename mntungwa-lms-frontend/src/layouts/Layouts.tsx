import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/hooks/useAsync';
import * as api from '@/services/lms';
import { Badge, Icon, SkipLink, initials } from '@/components/ui';

/**
 * Learner portal shell.
 *
 * Ported from the demo's GlobalResponsiveShell, with the mobile drawer fixed:
 * the demo's version had no focus trap, no aria-modal and no Escape handler
 * (audit A-02).
 */

const NAV = [
  { to: '/app', icon: 'dashboard', label: 'Dashboard', end: true },
  { to: '/app/apply', icon: 'add_circle', label: 'Apply for a course' },
  { to: '/app/roadmap', icon: 'route', label: 'Course roadmap' },
  { to: '/app/resources', icon: 'folder_open', label: 'Documents' },
  { to: '/app/results', icon: 'grading', label: 'Results' },
  { to: '/app/certificate', icon: 'workspace_premium', label: 'Certificate' },
  { to: '/app/notifications', icon: 'notifications', label: 'Notifications' },
  { to: '/app/profile', icon: 'account_balance_wallet', label: 'Profile & payments' },
];

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Unread badge. Re-checked on every route change so it clears after the
  // learner opens the notification centre, without a page refresh.
  const unread = useAsync(() => api.countUnreadNotifications(), [location.pathname]);
  const unreadCount = unread.data ?? 0;
  const drawerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  // Focus management for the drawer (WCAG 2.1.2, 2.4.3).
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = drawerRef.current;
    node?.querySelector<HTMLElement>('a,button')?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !node) return;

      const focusable = node.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      (previouslyFocused ?? openerRef.current)?.focus();
    };
  }, [open]);

  const SideNav = () => (
    <>
      <div className="p-6 flex items-center gap-3">
        <div className="rounded-lg p-2 flex items-center justify-center text-white bg-primary">
          <Icon name="school" />
        </div>
        <div>
          <p className="font-bold text-sm leading-tight uppercase tracking-wider text-primary">
            Mntungwa IT Solution
          </p>
          <p className="text-slate-600 text-xs font-medium">Learner portal</p>
        </div>
      </div>
      <nav className="flex-1 px-4 py-2 space-y-1" aria-label="Learner">
        {NAV.map((it) => {
          const showBadge = it.to === '/app/notifications' && unreadCount > 0;
          return (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary-700 font-semibold'
                    : 'text-slate-700 hover:bg-slate-100 font-medium'
                }`
              }
            >
              <Icon name={it.icon} className="text-[20px]" />
              <span className="flex-1">{it.label}</span>
              {showBadge && (
                <span
                  className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-bold text-white"
                  aria-label={`${unreadCount} unread`}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
      <div className="p-4 border-t border-slate-100">
        <button
          onClick={async () => {
            await signOut();
            navigate('/');
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold text-red-700 hover:bg-red-50"
        >
          <Icon name="logout" className="text-[20px]" />
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-background-light">
      <SkipLink />

      <aside className="w-64 bg-white border-r border-slate-200 hidden lg:flex flex-col fixed inset-y-0 no-print">
        <SideNav />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden no-print">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="absolute inset-y-0 left-0 w-64 bg-white flex flex-col shadow-xl"
          >
            <SideNav />
          </div>
        </div>
      )}

      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 sm:px-8 h-16 flex items-center justify-between no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              ref={openerRef}
              className="lg:hidden text-slate-700 rounded-lg p-1"
              onClick={() => setOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={open}
            >
              <Icon name="menu" />
            </button>
            <h1 className="font-bold text-slate-900 truncate">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            {profile && (
              <Badge tone={profile.account_status === 'ACTIVE' ? 'green' : 'amber'}>
                {profile.account_status === 'ACTIVE' ? 'Active' : 'Pending'}
              </Badge>
            )}
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold shrink-0">
                {profile ? initials(profile.full_name) : '?'}
              </div>
              <div className="hidden sm:block leading-tight">
                <p className="text-sm font-semibold text-slate-900">{profile?.full_name}</p>
                <p className="text-xs text-slate-600">{profile?.email}</p>
              </div>
            </div>
          </div>
        </header>

        <main id="main" className="flex-1 p-4 sm:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Public site                                                                 */
/* -------------------------------------------------------------------------- */

export function PublicLayout({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <SkipLink />
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="bg-primary rounded-lg p-1.5 text-white flex">
              <Icon name="school" className="text-[20px]" />
            </span>
            <span className="font-extrabold text-primary tracking-tight text-sm sm:text-base">
              MNTUNGWA IT SOLUTION
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-slate-700" aria-label="Main">
            <Link to="/" className="hover:text-primary">Home</Link>
            <Link to="/courses" className="hover:text-primary">Courses</Link>
            <Link to="/verify" className="hover:text-primary">Verify a certificate</Link>
            <Link to="/contact" className="hover:text-primary">Contact</Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link to={session ? '/app' : '/login'} className="text-sm font-bold text-primary">
              {session ? 'My portal' : 'Sign in'}
            </Link>
            <Link
              to="/register"
              className="hidden sm:inline-flex bg-primary hover:bg-primary-700 text-white text-sm font-bold px-4 py-2 rounded-lg"
            >
              Enrol now
            </Link>
            <button
              className="md:hidden text-slate-700 p-1 rounded-lg"
              onClick={() => setOpen((o) => !o)}
              aria-label="Toggle navigation menu"
              aria-expanded={open}
            >
              <Icon name={open ? 'close' : 'menu'} />
            </button>
          </div>
        </div>

        {open && (
          <nav className="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-1" aria-label="Mobile">
            {[
              { to: '/', label: 'Home' },
              { to: '/courses', label: 'Courses' },
              { to: '/verify', label: 'Verify a certificate' },
              { to: '/contact', label: 'Contact' },
              { to: '/register', label: 'Enrol now' },
            ].map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className="block px-3 py-2.5 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-slate-200 bg-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8 text-sm text-slate-600 flex flex-col sm:flex-row justify-between gap-3">
          <p>© {new Date().getFullYear()} Mntungwa IT Solution. All rights reserved.</p>
          <p>QCTO Accredited Skills Development Provider</p>
        </div>
      </footer>
    </div>
  );
}

/** Centred card used by every auth screen. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background-light flex flex-col items-center justify-center px-4 py-12">
      <Link to="/" className="flex items-center gap-2.5 mb-6">
        <span className="bg-primary rounded-lg p-2 text-white flex">
          <Icon name="school" />
        </span>
        <span className="font-extrabold text-primary tracking-tight">MNTUNGWA IT SOLUTION</span>
      </Link>

      <main id="main" className="w-full max-w-md">
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-6 sm:p-8">
          <h1 className="text-xl font-extrabold text-slate-900">{title}</h1>
          {subtitle && <p className="text-sm text-slate-600 mt-1.5">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-4 text-center text-sm text-slate-600">{footer}</div>}
      </main>
    </div>
  );
}
