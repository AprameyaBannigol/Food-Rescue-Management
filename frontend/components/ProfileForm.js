'use client';

import { useState } from 'react';
import { put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { HUBBALLI } from '@/lib/format';
import { Button, ErrorBox, Field, Input, Notice, Select, Toggle } from './ui';
import { LocationPicker, PhotoInput } from './bits';

// Profile + verification documents for donors, NGOs and volunteers.
// Changing a licence, certificate or ID sends the profile back to the admin queue.
export default function ProfileForm({ onSaved, submitLabel = 'Save' }) {
  const { user, profile, refresh } = useAuth();
  const p = profile ?? {};
  const [f, setF] = useState({
    name: user.name ?? '',
    orgName: p.orgName ?? '',
    type: p.type ?? 'hotel',
    fssaiLicenceNo: p.fssaiLicenceNo ?? '',
    licenceUrl: p.licenceUrl ?? '',
    regCertNo: p.regCertNo ?? '',
    regCertUrl: p.regCertUrl ?? '',
    address: p.address ?? '',
    loc: p.lat != null ? { lat: p.lat, lng: p.lng } : null,
    dailyCapacity: p.dailyCapacity ?? 100,
    vegOnly: p.vegOnly ?? false,
    openFrom: p.openFrom ?? '08:00',
    openTo: p.openTo ?? '22:00',
    vehicle: p.vehicle ?? 'bike',
    idProofUrl: p.idProofUrl ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const name = f.name.trim() || undefined;
    let body;
    if (user.role === 'donor') {
      if (!f.loc) return setError('Drop a pin on the map for your kitchen');
      if (!f.licenceUrl) return setError('Upload a photo of your FSSAI licence');
      body = { name, orgName: f.orgName, type: f.type, fssaiLicenceNo: f.fssaiLicenceNo, licenceUrl: f.licenceUrl, address: f.address, ...f.loc };
    } else if (user.role === 'ngo') {
      if (!f.loc) return setError('Drop a pin on the map for where food is received');
      if (!f.regCertUrl) return setError('Upload your registration certificate');
      body = {
        name,
        orgName: f.orgName,
        regCertNo: f.regCertNo,
        regCertUrl: f.regCertUrl,
        address: f.address,
        ...f.loc,
        dailyCapacity: Number(f.dailyCapacity),
        vegOnly: f.vegOnly,
        openFrom: f.openFrom,
        openTo: f.openTo,
      };
    } else {
      if (!f.idProofUrl) return setError('Upload a photo of a government ID');
      body = { name, vehicle: f.vehicle, idProofUrl: f.idProofUrl };
    }
    setBusy(true);
    try {
      await put(`/profile/${user.role}`, body);
      await refresh();
      onSaved?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Your name">
        <Input value={f.name} onChange={set('name')} autoComplete="name" />
      </Field>

      {user.role === 'donor' && (
        <>
          <Field label="Hotel / mess name">
            <Input value={f.orgName} onChange={set('orgName')} required minLength={2} placeholder="e.g. Hotel Sai Palace" />
          </Field>
          <Field label="Type">
            <Select value={f.type} onChange={set('type')}>
              <option value="hotel">Hotel</option>
              <option value="restaurant">Restaurant</option>
              <option value="mess">Hostel or college mess</option>
              <option value="caterer">Caterer</option>
            </Select>
          </Field>
          <Field label="FSSAI licence number" hint="14 digits, printed on your FSSAI licence or registration">
            <Input value={f.fssaiLicenceNo} onChange={(e) => set('fssaiLicenceNo')(e.target.value.replace(/\D/g, '').slice(0, 14))} inputMode="numeric" required pattern="\d{14}" />
          </Field>
          <Field label="FSSAI licence photo" group>
            <PhotoInput value={f.licenceUrl} onChange={set('licenceUrl')} label="Upload licence" folder="documents" accept="image/*,application/pdf" capture={undefined} />
          </Field>
        </>
      )}

      {user.role === 'ngo' && (
        <>
          <Field label="NGO name">
            <Input value={f.orgName} onChange={set('orgName')} required minLength={2} placeholder="e.g. Hope Night Shelter" />
          </Field>
          <Field label="Registration certificate number" hint="Trust, society or Section 8 company registration">
            <Input value={f.regCertNo} onChange={set('regCertNo')} required minLength={3} />
          </Field>
          <Field label="Registration certificate" group>
            <PhotoInput value={f.regCertUrl} onChange={set('regCertUrl')} label="Upload certificate" folder="documents" accept="image/*,application/pdf" capture={undefined} />
          </Field>
          <NgoSettingsFields f={f} set={set} />
        </>
      )}

      {(user.role === 'donor' || user.role === 'ngo') && (
        <>
          <Field label="Address">
            <Input value={f.address} onChange={set('address')} required minLength={5} placeholder="Street, area, Hubballi" />
          </Field>
          <Field label={user.role === 'donor' ? 'Pickup point on the map' : 'Where food is received'} group>
            <LocationPicker value={f.loc ?? (f.address ? null : null)} onChange={set('loc')} />
            {!f.loc && <p className="mt-1 text-xs text-slate-500">The map starts at Hubballi ({HUBBALLI.lat}, {HUBBALLI.lng}).</p>}
          </Field>
        </>
      )}

      {user.role === 'volunteer' && (
        <>
          <Field label="How do you travel?" hint="Orders over 50 servings go only to volunteers with a car">
            <Select value={f.vehicle} onChange={set('vehicle')}>
              <option value="bike">Bike or scooter</option>
              <option value="car">Car</option>
              <option value="none">On foot / bicycle</option>
            </Select>
          </Field>
          <Field label="Government ID (Aadhaar, driving licence, voter ID)" group>
            <PhotoInput value={f.idProofUrl} onChange={set('idProofUrl')} label="Upload ID photo" folder="documents" capture={undefined} />
          </Field>
          <Notice tone="blue">Carry food in a clean, food-only insulated bag or box, as FSSAI guidance asks.</Notice>
        </>
      )}

      <ErrorBox error={error} />
      <Button type="submit" block size="lg" loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function NgoSettingsFields({ f, set }) {
  return (
    <>
      <Field label="Meals you can take per day" hint="We only offer food while you still have capacity today">
        <Input type="number" min={1} max={100000} value={f.dailyCapacity} onChange={set('dailyCapacity')} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Receiving from">
          <Input type="time" value={f.openFrom} onChange={set('openFrom')} required />
        </Field>
        <Field label="Until">
          <Input type="time" value={f.openTo} onChange={set('openTo')} required />
        </Field>
      </div>
      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <Toggle checked={f.vegOnly} onChange={set('vegOnly')} label="Veg food only" hint="You will never be offered non-veg or mixed food" />
      </div>
    </>
  );
}
