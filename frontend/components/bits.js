'use client';

import { useRef, useState } from 'react';
import { Badge, Button, Spinner, cx } from './ui';
import { DELIVERY_STATUS, FOOD_TYPE, LISTING_STATUS, fmtDuration, minutesUntil } from '@/lib/format';
import { uploadFile, uploadsConfigured, currentPosition } from '@/lib/upload';
import { useNow } from '@/lib/useData';
import MapView from './MapView';

const LISTING_TONE = { posted: 'blue', offered: 'blue', partially_claimed: 'amber', fully_claimed: 'green', expired: 'red', cancelled: 'slate' };
const DELIVERY_TONE = { unassigned: 'amber', assigned: 'blue', picked_up: 'violet', delivered: 'green', confirmed: 'green', failed: 'red' };

export function ListingStatus({ status }) {
  return <Badge tone={LISTING_TONE[status]}>{LISTING_STATUS[status] ?? status}</Badge>;
}

export function DeliveryStatus({ status }) {
  return <Badge tone={DELIVERY_TONE[status]}>{DELIVERY_STATUS[status] ?? status}</Badge>;
}

export function FoodTypeBadge({ type }) {
  const dot = type === 'veg' ? 'bg-green-600' : type === 'non_veg' ? 'bg-red-600' : 'bg-saffron-500';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
      <span className={cx('inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border-2', type === 'veg' ? 'border-green-600' : type === 'non_veg' ? 'border-red-600' : 'border-saffron-500')}>
        <span className={cx('h-1.5 w-1.5 rounded-full', dot)} />
      </span>
      {FOOD_TYPE[type] ?? type}
    </span>
  );
}

// "2 h 10 min left", red under 45 minutes.
export function TimeLeft({ until, label = 'left', className }) {
  const now = useNow(30000);
  const m = minutesUntil(until, now);
  if (m <= 0) return <span className={cx('text-sm font-semibold text-red-600', className)}>Time up</span>;
  return <span className={cx('text-sm font-semibold', m < 45 ? 'text-red-600' : m < 90 ? 'text-saffron-700' : 'text-slate-700', className)}>{fmtDuration(m)} {label}</span>;
}

// Camera-first photo picker that uploads and returns a URL.
export function PhotoInput({ value, onChange, label = 'Add photo', folder, accept = 'image/*', capture = 'environment' }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setBusy(true);
    if (file.type.startsWith('image/')) setPreview(URL.createObjectURL(file));
    try {
      onChange(await uploadFile(file, folder));
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  const shown = preview ?? (value && !value.startsWith('https://example.org') ? value : null);
  return (
    <div>
      <input ref={ref} type="file" accept={accept} capture={capture} className="hidden" onChange={onFile} />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={cx(
          'flex w-full items-center gap-3 rounded-xl border-2 border-dashed p-3 text-left transition',
          value ? 'border-brand-300 bg-brand-50' : 'border-slate-300 bg-white hover:border-brand-400',
        )}
      >
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-2xl">
          {busy ? <Spinner /> : shown && accept.startsWith('image') ? <img src={shown} alt="" className="h-full w-full object-cover" /> : value ? '📄' : '📷'}
        </span>
        <span className="min-w-0">
          <span className="block font-semibold text-slate-900">{value ? 'Photo added. Tap to retake' : label}</span>
          <span className="block text-xs text-slate-500">
            {busy ? 'Uploading…' : uploadsConfigured ? 'Opens the camera on phones' : 'Demo mode: a small thumbnail is kept'}
          </span>
        </span>
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// Map pin + "use my location" for addresses.
export function LocationPicker({ value, onChange }) {
  const [locating, setLocating] = useState(false);
  const [msg, setMsg] = useState(null);
  async function useMine() {
    setLocating(true);
    setMsg(null);
    const pos = await currentPosition();
    setLocating(false);
    if (pos) onChange({ lat: pos.lat, lng: pos.lng });
    else setMsg('Could not get your location. Tap the map instead.');
  }
  return (
    <div className="space-y-2">
      <MapView
        height={220}
        zoom={14}
        markers={value?.lat != null ? [{ lat: value.lat, lng: value.lng, emoji: '📍' }] : []}
        onPick={(p) => onChange(p)}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">{value?.lat != null ? `Pin at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : 'Tap the map to drop a pin'}</p>
        <Button size="sm" variant="secondary" onClick={useMine} loading={locating}>
          Use my location
        </Button>
      </div>
      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </div>
  );
}

// Four separate boxes for the 4-digit handoff code.
export function CodeInput({ value, onChange, length = 4 }) {
  const refs = useRef([]);
  const digits = value.padEnd(length, ' ').slice(0, length).split('');
  function set(i, d) {
    const arr = value.padEnd(length, ' ').split('').slice(0, length);
    arr[i] = d || ' ';
    onChange(arr.join('').replace(/\s+$/, '').replace(/\s/g, ''));
  }
  return (
    <div className="flex justify-center gap-3">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(r) => (refs.current[i] = r)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={length}
          aria-label={`Digit ${i + 1}`}
          value={d.trim()}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (v.length > 1) {
              onChange(v.slice(0, length));
              refs.current[Math.min(v.length, length) - 1]?.focus();
              return;
            }
            set(i, v);
            if (v && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d.trim() && i > 0) refs.current[i - 1]?.focus();
          }}
          className="h-16 w-14 rounded-xl border-0 bg-white text-center text-3xl font-bold text-slate-900 ring-2 ring-slate-300 focus:ring-brand-500 focus:outline-none"
        />
      ))}
    </div>
  );
}

// The code a donor or NGO reads out to the volunteer.
export function BigCode({ code, label }) {
  return (
    <div className="rounded-2xl bg-slate-900 px-4 py-5 text-center text-white">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">{label}</p>
      <p className="code-digits mt-1 text-5xl font-bold">{code}</p>
      <p className="mt-2 text-xs text-slate-400">Read this out only when the volunteer is in front of you.</p>
    </div>
  );
}

export function Stars({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={() => onChange(n)}
          className={cx('text-3xl transition', n <= value ? 'text-saffron-500' : 'text-slate-300')}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// Timeline of steps for a delivery.
export function DeliverySteps({ delivery }) {
  const steps = [
    { key: 'claimed', label: 'Claimed by NGO', at: delivery.createdAt, done: true },
    { key: 'assigned', label: 'Volunteer assigned', at: delivery.assignedAt, done: Boolean(delivery.assignedAt) },
    { key: 'picked_up', label: 'Picked up from donor', at: delivery.pickedUpAt, done: Boolean(delivery.pickedUpAt) },
    { key: 'delivered', label: 'Handed to NGO', at: delivery.deliveredAt, done: Boolean(delivery.deliveredAt) },
    { key: 'confirmed', label: 'NGO confirmed', at: delivery.confirmedAt, done: Boolean(delivery.confirmedAt) },
  ];
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => (
        <li key={s.key} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={cx('mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold', s.done ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500')}>
              {s.done ? '✓' : i + 1}
            </span>
            {i < steps.length - 1 && <span className={cx('w-0.5 flex-1', s.done ? 'bg-brand-300' : 'bg-slate-200')} style={{ minHeight: 18 }} />}
          </div>
          <div className="pb-3">
            <p className={cx('text-sm font-medium', s.done ? 'text-slate-900' : 'text-slate-400')}>{s.label}</p>
            {s.at && s.done && (
              <p className="text-xs text-slate-500">{new Date(s.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</p>
            )}
          </div>
        </li>
      ))}
      {delivery.status === 'failed' && <li className="ml-8 text-sm font-semibold text-red-600">This delivery failed. The admins have been told.</li>}
    </ol>
  );
}
