'use client';

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import { Card, ErrorBox, Loading, PageHeader, Segmented, Stat } from '@/components/ui';
import { useData } from '@/lib/useData';
import { DELIVERY_STATUS, LISTING_STATUS, ROLE, fmtDuration } from '@/lib/format';
import ConfigPanel from '@/components/ConfigPanel';

export default function AdminStatsPage() {
  return (
    <AppShell roles={['admin']} wide>
      <Stats />
    </AppShell>
  );
}

function Stats() {
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useData(`/admin/stats?days=${days}`);

  if (loading && !data) return <Loading />;

  return (
    <>
      <PageHeader title="City analytics" subtitle="Hubballi pilot" />
      <div className="mb-4 max-w-sm">
        <Segmented
          value={days}
          onChange={setDays}
          options={[
            { value: 7, label: '7 days' },
            { value: 30, label: '30 days' },
            { value: 90, label: '90 days' },
          ]}
        />
      </div>
      <ErrorBox error={error} onRetry={reload} />

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Meals delivered" value={(data.mealsDelivered ?? 0).toLocaleString('en-IN')} />
            <Stat label="Post to delivery" value={data.avgPostToDeliveryMinutes ? fmtDuration(data.avgPostToDeliveryMinutes) : '—'} sub="Average, target under 90 min" />
            <Stat label="Open issues" value={data.openIssues ?? 0} />
            <Stat label="People" value={(data.users ?? []).reduce((n, u) => n + u._count, 0)} />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Breakdown title="Listings" rows={data.listingsByStatus} labels={LISTING_STATUS} extra={(r) => `${r._sum?.totalServings ?? 0} meals`} />
            <Breakdown title="Deliveries" rows={data.deliveriesByStatus} labels={DELIVERY_STATUS} />
          </div>

          <Card className="mt-3">
            <p className="mb-2 font-semibold text-slate-900">People by role</p>
            <ul className="space-y-1 text-sm">
              {(data.users ?? []).map((u) => (
                <li key={`${u.role}-${u.status}`} className="flex justify-between">
                  <span className="text-slate-600">
                    {ROLE[u.role]} · {u.status}
                  </span>
                  <span className="font-semibold text-slate-900">{u._count}</span>
                </li>
              ))}
            </ul>
          </Card>

          <h2 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">Settings</h2>
          <ConfigPanel />
        </>
      )}
    </>
  );
}

function Breakdown({ title, rows = [], labels, extra }) {
  const total = rows.reduce((n, r) => n + r._count, 0) || 1;
  return (
    <Card>
      <p className="mb-2 font-semibold text-slate-900">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing in this period.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.status}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-slate-700">{labels[r.status] ?? r.status}</span>
                <span className="text-slate-500">
                  {r._count}
                  {extra ? ` · ${extra(r)}` : ''}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round((r._count / total) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
