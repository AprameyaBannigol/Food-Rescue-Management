'use client';

import { useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { FoodTypeBadge, TimeLeft } from '@/components/bits';
import { Badge, Button, Card, Empty, ErrorBox, LinkButton, Loading, Notice, PageHeader, Toggle } from '@/components/ui';
import { patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/useData';
import { useSocketEvent, useToast } from '@/lib/realtime';
import { VEHICLE, distanceKm, fmtKm, fmtTime } from '@/lib/format';
import { currentPosition } from '@/lib/upload';

export default function VolunteerHome() {
  return (
    <AppShell roles={['volunteer']}>
      <Tasks />
    </AppShell>
  );
}

function Tasks() {
  const { user, profile, refresh } = useAuth();
  const verified = Boolean(profile?.verifiedAt);
  const { data: offers, reload: reloadOffers, loading } = useData(verified ? '/offers/mine' : null, { poll: 30000 });
  const { data: mine, reload: reloadMine } = useData('/deliveries/mine', { poll: 45000 });
  const reload = () => {
    reloadOffers();
    reloadMine();
  };
  useSocketEvent('notification', reload);
  useSocketEvent('delivery:status', reload);

  const active = (mine?.deliveries ?? []).find((d) => ['assigned', 'picked_up'].includes(d.status));
  const open = (offers?.offers ?? []).filter((o) => o.delivery);

  return (
    <>
      <PageHeader title={`Hello${user.name ? `, ${user.name.split(' ')[0]}` : ''}`} subtitle={`${VEHICLE[profile?.vehicle] ?? 'Bike'} · ${profile?.rating?.toFixed(1) ?? '5.0'} ★`} />

      <AvailabilityCard profile={profile} verified={verified} onChange={refresh} hasActive={Boolean(active)} />

      {active && (
        <Card className="mt-4 space-y-3 ring-2 ring-brand-500">
          <div className="flex items-center justify-between">
            <p className="font-bold text-slate-900">Your active task</p>
            <Badge tone={active.status === 'picked_up' ? 'violet' : 'blue'}>{active.status === 'picked_up' ? 'Deliver to NGO' : 'Collect from donor'}</Badge>
          </div>
          <p className="text-sm text-slate-600">
            {active.listing.title} · {active.servings} meals
          </p>
          <p className="text-sm font-medium text-slate-800">
            {active.status === 'picked_up' ? `Drop at ${active.ngo.orgName}` : `Pick up at ${active.donor.orgName}`}
          </p>
          <LinkButton href={`/volunteer/task/${active.id}`} block size="lg">
            Open task
          </LinkButton>
        </Card>
      )}

      <h2 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">Offered to you</h2>

      {!verified ? (
        <Notice title="Waiting for verification">An admin is checking your ID. Tasks start arriving once you are verified.</Notice>
      ) : active ? (
        <Notice tone="blue">Finish your current task before taking another.</Notice>
      ) : loading && !offers ? (
        <Loading />
      ) : open.length === 0 ? (
        <Empty icon="📦" title="No tasks right now">
          {profile?.isAvailable ? 'Keep the app open or allow notifications; the nearest tasks come to you.' : 'Turn on "Available" above to get offers.'}
        </Empty>
      ) : (
        <ul className="space-y-3">
          {open.map((o) => (
            <li key={o.id}>
              <OfferCard offer={o} volunteer={profile} onDone={reload} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AvailabilityCard({ profile, verified, onChange, hasActive }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function update(body) {
    setBusy(true);
    try {
      await patch('/profile/volunteer/availability', body);
      // A fresh GPS reading right away, so matching can find you.
      if (body.isAvailable) {
        const pos = await currentPosition();
        if (pos) await post('/profile/volunteer/location', { lat: pos.lat, lng: pos.lng });
        else toast({ title: 'Location needed', body: 'Allow location so tasks near you can be offered.', tone: 'danger' });
      }
      await onChange();
    } catch (err) {
      toast({ title: 'Could not change that', body: err.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <Toggle
        checked={Boolean(profile?.isAvailable)}
        disabled={!verified || busy || hasActive}
        onChange={(v) => update({ isAvailable: v })}
        label="Available for tasks"
        hint={hasActive ? 'You have an active task' : 'We only offer tasks within 4 km of you'}
      />
      <div className="border-t border-slate-100 pt-4">
        <Toggle
          checked={Boolean(profile?.isOnCall)}
          disabled={!verified || busy}
          onChange={(v) => update({ isOnCall: v })}
          label="On call at night"
          hint="From 10 PM to 7 AM you handle escalations instead of the admins"
        />
      </div>
      {profile?.lastSeenAt && <p className="text-xs text-slate-400">Location last shared {fmtTime(profile.lastSeenAt)}</p>}
    </Card>
  );
}

function OfferCard({ offer: o, volunteer, onDone }) {
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  const d = o.delivery;
  const me = volunteer?.currentLat != null ? { lat: volunteer.currentLat, lng: volunteer.currentLng } : null;
  const toDonor = distanceKm(me, d.donor);
  const legKm = distanceKm(d.donor, d.ngo);

  async function act(kind) {
    setBusy(kind);
    try {
      if (kind === 'accept') {
        const res = await post(`/offers/${o.id}/accept`);
        toast({ title: 'Task accepted', body: 'Addresses and navigation are open now.', tone: 'success' });
        window.location.href = `/volunteer/task/${res.deliveryId}`;
        return;
      }
      await post(`/offers/${o.id}/decline`);
      toast({ title: 'Declined', body: 'It goes to the next volunteer.', tone: 'info' });
      onDone();
    } catch (err) {
      toast({ title: kind === 'accept' ? 'Too late' : 'Could not decline', body: err.message, tone: 'danger' });
      onDone();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-slate-900">{d.title}</p>
          <p className="text-sm text-slate-500">{d.servings} meals</p>
        </div>
        <FoodTypeBadge type={d.foodType} />
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-slate-50 p-2.5">
          <dt className="text-xs text-slate-500">Collect from</dt>
          <dd className="font-semibold text-slate-900">{d.donor.orgName}</dd>
          {toDonor != null && <dd className="text-xs text-slate-500">{fmtKm(toDonor)} from you</dd>}
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5">
          <dt className="text-xs text-slate-500">Deliver to</dt>
          <dd className="font-semibold text-slate-900">{d.ngo.orgName}</dd>
          {legKm != null && <dd className="text-xs text-slate-500">{fmtKm(legKm)} leg</dd>}
        </div>
      </dl>

      <div className="flex items-center justify-between border-t border-slate-100 pt-2">
        <TimeLeft until={d.pickupUntil} label="to reach the donor" />
        <span className="text-xs text-slate-500">Expires {fmtTime(o.expiresAt)}</span>
      </div>

      <p className="text-xs text-slate-500">Exact addresses open when you accept. First to accept gets it.</p>

      <div className="flex gap-2">
        <Button block size="lg" loading={busy === 'accept'} onClick={() => act('accept')}>
          Accept
        </Button>
        <Button variant="secondary" loading={busy === 'decline'} onClick={() => act('decline')}>
          Decline
        </Button>
      </div>
    </Card>
  );
}
