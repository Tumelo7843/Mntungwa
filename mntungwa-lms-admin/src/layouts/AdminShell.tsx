import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Badge, Icon, SkipLink, initials } from '@/components/ui';
import type { AppRole } from '@/lib/database.types';

/**
 * Administration shell.
 *
 * Navigation is filtered by role — but that is presentation only. Every screen
 * behind these links is protected by Row Level Security in the database, so a
 * user who guesses a URL sees empty tables rather than data they should not
 * have.
 */

interface NavItem {
  to: string;
  icon: string;
  label: string;
  roles: AppRole[];
  end?: boolean;
}

const NAV_GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Overview',
    items: [
      { to: '/', icon: 'dashboard', label: 'Dashboard', roles: ['ADMIN', 'INSTRUCTOR', 'ASSESSOR', 'FINANCE', 'SUPPORT'], end: true },
    ],
  },
  {
    heading: 'People',
    items: [
      { to: '/learners', icon: 'group', label: 'Learners', roles: ['ADMIN', 'INSTRUCTOR', 'SUPPORT'] },
      { to: '/staff', icon: 'badge', label: 'Staff & roles', roles: ['ADMIN'] },
      { to: '/enrollments', icon: 'how_to_reg', label: 'Enrolments', roles: ['ADMIN', 'SUPPORT'] },
    ],
  },
  {
    heading: 'Academic',
    items: [
      { to: '/courses', icon: 'school', label: 'Courses & modules', roles: ['ADMIN', 'INSTRUCTOR'] },
      { to: '/final-exams', icon: 'fact_check', label: 'Final exams', roles: ['ADMIN', 'INSTRUCTOR'] },
    ],
  },
  {
    heading: 'Assessment',
    items: [
      { to: '/submissions', icon: 'assignment_turned_in', label: 'Grading queue', roles: ['ADMIN', 'ASSESSOR', 'INSTRUCTOR'] },
      { to: '/certificates', icon: 'workspace_premium', label: 'Certificates', roles: ['ADMIN'] },
    ],
  },
  {
    heading: 'Finance',
    items: [
      { to: '/payments', icon: 'payments', label: 'Payments', roles: ['ADMIN', 'FINANCE'] },
      { to: '/invoices', icon: 'receipt_long', label: 'Invoices', roles: ['ADMIN', 'FINANCE'] },
    ],
  },
  {
    heading: 'Institution',
    items: [
      { to: '/reports', icon: 'analytics', label: 'Reports', roles: ['ADMIN', 'FINANCE'] },
      { to: '/announcements', icon: 'campaign', label: 'Announcements', roles: ['ADMIN'] },
      { to: '/messages', icon: 'mail', label: 'Enquiries', roles: ['ADMIN', 'SUPPORT'] },
      { to: '/settings', icon: 'settings', label: 'Settings', roles: ['ADMIN'] },
      { to: '/audit', icon: 'history', label: 'Audit log', roles: ['ADMIN'] },
    ],
  },
];

export function AdminShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { profile, roles, hasRole, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const node = drawerRef.current;
    node?.querySelector<HTMLElement>('a,button')?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setOpen(false);
      if (e.key !== 'Tab' || !node) return;
      const f = node.querySelectorAll<HTMLElement>('a[href],button:not([disabled])');
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const SideNav = () => (
    <>
      <div className="p-5 flex items-center gap-3 border-b border-slate-100">
        <div className="rounded-lg p-2 flex items-center justify-center text-white bg-primary">
          <Icon name="admin_panel_settings" />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-xs leading-tight uppercase tracking-wider text-primary truncate">
            Mntungwa IT Solution
          </p>
          <p className="text-slate-600 text-xs font-medium">Administration</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4" aria-label="Administration">
        {NAV_GROUPS.map((group) => {
          const visible = group.items.filter((it) => hasRole(...it.roles));
          if (!visible.length) return null;
          return (
            <div key={group.heading}>
              <p className="px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                {group.heading}
              </p>
              <div className="space-y-0.5">
                {visible.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    end={it.end}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? 'bg-primary/10 text-primary-700 font-semibold'
                          : 'text-slate-700 hover:bg-slate-100 font-medium'
                      }`
                    }
                  >
                    <Icon name={it.icon} className="text-[19px]" />
                    {it.label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-100">
        <button
          onClick={async () => {
            await signOut();
            navigate('/login');
          }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold text-red-700 hover:bg-red-50"
        >
          <Icon name="logout" className="text-[19px]" />
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-background-light">
      <SkipLink />

      <aside className="w-64 bg-white border-r border-slate-200 hidden lg:flex flex-col fixed inset-y-0">
        <SideNav />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} aria-hidden="true" />
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
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="lg:hidden text-slate-700 p-1 rounded-lg"
              onClick={() => setOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={open}
            >
              <Icon name="menu" />
            </button>
            <div className="min-w-0">
              <h1 className="font-bold text-slate-900 truncate">{title}</h1>
              {subtitle && <p className="text-xs text-slate-600 truncate">{subtitle}</p>}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {actions}
            <div className="hidden sm:flex items-center gap-1.5">
              {roles.slice(0, 2).map((r) => (
                <Badge key={r} tone="blue">
                  {r}
                </Badge>
              ))}
            </div>
            <div className="h-9 w-9 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold">
              {profile ? initials(profile.full_name) : '?'}
            </div>
          </div>
        </header>

        <main id="main" className="flex-1 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

export function AdminAuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background-light flex flex-col items-center justify-center px-4">
      <Link to="/" className="flex items-center gap-2.5 mb-6">
        <span className="bg-primary rounded-lg p-2 text-white flex">
          <Icon name="admin_panel_settings" />
        </span>
        <span className="font-extrabold text-primary tracking-tight">MNTUNGWA ADMINISTRATION</span>
      </Link>
      <main id="main" className="w-full max-w-md">
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-8">
          <h1 className="text-xl font-extrabold text-slate-900">{title}</h1>
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}
