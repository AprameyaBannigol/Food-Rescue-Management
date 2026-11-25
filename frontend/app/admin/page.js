'use client';

import { useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import MapView from '@/components/MapView';
import { ListingStatus, TimeLeft } from '@/components/bits';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Segmented, Stat } from '@/components/ui';
import { useData } from '@/lib/useData';
import { useSocketEvent } from '@/lib/realtime';
import { DELIVERY_STATUS, FLAG, fmtTime } from '@/lib/format';

export default function AdminLivePage() {
  return (
    <AppShell roles={['admin']} wide>
      <LiveBoard />
    </AppShell>
  );
}

const STATUS_COLOR = {
  posted: '#0284c7',
  offered: '#0284c7',
  partially_claimed: '#d97706',
  fully_claimed: '#1a7d4e',
  expired: '#dc2626',
  cancelled: '#64748b',
};

function LiveBoard() {
  const [only, setOnly] = useState('all');
  const { data, error, loading, reload } = useData('/admin/live', { poll: 30000 });
  const { data: pending } = useData('/admin/verifications', { poll: 120000 });
  const { data: issues } = useData('/issues?status=open', { poll: 60000 });
  useSocketEvent('listing:status', reload);
  useSocketEvent('delivery:status', reload);
  useSocketEvent('admin:alert', reload);
  useSocketEvent('volunteer:location', reload);

  const all = data?.listings ?? [];
  const stuck = all.filter((l) => l.stuck);
  const shown = only === 'stuck' ? stuck : all;

  const markers = shown.flatMap((l) => [
    { lat: l.donor.lat, lng: l.donor.lng, emoji: l.stuck ? '⚠️' : '🍲', color: l.stuck ? '#dc2626' : STATUS_COLOR[l.status], label: `${l.title} · ${l.donor.orgName}` },
    ...l.claims.flatMap((c) => [
      c.ngo && { lat: c.ngo.lat, lng: c.ngo.lng, emoji: '🏠', color: '#1a7d4e', label: c.ngo.orgName },
      c.delivery?.volunteer?.currentLat != null && {
        lat: c.delivery.volunteer.currentLat,
        lng: c.delivery.volunteer.currentLng,
        emoji: '🛵',
        color: '#0284c7',
        label: `Volunteer · ${DELIVERY_STATUS[c.delivery.status]}`,
      },
    ]),
  ]).filter(Boolean);

  const lines = shown.flatMap((l) => l.claims.map((c) => c.ngo && [{ lat: l.donor.lat, lng: l.donor.lng }, { lat: c.ngo.lat, lng: c.ngo.lng }]).filter(Boolean));

  if (loading && !data) return <Loading />;

  return (
    <>
      <PageHeader title="Live board" subtitle="Everything moving in Hubballi right now." />
      <ErrorBox error={error} onRetry={reload} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active listings" value={all.length} />
        <Stat label="Stuck" value={stuck.length} sub="Need a call" />
        <Link href="/admin/verifications">
          <Stat label="To verify" value={pending?.users?.length ?? 0} />
        </Link>
        <Link href="/admin/issues">
          <Stat label="Open issues" value={issues?.issues?.length ?? 0} />
        </Link>
      </div>

      <MapView height={360} markers={markers} lines={lines} className="mb-4" />

      <div className="mb-3 max-w-xs">
        <Segmented
          value={only}
          onChange={setOnly}
          options={[
            { value: 'all', label: `All (${all.length})` },
            { value: 'stuck', label: `Stuck (${stuck.length})` },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <Empty icon="😴" title="Nothing active">Posted food and running deliveries appear here.</Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map((l) => (
            <li key={l.id}>
              <Link href={`/listing/${l.id}`}>
                <Card className={l.stuck ? 'space-y-2 ring-2 ring-red-400' : 'space-y-2'}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{l.title}</p>
                      <p className="truncate text-sm text-slate-500">{l.donor.orgName}</p>
                    </div>
                    <ListingStatus status={l.status} />
                  </div>

                  <div className="flex items-center justify-between">
                    <TimeLeft until={l.bestBefore} label="left" />
                    <span className="text-xs text-slate-500">{l.remainingServings} unclaimed · best before {fmtTime(l.bestBefore)}</span>
                  </div>

                  {l.flags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {l.flags.map((f) => (
                        <Badge key={f} tone="red">
                          {FLAG[f] ?? f}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {l.claims.length > 0 && (
                    <ul className="space-y-1 border-t border-slate-100 pt-2 text-sm">
                      {l.claims.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-slate-700">
                            {c.ngo?.orgName} · {c.servings}
                          </span>
                          <span className="shrink-0 text-xs text-slate-500">{c.delivery ? DELIVERY_STATUS[c.delivery.status] : 'Claimed'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
