'use client';

import AppShell from '@/components/AppShell';
import { Card, Empty, ErrorBox, Loading, PageHeader, Stat } from '@/components/ui';
import { useData } from '@/lib/useData';
import { fmtMonth } from '@/lib/format';

export default function DonorImpactPage() {
  return (
    <AppShell roles={['donor']}>
      <Impact />
    </AppShell>
  );
}

function Impact() {
  const { data, error, loading, reload } = useData('/stats/me');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const monthly = data.monthly ?? [];
  const max = Math.max(1, ...monthly.map((m) => m.meals));

  return (
    <>
      <PageHeader title="Your impact" subtitle="Counted when an NGO confirms it received the food." />
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Meals donated" value={(data.mealsDonated ?? 0).toLocaleString('en-IN')} />
        <Stat label="Food saved" value={`${(data.kgSaved ?? 0).toFixed(1)} kg`} sub="From items listed in kg" />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">Month by month</h2>
      {monthly.length === 0 ? (
        <Empty icon="📈" title="No deliveries yet">Your first confirmed delivery shows up here.</Empty>
      ) : (
        <Card className="space-y-3">
          {monthly.map((m) => (
            <div key={m.month}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium text-slate-700">{fmtMonth(m.month)}</span>
                <span className="text-slate-500">
                  {m.meals} meals · {m.listings} posts
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round((m.meals / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card className="mt-4 bg-brand-50 ring-brand-100">
        <p className="text-sm text-brand-900">
          Every {Math.max(1, Math.round((data.mealsDonated ?? 0) / 3) || 1)} plates you sent on would otherwise have gone to waste. Thank you for posting
          promptly — the sooner food is listed, the more of its safe window is left for the trip.
        </p>
      </Card>
    </>
  );
}
