'use client';

import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { DeliveryStatus } from '@/components/bits';
import { Card, Empty, ErrorBox, Loading, PageHeader, Stat } from '@/components/ui';
import { useData } from '@/lib/useData';
import { BADGE, fmtDateTime } from '@/lib/format';

export default function VolunteerHistoryPage() {
  return (
    <AppShell roles={['volunteer']}>
      <History />
    </AppShell>
  );
}

function History() {
  const { data: stats, error, loading, reload } = useData('/stats/me');
  const { data: mine } = useData('/deliveries/mine');
  const done = (mine?.deliveries ?? []).filter((d) => ['delivered', 'confirmed', 'failed'].includes(d.status));

  if (loading && !stats) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const badges = stats.badges ?? [];

  return (
    <>
      <PageHeader title="Your deliveries" subtitle="Every trip you have made for Food Rescue." />

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Deliveries" value={stats.deliveries ?? 0} />
        <Stat label="Meals moved" value={(stats.mealsMoved ?? 0).toLocaleString('en-IN')} />
        <Stat label="Distance" value={`${stats.kmTravelled ?? 0} km`} />
        <Stat label="Rating" value={`${(stats.rating ?? 5).toFixed(1)} ★`} />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">Badges</h2>
      {badges.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">Your first delivery earns your first badge.</p>
        </Card>
      ) : (
        <div className="flex flex-wrap gap-2">
          {badges.map((b) => (
            <span key={b} className="inline-flex items-center gap-2 rounded-full bg-saffron-50 px-3 py-1.5 text-sm font-semibold text-saffron-700 ring-1 ring-saffron-100">
              <span className="text-lg">{BADGE[b]?.icon ?? '🏆'}</span>
              {BADGE[b]?.label ?? b}
            </span>
          ))}
        </div>
      )}

      <h2 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">Trips</h2>
      {done.length === 0 ? (
        <Empty icon="🛵" title="No trips yet">Accepted tasks appear here once they are complete.</Empty>
      ) : (
        <ul className="space-y-2">
          {done.map((d) => (
            <li key={d.id}>
              <Link href={`/volunteer/task/${d.id}`}>
                <Card className="flex items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-800">{d.listing.title}</span>
                    <span className="block text-xs text-slate-500">
                      {d.donor.orgName} → {d.ngo.orgName} · {fmtDateTime(d.deliveredAt ?? d.createdAt)}
                    </span>
                  </span>
                  <DeliveryStatus status={d.status} />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
