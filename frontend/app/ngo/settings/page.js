'use client';

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import { LocationPicker } from '@/components/bits';
import { NgoSettingsFields } from '@/components/ProfileForm';
import { Button, Card, ErrorBox, Field, Input, Notice, PageHeader } from '@/components/ui';
import { patch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/realtime';

export default function NgoSettingsPage() {
  return (
    <AppShell roles={['ngo']}>
      <Settings />
    </AppShell>
  );
}

// These settings change matching at once and need no re-verification.
function Settings() {
  const { profile, refresh } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({
    dailyCapacity: profile.dailyCapacity,
    openFrom: profile.openFrom,
    openTo: profile.openTo,
    vegOnly: profile.vegOnly,
    address: profile.address,
    loc: { lat: profile.lat, lng: profile.lng },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await patch('/profile/ngo/settings', {
        dailyCapacity: Number(f.dailyCapacity),
        openFrom: f.openFrom,
        openTo: f.openTo,
        vegOnly: f.vegOnly,
        address: f.address,
        lat: f.loc.lat,
        lng: f.loc.lng,
      });
      await refresh();
      toast({ title: 'Saved', body: 'Matching uses the new settings from now on.', tone: 'success' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Receiving settings" subtitle="Capacity, hours, food preference and your pin." />
      <div className="space-y-3">
        <Card className="space-y-4">
          <NgoSettingsFields f={f} set={set} />
        </Card>

        <Card className="space-y-3">
          <Field label="Address">
            <Input value={f.address} onChange={set('address')} minLength={5} />
          </Field>
          <Field label="Where food is received" group>
            <LocationPicker value={f.loc} onChange={set('loc')} />
          </Field>
        </Card>

        <Notice tone="blue">
          Changing these does not affect your verification. To change your NGO name or certificate, use Profile.
        </Notice>
        <ErrorBox error={error} />
        <Button block size="lg" loading={busy} onClick={save}>
          Save settings
        </Button>
      </div>
    </>
  );
}
