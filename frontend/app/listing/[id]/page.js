'use client';

import { use, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import MapView from '@/components/MapView';
import { BigCode, DeliverySteps, DeliveryStatus, FoodTypeBadge, ListingStatus, TimeLeft } from '@/components/bits';
import ReportIssue from '@/components/ReportIssue';
import { Badge, Button, Card, ErrorBox, KeyValue, Loading, Notice, PageHeader, Textarea } from '@/components/ui';
import { post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/useData';
import { useSocketEvent, useSubscribe, useToast } from '@/lib/realtime';
import { DONOR_TYPE, HOLDING, fmtDateTime, fmtTime } from '@/lib/format';

export default function ListingPage({ params }) {
  const { id } = use(params);
  return (
    <AppShell roles={['donor', 'ngo', 'admin']}>
      <ListingDetail id={id} />
    </AppShell>
  );
}

function ListingDetail({ id }) {
  const { user } = useAuth();
  const router = useRouter();
  const justPosted = useSearchParams().get('posted') === '1';
  const { data, error, loading, reload } = useData(`/listings/${id}`, { poll: 45000 });
  const { data: history } = useData(user.role === 'volunteer' ? null : `/listings/${id}/history`, { enabled: user.role !== 'ngo' });
  useSubscribe('listing', id);
  useSocketEvent('listing:status', reload);
  useSocketEvent('delivery:status', reload);
  useSocketEvent('volunteer:location', reload);

  const [busy, setBusy] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState('');
  const toast = useToast();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const l = data.listing;
  const isDonor = user.role === 'donor';
  const claims = l.claims ?? [];
  const canCancel = isDonor && !['expired', 'cancelled'].includes(l.status) && !claims.some((c) => ['picked_up', 'delivered', 'confirmed'].includes(c.delivery?.status));

  const markers = [
    { lat: l.donor.lat, lng: l.donor.lng, emoji: '🍲', label: l.donor.orgName, color: '#d97706' },
    ...claims.flatMap((c) => [
      c.ngo && { lat: c.ngo.lat, lng: c.ngo.lng, emoji: '🏠', label: c.ngo.orgName, color: '#1a7d4e' },
      c.delivery?.volunteer?.currentLat != null && {
        lat: c.delivery.volunteer.currentLat,
        lng: c.delivery.volunteer.currentLng,
        emoji: '🛵',
        label: 'Volunteer',
        color: '#0284c7',
      },
    ]),
  ].filter(Boolean);

  async function cancel() {
    setBusy(true);
    try {
      await post(`/listings/${id}/cancel`, { reason: reason.trim() || undefined });
      toast({ title: 'Listing cancelled', tone: 'info' });
      setShowCancel(false);
      reload();
    } catch (err) {
      toast({ title: 'Could not cancel', body: err.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={l.title} subtitle={`Posted ${fmtDateTime(l.createdAt)}`} back={isDonor ? '/donor' : user.role === 'ngo' ? '/ngo' : '/admin'} action={<ListingStatus status={l.status} />} />

      {justPosted && (
        <Notice tone="green" className="mb-3" title="Posted. NGOs nearby have been notified.">
          You will get a notification as soon as one claims it. Keep the food covered until the volunteer arrives.
        </Notice>
      )}

      {l.status === 'expired' && (
        <Notice tone="red" className="mb-3" title="This food expired before pickup">
          Please dispose of it safely. Do not serve or re-chill it.
        </Notice>
      )}

      <div className="space-y-3">
        {l.photoUrl && !l.photoUrl.startsWith('https://example.org') && (
          <img src={l.photoUrl} alt="" className="h-40 w-full rounded-2xl object-cover ring-1 ring-slate-200" />
        )}

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <FoodTypeBadge type={l.foodType} />
            <TimeLeft until={l.bestBefore} label="before best-before" />
          </div>
          <KeyValue
            items={[
              ['Meals', `${l.totalServings} total · ${l.remainingServings} unclaimed`],
              ['Items', l.items.map((i) => `${i.name} (${Number(i.quantity)} ${i.unit})`).join(', ')],
              l.packaging && ['Packaging', l.packaging],
              ['Cooked at', fmtTime(l.cookedAt)],
              ['Held', HOLDING[l.holding]],
              ['Best before', fmtTime(l.bestBefore)],
              ['Pickup window', `${fmtTime(l.pickupFrom)} – ${fmtTime(l.pickupUntil)}`],
              l.notes && ['Notes', l.notes],
            ]}
          />
          {data.handling && <Notice tone="blue">{data.handling}</Notice>}
        </Card>

        {!isDonor && (
          <Card>
            <p className="mb-2 font-semibold text-slate-900">Donor</p>
            <KeyValue
              items={[
                ['Name', l.donor.orgName],
                ['Type', DONOR_TYPE[l.donor.type]],
                ['Address', l.donor.address],
              ]}
            />
          </Card>
        )}

        <MapView markers={markers} lines={claims.map((c) => c.ngo && [{ lat: l.donor.lat, lng: l.donor.lng }, { lat: c.ngo.lat, lng: c.ngo.lng }]).filter(Boolean)} height={240} />

        {claims.length === 0 ? (
          <Notice tone="amber" title={l.status === 'cancelled' ? 'Cancelled' : 'Waiting for an NGO to claim'}>
            {l.status === 'cancelled' ? 'This listing was cancelled.' : 'The nearest suitable NGOs were notified first. More are offered it every 10 minutes.'}
          </Notice>
        ) : (
          claims.map((c) => <ClaimCard key={c.id} claim={c} role={user.role} />)
        )}

        {history?.events?.length > 0 && (
          <Card>
            <p className="mb-2 font-semibold text-slate-900">History</p>
            <ul className="space-y-1 text-sm">
              {history.events.map((e) => (
                <li key={e.id} className="flex justify-between gap-3">
                  <span className="text-slate-700">
                    {e.entityType} → <b>{e.toStatus.replace(/_/g, ' ')}</b>
                    {e.note ? ` · ${e.note}` : ''}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">{fmtTime(e.at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <ReportIssue listingId={l.id} />

        {canCancel && !showCancel && (
          <Button variant="ghost" block onClick={() => setShowCancel(true)}>
            Cancel this listing
          </Button>
        )}
        {showCancel && (
          <Card className="space-y-3">
            <p className="font-semibold text-slate-900">Cancel this listing?</p>
            <p className="text-sm text-slate-600">Claiming NGOs and the volunteer will be told. Only possible before pickup.</p>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
            <div className="flex gap-2">
              <Button variant="danger" block loading={busy} onClick={cancel}>
                Yes, cancel it
              </Button>
              <Button variant="secondary" block onClick={() => setShowCancel(false)}>
                Keep it
              </Button>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function ClaimCard({ claim: c, role }) {
  const d = c.delivery;
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-slate-900">{c.ngo?.orgName ?? 'NGO'}</p>
          <p className="text-sm text-slate-500">
            {c.servings} meals · claimed {fmtTime(c.claimedAt)}
          </p>
        </div>
        {d ? <DeliveryStatus status={d.status} /> : <Badge tone="green">Claimed</Badge>}
      </div>

      {d && (
        <>
          <DeliverySteps delivery={d} />
          {d.volunteer && (
            <KeyValue
              items={[
                ['Volunteer', `${d.volunteer.vehicle === 'car' ? 'Car' : 'Bike'} · ${d.volunteer.rating?.toFixed(1)} ★`],
                d.volunteer.lastSeenAt && ['Location seen', fmtTime(d.volunteer.lastSeenAt)],
              ]}
            />
          )}
          {d.pickupCode && ['assigned', 'unassigned'].includes(d.status) && <BigCode code={d.pickupCode} label="Give this code to the volunteer" />}
          {d.dropCode && ['unassigned', 'assigned', 'picked_up'].includes(d.status) && role === 'ngo' && <BigCode code={d.dropCode} label="Give this code at handover" />}
          {role === 'ngo' && d.status === 'delivered' && <ConfirmReceipt deliveryId={d.id} />}
        </>
      )}
    </Card>
  );
}

function ConfirmReceipt({ deliveryId }) {
  const router = useRouter();
  return (
    <Button block onClick={() => router.push(`/ngo/confirm/${deliveryId}`)}>
      Confirm receipt and rate
    </Button>
  );
}
