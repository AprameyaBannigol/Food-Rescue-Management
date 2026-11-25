'use client';

// Runtime settings: radius, wave sizes, timeouts, score weights, night hours.
// Admins change them through PUT /admin/config/:key, and the API takes effect at once.
import { useState } from 'react';
import { put } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useToast } from '@/lib/realtime';
import { Button, Card, ErrorBox, Input, Loading } from './ui';

const LABELS = {
  ngo_radius_km: 'NGO search radius (km)',
  volunteer_radius_km: 'Volunteer radius (km)',
  volunteer_radius_widened_km: 'Widened volunteer radius (km)',
  safety_buffer_minutes: 'Safety buffer before best-before (min)',
  offer_wave_minutes: 'Minutes between offer waves',
  offer_wave_sizes: 'Offer wave sizes',
  volunteer_widen_after_minutes: 'Widen volunteer radius after (min)',
  volunteer_escalate_after_minutes: 'Escalate with no volunteer after (min)',
  auto_confirm_hours: 'Auto-confirm a delivery after (h)',
  night_from: 'Night starts (hour, IST)',
  night_to: 'Night ends (hour, IST)',
  donor_pause_not_ok_count: '"Food not OK" reports that pause a donor',
  donor_pause_window_days: 'Within how many days',
};

export default function ConfigPanel() {
  const { data, error, loading, reload } = useData('/admin/config');
  const toast = useToast();
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const effective = data.effective ?? {};
  const overridden = new Set((data.overrides ?? []).map((o) => o.key));

  async function save(key) {
    const raw = edits[key];
    const current = effective[key];
    let value;
    if (typeof current === 'number') value = Number(raw);
    else if (Array.isArray(current)) value = String(raw).split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
    else if (typeof current === 'boolean') value = raw === 'true';
    else value = raw;

    setBusy(key);
    try {
      await put(`/admin/config/${key}`, { value });
      toast({ title: 'Saved', body: `${LABELS[key] ?? key} updated.`, tone: 'success' });
      setEdits((s) => ({ ...s, [key]: undefined }));
      reload();
    } catch (err) {
      toast({ title: 'Could not save', body: err.message, tone: 'danger' });
    } finally {
      setBusy(null);
    }
  }

  const keys = Object.keys(effective).filter((k) => typeof effective[k] !== 'object' || Array.isArray(effective[k]));

  return (
    <Card>
      <p className="mb-3 text-sm text-slate-600">
        These take effect immediately for every new listing and offer. Lists are comma separated.
      </p>
      <ul className="divide-y divide-slate-100">
        {keys.map((k) => {
          const shown = edits[k] ?? (Array.isArray(effective[k]) ? effective[k].join(', ') : String(effective[k]));
          const dirty = edits[k] !== undefined && shown !== (Array.isArray(effective[k]) ? effective[k].join(', ') : String(effective[k]));
          return (
            <li key={k} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{LABELS[k] ?? k}</p>
                <p className="truncate text-xs text-slate-400">
                  {k}
                  {overridden.has(k) ? ' · changed from the default' : ''}
                </p>
              </div>
              <Input value={shown} onChange={(e) => setEdits((s) => ({ ...s, [k]: e.target.value }))} className="w-28 py-1.5 text-sm" />
              <Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} loading={busy === k} onClick={() => save(k)}>
                Save
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
