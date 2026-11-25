'use client';

import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { BigCode, DeliveryStatus, TimeLeft } from '@/components/bits';
import { Card, Empty, ErrorBox, LinkButton, Loading, PageHeader } from '@/components/ui';
import { useData } from '@/lib/useData';
import { useSocketEvent } from '@/lib/realtime';
import { fmtDuration, fmtTime } from '@/lib/format';

export default function NgoDeliveriesPage() {
  return (
    <AppShell roles={['ngo']}>
      <Deliveries />
    </AppShell>
  );
}

function Deliveries() {
  const { data, error, loading, reload } = useData('/deliveries/mine', { poll: 45000 });
  useSocketEvent('delivery:status', reload);
  useSocketEvent('notification', reload);

  const all = data?.deliveries ?? [];
  const active = all.filter((d) => ['unassigned', 'assigned', 'picked_up', 'delivered'].includes(d.status));
  const done = all.filter((d) => !active.includes(d));

  if (loading && !data) return <Loading />;

  return (
    <>
      <PageHeader title="Incoming food" subtitle="Give the drop code to the volunteer at handover." />
      <ErrorBox error={error} onRetry={reload} />

      {active.length === 0 ? (
        <Empty icon="🚚" title="Nothing on the way">Claim food from the feed and it appears here.</Empty>
      ) : (
        <ul className="space-y-3">
          {active.map((d) => (
            <li key={d.id}>
              <Card className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/delivery/${d.id}`} className="block truncate font-bold text-slate-900">
                      {d.listing.title}
                    </Link>
                    <p className="truncate text-sm text-slate-500">
                      {d.donor.orgName} · {d.servings} meals
                    </p>
                  </div>
                  <DeliveryStatus status={d.status} />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <TimeLeft until={d.listing.bestBefore} label="before best-before" />
                  {d.volunteer?.lastSeenAt && <span className="text-xs text-slate-500">Volunteer seen {fmtTime(d.volunteer.lastSeenAt)}</span>}
                </div>

                {d.status === 'unassigned' && <p className="text-sm text-saffron-700">Looking for a volunteer nearby. If nobody accepts in 20 minutes, we will ask whether you can collect it.</p>}
                {d.status === 'assigned' && <p className="text-sm text-slate-600">Volunteer is on the way to the hotel. Pickup window ends {fmtTime(d.listing.pickupUntil)}.</p>}
                {d.status === 'picked_up' && (
                  <p className="text-sm font-semibold text-violet-800">
                    On the way to you{d.distanceKm ? `, about ${fmtDuration((d.distanceKm / 20) * 60 * 1.3)} away` : ''}.
                  </p>
                )}

                {d.dropCode && ['unassigned', 'assigned', 'picked_up'].includes(d.status) && <BigCode code={d.dropCode} label="Drop code for the volunteer" />}

                {d.status === 'delivered' && (
                  <>
                    <p className="text-sm text-brand-800">Food handed over. Please confirm and rate it, or it is auto-confirmed in 2 hours.</p>
                    <LinkButton href={`/ngo/confirm/${d.id}`} block>
                      Confirm receipt
                    </LinkButton>
                  </>
                )}

                <Link href={`/delivery/${d.id}`} className="block text-center text-sm font-semibold text-brand-700">
                  Track on map
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">Earlier</h2>
          <ul className="space-y-2">
            {done.slice(0, 20).map((d) => (
              <li key={d.id}>
                <Link href={`/delivery/${d.id}`}>
                  <Card className="flex items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-slate-800">{d.listing.title}</span>
                      <span className="block text-xs text-slate-500">
                        {d.servings} meals · {fmtTime(d.deliveredAt ?? d.createdAt)}
                      </span>
                    </span>
                    <DeliveryStatus status={d.status} />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
