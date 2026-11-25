'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import MapView from '@/components/MapView';
import ReportIssue from '@/components/ReportIssue';
import Icon from '@/components/Icon';
import { CodeInput, DeliverySteps, PhotoInput } from '@/components/bits';
import { Button, Card, ErrorBox, Field, KeyValue, Loading, Notice, PageHeader, Textarea } from '@/components/ui';
import { post } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useRealtime, useSocketEvent, useSubscribe, useToast } from '@/lib/realtime';
import { fmtKm, fmtTime, navigateUrl } from '@/lib/format';
import { currentPosition } from '@/lib/upload';

export default function TaskPage({ params }) {
  const { id } = use(params);
  return (
    <AppShell roles={['volunteer']}>
      <Task id={id} />
    </AppShell>
  );
}

function Task({ id }) {
  const router = useRouter();
  const { data, error, loading, reload } = useData(`/deliveries/${id}`, { poll: 60000 });
  useSubscribe('delivery', id);
  useSocketEvent('delivery:status', reload);
  const [step, setStep] = useState(null); // 'pickup' | 'drop' | 'fail'

  const d = data?.delivery;
  useLiveLocation(Boolean(d && ['assigned', 'picked_up'].includes(d.status)));

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const collecting = d.status === 'assigned';
  const target = collecting ? d.donor : d.ngo;

  if (step === 'pickup' || step === 'drop') {
    return <Handoff delivery={d} kind={step} onCancel={() => setStep(null)} onDone={() => { setStep(null); reload(); }} />;
  }

  return (
    <>
      <PageHeader title={d.listing.title} subtitle={`${d.servings} meals`} back="/volunteer" />

      {['delivered', 'confirmed'].includes(d.status) && (
        <Notice tone="green" className="mb-3" title="Delivered. Thank you!">
          {d.status === 'confirmed' ? 'The NGO has confirmed it.' : 'Waiting for the NGO to confirm.'}
        </Notice>
      )}
      {d.status === 'failed' && <Notice tone="red" className="mb-3" title="This task was closed as failed">The admins have it.</Notice>}

      <div className="space-y-3">
        <MapView
          height={260}
          markers={[
            { lat: d.donor.lat, lng: d.donor.lng, emoji: '🍲', label: d.donor.orgName, color: '#d97706' },
            { lat: d.ngo.lat, lng: d.ngo.lng, emoji: '🏠', label: d.ngo.orgName, color: '#1a7d4e' },
          ]}
          lines={[[{ lat: d.donor.lat, lng: d.donor.lng }, { lat: d.ngo.lat, lng: d.ngo.lng }]]}
        />

        {['assigned', 'picked_up'].includes(d.status) && (
          <Card className="space-y-3 ring-2 ring-brand-500">
            <p className="text-xs font-bold uppercase tracking-wide text-brand-700">{collecting ? 'Step 1 · Collect' : 'Step 2 · Deliver'}</p>
            <div>
              <p className="text-lg font-bold text-slate-900">{target.orgName}</p>
              <p className="text-sm text-slate-600">{target.address}</p>
            </div>
            {collecting && <p className="text-sm font-medium text-saffron-700">Reach the donor before {fmtTime(d.listing.pickupUntil)}.</p>}
            <div className="grid grid-cols-2 gap-2">
              <a
                href={navigateUrl(target.lat, target.lng)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 font-semibold text-white"
              >
                <Icon name="nav" size={18} /> Navigate
              </a>
              <a
                href="/volunteer"
                onClick={(e) => {
                  e.preventDefault();
                  router.push('/volunteer');
                }}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white font-semibold text-slate-800 ring-1 ring-slate-300"
              >
                <Icon name="home" size={18} /> Tasks
              </a>
            </div>
            <Button size="lg" block onClick={() => setStep(collecting ? 'pickup' : 'drop')}>
              {collecting ? "I'm at the donor — enter pickup code" : "I'm at the NGO — enter drop code"}
            </Button>
            <p className="text-center text-xs text-slate-500">
              Keep this page open during the trip so the NGO can see you moving.
            </p>
          </Card>
        )}

        <Card>
          <p className="mb-2 font-semibold text-slate-900">Progress</p>
          <DeliverySteps delivery={d} />
        </Card>

        <Card>
          <KeyValue
            items={[
              ['Food', d.listing.title],
              ['Meals', d.servings],
              ['Best before', fmtTime(d.listing.bestBefore)],
              d.distanceKm != null && ['Trip length', fmtKm(d.distanceKm)],
              ['Collect from', `${d.donor.orgName}, ${d.donor.address}`],
              ['Deliver to', `${d.ngo.orgName}, ${d.ngo.address}`],
            ]}
          />
          {d.listing.handling && <Notice tone="blue" className="mt-3">{d.listing.handling}</Notice>}
        </Card>

        {['assigned', 'picked_up'].includes(d.status) &&
          (step === 'fail' ? (
            <FailCard id={id} onCancel={() => setStep(null)} onDone={() => router.replace('/volunteer')} />
          ) : (
            <Button variant="ghost" block onClick={() => setStep('fail')}>
              I cannot complete this task
            </Button>
          ))}

        <ReportIssue deliveryId={id} listingId={d.listing.id} />
      </div>
    </>
  );
}

// Sends GPS over the socket while the task page is open. A browser cannot track
// in the background, which is why the page asks the volunteer to keep it open.
function useLiveLocation(active) {
  const { socket } = useRealtime();
  const watch = useRef(null);
  useEffect(() => {
    if (!active || !socket || typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
    watch.current = navigator.geolocation.watchPosition(
      (p) => socket.emit('location:update', { lat: p.coords.latitude, lng: p.coords.longitude }, () => {}),
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watch.current);
  }, [active, socket]);
}

function Handoff({ delivery: d, kind, onCancel, onDone }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isPickup = kind === 'pickup';

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const pos = await currentPosition({ timeout: 6000 });
      await post(`/deliveries/${d.id}/${kind}`, { code, photoUrl, lat: pos?.lat, lng: pos?.lng });
      toast({
        title: isPickup ? 'Picked up' : 'Delivered. Thank you!',
        body: isPickup ? 'Head to the NGO now.' : 'The NGO has been asked to confirm.',
        tone: 'success',
      });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={isPickup ? 'Pickup check' : 'Drop check'}
        subtitle={isPickup ? `Ask ${d.donor.orgName} for their 4-digit code` : `Ask ${d.ngo.orgName} for their 4-digit code`}
      />
      <div className="space-y-4">
        <Card className="space-y-4">
          <Field label="4-digit code" group>
            <CodeInput value={code} onChange={setCode} />
          </Field>
          <Field label={isPickup ? 'Photo of the packed food' : 'Photo at handover'} group>
            <PhotoInput value={photoUrl} onChange={setPhotoUrl} label="Take photo" folder="handoffs" />
          </Field>
          <Notice tone="blue">Your location is recorded with the photo, as proof of the handoff.</Notice>
          <ErrorBox error={error} />
          <Button block size="lg" loading={busy} disabled={code.length !== 4 || !photoUrl} onClick={submit}>
            {isPickup ? 'Confirm pickup' : 'Confirm delivery'}
          </Button>
          <Button variant="ghost" block onClick={onCancel}>
            Back
          </Button>
        </Card>
        {isPickup && (
          <Card>
            <p className="font-semibold text-slate-900">Before you leave</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600">
              <li>Food is covered and sealed</li>
              <li>It is in your clean, food-only insulated bag or box</li>
              <li>Veg and non-veg are packed separately</li>
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function FailCard({ id, onCancel, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await post(`/deliveries/${id}/fail`, { reason: reason.trim() });
      toast({ title: 'Task closed', body: 'An admin will take it from here.', tone: 'info' });
      onDone();
    } catch (err) {
      toast({ title: 'Could not close the task', body: err.message, tone: 'danger' });
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <p className="font-semibold text-slate-900">Why can you not finish?</p>
      <p className="text-sm text-slate-600">The food may still be rescued by someone else, so please tell us quickly.</p>
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Bike broke down near Gokul Road" />
      <div className="flex gap-2">
        <Button variant="danger" block loading={busy} disabled={reason.trim().length < 3} onClick={submit}>
          Close this task
        </Button>
        <Button variant="secondary" block onClick={onCancel}>
          Keep going
        </Button>
      </div>
    </Card>
  );
}
