'use client';

import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { Card, Empty, LinkButton, Loading, ErrorBox, PageHeader, Badge } from '@/components/ui';
import { DeliveryStatus, FoodTypeBadge, ListingStatus, TimeLeft } from '@/components/bits';
import { useData } from '@/lib/useData';
import { useSocketEvent } from '@/lib/realtime';
import { DELIVERY_STATUS, fmtTime } from '@/lib/format';

export default function DonorHome() {
  return (
    <AppShell roles={['donor']}>
      <Body />
    </AppShell>
  );
}

const OPEN = ['posted', 'offered', 'partially_claimed', 'fully_claimed'];

function Body() {
  const { data, error, loading, reload } = useData('/listings/mine', { poll: 60000 });
  useSocketEvent('listing:status', reload);
  useSocketEvent('delivery:status', reload);
  useSocketEvent('notification', reload);

  const listings = data?.listings ?? [];
  const active = listings.filter((l) => OPEN.includes(l.status) && !isFinished(l));
  const past = listings.filter((l) => !active.includes(l));

  return (
    <>
      <PageHeader title="Your surplus food" subtitle="Post it as soon as service ends, so it still has hours left." />

      <LinkButton href="/donor/post" size="lg" block className="mb-5">
        + Post surplus food
      </LinkButton>

      {loading && !data ? (
        <Loading />
      ) : (
        <>
          <ErrorBox error={error} onRetry={reload} />
          {active.length === 0 && !error ? (
            <Empty title="Nothing active right now">Posted food appears here with its live status.</Empty>
          ) : (
            <ul className="space-y-3">
              {active.map((l) => (
                <li key={l.id}>
                  <ListingCard listing={l} />
                </li>
              ))}
            </ul>
          )}

          {past.length > 0 && (
            <>
              <h2 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">Earlier</h2>
              <ul className="space-y-2">
                {past.slice(0, 20).map((l) => (
                  <li key={l.id}>
                    <Link href={`/listing/${l.id}`}>
                      <Card className="flex items-center gap-3 py-3">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-slate-800">{l.title}</span>
                          <span className="block text-xs text-slate-500">
                            {fmtTime(l.createdAt)} · {l.totalServings} meals
                          </span>
                        </span>
                        <ListingStatus status={l.status} />
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}

function isFinished(l) {
  const ds = l.claims.map((c) => c.delivery?.status).filter(Boolean);
  return l.status === 'fully_claimed' && ds.length > 0 && ds.every((s) => ['confirmed', 'failed'].includes(s));
}

function ListingCard({ listing: l }) {
  const claims = l.claims ?? [];
  const pickupCode = claims.map((c) => c.delivery?.pickupCode).find(Boolean);
  const waiting = claims.find((c) => c.delivery && ['assigned', 'picked_up'].includes(c.delivery.status));

  return (
    <Link href={`/listing/${l.id}`}>
      <Card className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-slate-900">{l.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <FoodTypeBadge type={l.foodType} />
              <span className="text-xs text-slate-500">
                {l.remainingServings < l.totalServings ? `${l.totalServings - l.remainingServings} of ${l.totalServings}` : l.totalServings} meals claimed
              </span>
            </div>
          </div>
          <ListingStatus status={l.status} />
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-2">
          <TimeLeft until={l.bestBefore} label="before best-before" />
          <span className="text-xs text-slate-500">Pickup until {fmtTime(l.pickupUntil)}</span>
        </div>

        {claims.length > 0 && (
          <ul className="space-y-1.5">
            {claims.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-slate-700">
                  {c.ngo?.orgName ?? 'NGO'} · {c.servings} meals
                </span>
                {c.delivery ? <DeliveryStatus status={c.delivery.status} /> : <Badge>Claimed</Badge>}
              </li>
            ))}
          </ul>
        )}

        {waiting && pickupCode && (
          <div className="flex items-center justify-between rounded-xl bg-slate-900 px-3 py-2 text-white">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Pickup code</span>
            <span className="code-digits text-xl font-bold">{pickupCode}</span>
          </div>
        )}
        {claims.some((c) => c.delivery?.status === 'delivered') && (
          <p className="text-xs text-brand-700">Delivered. Waiting for the NGO to confirm.</p>
        )}
        {claims.some((c) => c.delivery?.status === 'unassigned') && (
          <p className="text-xs text-saffron-700">{DELIVERY_STATUS.unassigned}…</p>
        )}
      </Card>
    </Link>
  );
}
