'use client';

import { useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import MapView from '@/components/MapView';
import { FoodTypeBadge, TimeLeft } from '@/components/bits';
import { Badge, Button, Card, Empty, ErrorBox, Loading, Notice, PageHeader, Segmented, Stat } from '@/components/ui';
import { post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/useData';
import { useSocketEvent, useToast } from '@/lib/realtime';
import { fmtDuration, fmtKm, fmtTime } from '@/lib/format';

export default function NgoHome() {
  return (
    <AppShell roles={['ngo']}>
      <Feed />
    </AppShell>
  );
}

function Feed() {
  const { profile } = useAuth();
  const [view, setView] = useState('list');
  const { data, error, loading, reload } = useData('/listings/feed', { poll: 45000 });
  const { data: offers } = useData('/offers/mine', { poll: 60000 });
  const { data: stats } = useData('/stats/me');
  useSocketEvent('notification', reload);
  useSocketEvent('listing:status', reload);

  const listings = data?.listings ?? [];
  const offered = new Set((offers?.offers ?? []).map((o) => o.listingId).filter(Boolean));

  return (
    <>
      <PageHeader
        title="Food nearby"
        subtitle={profile?.vegOnly ? 'Veg only, within 8 km, open now' : 'Within 8 km, matched to your capacity and hours'}
      />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Stat label="Meals received" value={(stats?.mealsReceived ?? 0).toLocaleString('en-IN')} />
        <Stat label="Reliability" value={`${Math.round((stats?.reliabilityScore ?? 1) * 100)}%`} sub="Claims you actually received" />
      </div>

      <div className="mb-3">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: `List (${listings.length})` },
            { value: 'map', label: 'Map' },
          ]}
        />
      </div>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : listings.length === 0 ? (
        <Empty title="No food on offer right now">
          You will get a notification the moment a hotel or mess nearby posts something you can take.
        </Empty>
      ) : view === 'map' ? (
        <MapView
          height={420}
          markers={[
            profile?.lat != null && { lat: profile.lat, lng: profile.lng, emoji: '🏠', label: 'You', color: '#1a7d4e' },
            ...listings.map((l) => ({ lat: l.donor.lat, lng: l.donor.lng, emoji: '🍲', color: '#d97706', label: `${l.title} · ${l.remainingServings} meals` })),
          ].filter(Boolean)}
        />
      ) : (
        <ul className="space-y-3">
          {listings.map((l) => (
            <li key={l.id}>
              <FeedCard listing={l} invited={offered.has(l.id)} onClaimed={reload} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function FeedCard({ listing: l, invited, onClaimed }) {
  const [servings, setServings] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const m = l.match;
  const want = servings ?? Math.min(l.remainingServings, m.capacityLeft);

  async function claim() {
    setBusy(true);
    try {
      await post(`/listings/${l.id}/claim`, { servings: want });
      toast({ title: 'Claimed', body: 'We are finding a volunteer now.', tone: 'success' });
      onClaimed();
    } catch (err) {
      toast({ title: 'Could not claim', body: err.message, tone: 'danger' });
      onClaimed();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link href={`/listing/${l.id}`} className="block truncate text-base font-bold text-slate-900">
            {l.title}
          </Link>
          <p className="truncate text-sm text-slate-500">{l.donor.orgName}</p>
        </div>
        {invited && <Badge tone="green">Offered to you</Badge>}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <FoodTypeBadge type={l.foodType} />
        <span className="font-semibold text-slate-900">{l.remainingServings} meals</span>
        <span className="text-slate-500">{fmtKm(m.distanceKm)} away</span>
        <span className="text-slate-500">≈ {fmtDuration(m.etaMinutes)} trip</span>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 pt-2">
        <TimeLeft until={l.bestBefore} label="before best-before" />
        <span className="text-xs text-slate-500">Pickup until {fmtTime(l.pickupUntil)}</span>
      </div>

      {l.handling && <p className="text-xs text-sky-800">{l.handling}</p>}

      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">How many meals?</span>
          <input
            type="number"
            min="1"
            max={Math.min(l.remainingServings, m.capacityLeft)}
            value={want}
            onChange={(e) => setServings(Math.max(1, Math.min(Number(e.target.value) || 1, Math.min(l.remainingServings, m.capacityLeft))))}
            className="block w-full rounded-xl border-0 bg-white px-3 py-2.5 text-base ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
        </label>
        <Button size="lg" loading={busy} onClick={claim} className="flex-1">
          Claim
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Your capacity left today: {m.capacityLeft} meals. Match score {Math.round(m.score * 100)}/100.
      </p>
      {want < l.remainingServings && <Notice tone="blue">The other {l.remainingServings - want} meals stay on offer to other NGOs.</Notice>}
    </Card>
  );
}
