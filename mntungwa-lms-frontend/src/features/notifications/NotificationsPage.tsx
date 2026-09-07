import { useNavigate } from 'react-router-dom';
import { AppShell } from '@/layouts/Layouts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  LiveRegion,
  Spinner,
  fmtDateTime,
} from '@/components/ui';
import { useAction, useAsync } from '@/hooks/useAsync';
import * as api from '@/services/lms';
import type { Notification } from '@/lib/database.types';

/**
 * Learner notification centre.
 *
 * Rows are written server-side by the business functions (payment reviewed,
 * assessment graded, certificate issued, enrolment status changed…). This
 * screen only reads them, toggles read state, and follows the deep link the
 * database attached.
 */

const EVENT_ICON: Record<string, string> = {
  PAYMENT_APPROVED: 'payments',
  PAYMENT_REJECTED: 'payments',
  ASSESSMENT_GRADED: 'grading',
  SUBMISSION_RECEIVED: 'assignment',
  CERTIFICATE_ISSUED: 'workspace_premium',
  ENROLLMENT_ACTIVE: 'how_to_reg',
  ENROLLMENT_SUSPENDED: 'pause_circle',
  ENROLLMENT_WITHDRAWN: 'cancel',
  ENROLLMENT_EXPIRED: 'schedule',
};

function iconFor(event: string): string {
  return EVENT_ICON[event] ?? 'notifications';
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const list = useAsync(() => api.listNotifications(100), []);

  const markOne = useAction(async (n: Notification) => {
    if (!n.is_read) await api.markNotificationRead(n.id);
    list.refetch();
    if (n.link_path) navigate(n.link_path);
  });

  const markAll = useAction(async () => {
    await api.markAllNotificationsRead();
    list.refetch();
  });

  const rows = list.data ?? [];
  const unread = rows.filter((n) => !n.is_read).length;

  return (
    <AppShell title="Notifications">
      <div className="max-w-3xl space-y-4">
        <LiveRegion>
          {markAll.error && <ErrorState error={markAll.error} />}
          {markOne.error && <ErrorState error={markOne.error} />}
        </LiveRegion>

        <Card
          title={unread ? `${unread} unread` : 'All caught up'}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => markAll.run()}
              loading={markAll.running}
              disabled={!unread}
            >
              Mark all as read
            </Button>
          }
        >
          {list.loading && <Spinner label="Loading notifications" />}
          {list.error && <ErrorState error={list.error} onRetry={list.refetch} />}
          {list.settled && !rows.length && (
            <EmptyState
              icon="notifications_off"
              title="No notifications yet"
              body="You will be notified here when a payment is reviewed, an assessment is graded, or your enrolment status changes."
            />
          )}

          {!!rows.length && (
            <ul className="divide-y divide-slate-100 -m-5 mt-0">
              {rows.map((n) => {
                const clickable = Boolean(n.link_path);
                const Row = (
                  <div className="flex items-start gap-3 px-5 py-4">
                    <div
                      className={`rounded-lg p-2 shrink-0 ${
                        n.is_read ? 'bg-slate-100 text-slate-500' : 'bg-primary-50 text-primary-700'
                      }`}
                    >
                      <Icon name={iconFor(n.event_type)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p
                          className={`text-sm ${
                            n.is_read ? 'font-semibold text-slate-700' : 'font-bold text-slate-900'
                          }`}
                        >
                          {n.title}
                        </p>
                        {!n.is_read && <Badge tone="blue">New</Badge>}
                      </div>
                      {n.body && <p className="text-sm text-slate-600 mt-0.5">{n.body}</p>}
                      <p className="text-xs text-slate-500 mt-1">{fmtDateTime(n.created_at)}</p>
                    </div>
                    {clickable && (
                      <Icon name="chevron_right" className="text-slate-400 shrink-0 self-center" />
                    )}
                  </div>
                );

                return (
                  <li key={n.id}>
                    {clickable ? (
                      <button
                        type="button"
                        onClick={() => markOne.run(n)}
                        disabled={markOne.running}
                        className="block w-full text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
                      >
                        {Row}
                      </button>
                    ) : (
                      <div className="flex items-center justify-between">
                        {Row}
                        {!n.is_read && (
                          <button
                            type="button"
                            onClick={() => markOne.run(n)}
                            disabled={markOne.running}
                            className="mr-5 text-xs font-bold text-primary hover:underline shrink-0"
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
