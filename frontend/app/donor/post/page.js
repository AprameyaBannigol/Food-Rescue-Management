'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { PhotoInput } from '@/components/bits';
import { Button, Card, ErrorBox, Field, Input, Notice, PageHeader, Select, Textarea, cx } from '@/components/ui';
import { post } from '@/lib/api';
import { HOLDING, fmtTime, toLocalInput } from '@/lib/format';

export default function PostFoodPage() {
  return (
    <AppShell roles={['donor']}>
      <PostForm />
    </AppShell>
  );
}

// The 4 h / 12 h FSSAI limits, shown live so donors see the deadline before posting.
// The API caps best-before the same way, so this is only a preview.
const SAFE_HOURS = { hot: 4, room_temp: 4, chilled: 12 };

const CHECKLIST = [
  ['keptCovered', 'The food was kept covered the whole time'],
  ['tempChainUnbroken', 'It was kept hot (above 60°C) or cold (below 5°C) without a break'],
  ['vegNonVegSeparate', 'Veg and non-veg are packed separately'],
  ['noPlateLeftovers', 'Nothing here came back from guests’ plates'],
];

export function PostForm() {
  const router = useRouter();
  const now = useMemo(() => new Date(), []);
  const [f, setF] = useState({
    title: '',
    foodType: 'veg',
    holding: 'hot',
    totalServings: '',
    packaging: '',
    cookedAt: toLocalInput(new Date(now.getTime() - 30 * 60000)),
    pickupUntil: toLocalInput(new Date(now.getTime() + 2 * 60 * 60000)),
    notes: '',
    photoUrl: '',
  });
  const [items, setItems] = useState([{ name: '', quantity: '', unit: 'servings' }]);
  const [checks, setChecks] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }));
  const allChecked = CHECKLIST.every(([k]) => checks[k]);

  const bestBefore = useMemo(() => {
    const cooked = new Date(f.cookedAt);
    if (Number.isNaN(cooked.getTime())) return null;
    return new Date(cooked.getTime() + SAFE_HOURS[f.holding] * 3600 * 1000);
  }, [f.cookedAt, f.holding]);

  const minutesLeft = bestBefore ? (bestBefore - Date.now()) / 60000 : null;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const cleanItems = items
      .filter((i) => i.name.trim() && Number(i.quantity) > 0)
      .map((i) => ({ name: i.name.trim(), quantity: Number(i.quantity), unit: i.unit }));
    if (cleanItems.length === 0) return setError('Add at least one item with a quantity');
    setBusy(true);
    try {
      const res = await post('/listings', {
        title: f.title.trim(),
        foodType: f.foodType,
        holding: f.holding,
        items: cleanItems,
        totalServings: Number(f.totalServings),
        packaging: f.packaging.trim() || undefined,
        cookedAt: new Date(f.cookedAt).toISOString(),
        pickupUntil: new Date(f.pickupUntil).toISOString(),
        photoUrl: f.photoUrl || undefined,
        notes: f.notes.trim() || undefined,
        checklist: { keptCovered: true, tempChainUnbroken: true, vegNonVegSeparate: true, noPlateLeftovers: true },
      });
      router.replace(`/listing/${res.listing.id}?posted=1`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Post surplus food" subtitle="Takes about a minute. NGOs nearby are notified at once." back="/donor" />

      <form onSubmit={submit} className="space-y-4">
        <Card className="space-y-4">
          <Field label="What is it?">
            <Input value={f.title} onChange={set('title')} required minLength={2} placeholder="e.g. Veg pulao and dal from lunch" />
          </Field>

          <Field label="Food type" group>
            <div className="grid grid-cols-3 gap-2">
              {[['veg', 'Veg'], ['non_veg', 'Non-veg'], ['mixed', 'Both']].map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => set('foodType')(v)}
                  className={cx(
                    'min-h-11 rounded-xl text-sm font-semibold ring-2 transition',
                    f.foodType === v ? 'bg-brand-50 text-brand-800 ring-brand-500' : 'bg-white text-slate-700 ring-slate-200',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Items" group>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder="Item name"
                    value={it.name}
                    onChange={(e) => setItems((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder="Qty"
                    value={it.quantity}
                    onChange={(e) => setItems((s) => s.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                    className="w-20"
                  />
                  <Select
                    value={it.unit}
                    onChange={(e) => setItems((s) => s.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
                    className="w-28"
                  >
                    <option value="servings">servings</option>
                    <option value="kg">kg</option>
                    <option value="litres">litres</option>
                    <option value="packets">packets</option>
                    <option value="pieces">pieces</option>
                  </Select>
                  {items.length > 1 && (
                    <button type="button" aria-label="Remove item" onClick={() => setItems((s) => s.filter((_, j) => j !== i))} className="px-1 text-slate-400">
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setItems((s) => [...s, { name: '', quantity: '', unit: 'servings' }])}>
                + Add another item
              </Button>
            </div>
          </Field>

          <Field label="How many people can it feed?" hint="Total servings. NGOs claim all or part of this.">
            <Input type="number" min="1" inputMode="numeric" value={f.totalServings} onChange={set('totalServings')} required placeholder="e.g. 60" />
          </Field>

          <Field label="Packaging (optional)">
            <Input value={f.packaging} onChange={set('packaging')} placeholder="e.g. 3 covered steel vessels" />
          </Field>

          <PhotoInput value={f.photoUrl} onChange={set('photoUrl')} label="Photo of the packed food" folder="listings" />
        </Card>

        <Card className="space-y-4">
          <Field label="When was it cooked?" hint="This decides the safe window.">
            <Input type="datetime-local" value={f.cookedAt} onChange={set('cookedAt')} max={toLocalInput(new Date())} required />
          </Field>

          <Field label="How is it being held?">
            <Select value={f.holding} onChange={set('holding')}>
              {Object.entries(HOLDING).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          {bestBefore && (
            <Notice tone={minutesLeft < 60 ? 'red' : 'green'} title={`Safe to eat until ${fmtTime(bestBefore)}`}>
              {f.holding === 'chilled'
                ? 'Chilled food gets 12 hours, and the NGO is told to reheat it once to 74°C.'
                : 'Hot and room-temperature food gets 4 hours after cooking, following FSSAI guidance.'}
              {minutesLeft != null && minutesLeft < 60 && <strong className="mt-1 block">Under an hour left. There may not be time to deliver this.</strong>}
            </Notice>
          )}

          <Field label="Pickup possible until" hint="We never set this later than the safe limit.">
            <Input type="datetime-local" value={f.pickupUntil} onChange={set('pickupUntil')} required />
          </Field>

          <Field label="Notes for the NGO or volunteer (optional)">
            <Textarea value={f.notes} onChange={set('notes')} placeholder="e.g. Ask for the manager at the back gate" />
          </Field>
        </Card>

        <Card>
          <p className="mb-2 font-semibold text-slate-900">Before you post, confirm:</p>
          <ul className="space-y-2">
            {CHECKLIST.map(([k, label]) => (
              <li key={k}>
                <label className="flex items-start gap-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(checks[k])}
                    onChange={(e) => setChecks((s) => ({ ...s, [k]: e.target.checked }))}
                    className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span>{label}</span>
                </label>
              </li>
            ))}
          </ul>
          {!allChecked && <p className="mt-2 text-xs text-slate-500">All four are required by the food safety rules.</p>}
        </Card>

        <ErrorBox error={error} />
        <Button type="submit" size="lg" block loading={busy} disabled={!allChecked}>
          Post food and notify NGOs
        </Button>
      </form>
    </>
  );
}
