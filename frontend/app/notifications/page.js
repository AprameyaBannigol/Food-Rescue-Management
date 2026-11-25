'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { Button, Card, Empty, Notice, PageHeader } from '@/components/ui';
import { useRealtime } from '@/lib/realtime';
import { timeAgo } from '@/lib/format';

export default function NotificationsPage() {
  return (
    <AppShell roles={['donor', 'ngo', 'volunteer', 'admin']}>
      <Inbox />
    </AppShell>
  );
}

const ICON = {
  listing_offered: '🍲',
  claimed: '🙌',
  volunteer_assigned: '🛵',
  task_offered: '📦',
  task_removed: '↩️',
  picked_up: '✅',
  please_confirm: '📝',
  delivery_complete: '🎉',
  delivery_failed: '⚠️',
  expired: '⏰',
  listing_cancelled: '🚫',
  escalation: '🚨',
  collect_yourself: '🚗',
  verified: '✔️',
  donor_paused: '⛔',
  issue: '🚩',
};

// Where tapping a notification should go.
function linkFor(n) {
  const d = n.data ?? {};
  if (d.listingId) return `/listing/${d.listingId}`;
  if (d.deliveryId) return `/delivery/${d.deliveryId}`;
  if (d.issueId) return '/admin/issues';
  return null;
}

function Inbox() {
  const { inbox, markAllRead, clearInbox } = useRealtime();
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');

  useEffect(() => {
    const t = setTimeout(markAllRead, 800);
    return () => clearTimeout(t);
  }, [markAllRead]);

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Live alerts from this device"
        action={inbox.length > 0 ? <Button size="sm" variant="ghost" onClick={clearInbox}>Clear</Button> : null}
      />

      {perm === 'default' && (
        <Notice tone="blue" className="mb-3" title="Get alerts when the app is closed">
          <Button
            size="sm"
            className="mt-2"
            onClick={async () => setPerm(await Notification.requestPermission())}
          >
            Allow notifications
          </Button>
        </Notice>
      )}

      {inbox.length === 0 ? (
        <Empty icon="🔔" title="Nothing yet">Offers, pickups and confirmations show up here.</Empty>
      ) : (
        <ul className="space-y-2">
          {inbox.map((n) => {
            const href = linkFor(n);
            const body = (
              <Card className="flex gap-3">
                <span className="text-2xl">{ICON[n.type] ?? '🔔'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-900">{n.title}</span>
                  <span className="block text-sm text-slate-600">{n.body}</span>
                  <span className="mt-0.5 block text-xs text-slate-400">{timeAgo(n.at)}</span>
                </span>
              </Card>
            );
            return <li key={n.id}>{href ? <Link href={href}>{body}</Link> : body}</li>;
          })}
        </ul>
      )}
      <p className="mt-4 text-center text-xs text-slate-400">
        Urgent alerts also go by SMS. Add this app to your home screen to get alerts when it is closed.
      </p>
    </>
  );
}
