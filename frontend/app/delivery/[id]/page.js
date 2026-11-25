'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import MapView from '@/components/MapView';
import ReportIssue from '@/components/ReportIssue';
import { BigCode, DeliverySteps, DeliveryStatus, TimeLeft } from '@/components/bits';
import { ErrorBox, KeyValue, LinkButton, Loading, Notice, PageHeader, Card } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/useData';
import { useSocketEvent, useSubscribe } from '@/lib/realtime';
import { fmtKm, fmtTime } from '@/lib/format';

// One tracking page for the donor, the NGO and admins. The volunteer has its own task page.
export default function DeliveryPage({ params }) {
  const { id } = use(params);
  return (
    <AppShell roles={['donor', 'ngo', 'admin']}>
      <Tracking id={id} />
    </AppShell>
  );
}

function Tracking({ id }) {
  const { user } = useAuth();
  const { data, error, loading, reload } = useData(`/deliveries/${id}`, { poll: 45000 });
  const [live, setLive] = useState(null);
  useSubscribe('delivery', id);
  useSocketEvent('delivery:status', reload);
  useSocketEvent('volunteer:location', (p) => {
    if (p.deliveryId === id) setLive({ lat: p.lat, lng: p.lng, at: p.at });
  });

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const d = data.delivery;
  const pos = live ?? (d.volunteer?.currentLat != null ? { lat: d.volunteer.currentLat, lng: d.volunteer.currentLng, at: d.volunteer.lastSeenAt } : null);

  return (
    <>
      <PageHeader
        title={d.listing.title}
        subtitle={`${d.servings} meals · ${d.donor.orgName} → ${d.ngo.orgName}`}
        back={user.role === 'donor' ? '/donor' : user.role === 'ngo' ? '/ngo/deliveries' : '/admin'}
        action={<DeliveryStatus status={d.status} />}
      />

      <div className="space-y-3">
        <MapView
          height={280}
          markers={[
            { lat: d.donor.lat, lng: d.donor.lng, emoji: '🍲', label: d.donor.orgName, color: '#d97706' },
            { lat: d.ngo.lat, lng: d.ngo.lng, emoji: '🏠', label: d.ngo.orgName, color: '#1a7d4e' },
            pos && { lat: pos.lat, lng: pos.lng, emoji: '🛵', label: 'Volunteer', color: '#0284c7' },
          ].filter(Boolean)}
          lines={[[{ lat: d.donor.lat, lng: d.donor.lng }, pos, { lat: d.ngo.lat, lng: d.ngo.lng }].filter(Boolean)]}
        />
        {pos ? (
          <p className="text-center text-xs text-slate-500">Volunteer location updated {fmtTime(pos.at)}. It moves while their task page is open.</p>
        ) : (
          d.status === 'assigned' && <p className="text-center text-xs text-slate-500">The volunteer's location appears once they open their task page.</p>
        )}

        {d.pickupCode && ['unassigned', 'assigned'].includes(d.status) && <BigCode code={d.pickupCode} label="Give this code to the volunteer" />}
        {d.dropCode && ['unassigned', 'assigned', 'picked_up'].includes(d.status) && <BigCode code={d.dropCode} label="Give this code at handover" />}

        {user.role === 'ngo' && d.status === 'delivered' && (
          <LinkButton href={`/ngo/confirm/${d.id}`} block size="lg">
            Confirm receipt and rate
          </LinkButton>
        )}

        <Card>
          <p className="mb-2 font-semibold text-slate-900">Progress</p>
          <DeliverySteps delivery={d} />
          <div className="mt-2 border-t border-slate-100 pt-2">
            <TimeLeft until={d.listing.bestBefore} label="before best-before" />
          </div>
        </Card>

        <Card>
          <KeyValue
            items={[
              ['Pickup window', `${fmtTime(d.listing.pickupFrom)} – ${fmtTime(d.listing.pickupUntil)}`],
              d.volunteer && ['Volunteer', `${d.volunteer.vehicle === 'car' ? 'Car' : 'Bike'} · ${d.volunteer.rating?.toFixed(1)} ★`],
              d.distanceKm != null && ['Trip length', fmtKm(d.distanceKm)],
              ['Donor', `${d.donor.orgName}, ${d.donor.address}`],
              ['NGO', `${d.ngo.orgName}, ${d.ngo.address}`],
            ]}
          />
          {d.listing.handling && <Notice tone="blue" className="mt-3">{d.listing.handling}</Notice>}
        </Card>

        {(d.pickupPhotoUrl || d.dropPhotoUrl) && (
          <Card>
            <p className="mb-2 font-semibold text-slate-900">Handoff photos</p>
            <div className="grid grid-cols-2 gap-2">
              {[['Pickup', d.pickupPhotoUrl], ['Drop', d.dropPhotoUrl]].map(([label, url]) =>
                url && !url.startsWith('https://example.org') ? (
                  <figure key={label}>
                    <img src={url} alt={`${label} photo`} className="h-28 w-full rounded-xl object-cover ring-1 ring-slate-200" />
                    <figcaption className="mt-1 text-xs text-slate-500">{label}</figcaption>
                  </figure>
                ) : null,
              )}
            </div>
          </Card>
        )}

        <Link href={`/listing/${d.listing.id}`} className="block text-center text-sm font-semibold text-brand-700">
          See the whole listing
        </Link>

        <ReportIssue deliveryId={d.id} listingId={d.listing.id} />
      </div>
    </>
  );
}
