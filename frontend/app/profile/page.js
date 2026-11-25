'use client';

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import ProfileForm from '@/components/ProfileForm';
import { Badge, Button, Card, KeyValue, Notice, PageHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { DONOR_TYPE, ROLE, VEHICLE, fmtDate, maskPhone } from '@/lib/format';

export default function ProfilePage() {
  return (
    <AppShell roles={['donor', 'ngo', 'volunteer']}>
      <ProfileBody />
    </AppShell>
  );
}

const STATUS = { pending: ['amber', 'Waiting for verification'], verified: ['green', 'Verified'], suspended: ['red', 'Suspended'] };

function ProfileBody() {
  const { user, profile, signOut } = useAuth();
  const [editing, setEditing] = useState(false);
  const [tone, label] = STATUS[user.status] ?? ['slate', user.status];

  if (editing) {
    return (
      <>
        <PageHeader title="Edit profile" subtitle="Changing a document sends your profile back to the verification queue." />
        <ProfileForm submitLabel="Save changes" onSaved={() => setEditing(false)} />
        <Button variant="ghost" block className="mt-3" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Profile" subtitle={`${ROLE[user.role]} account`} action={<Badge tone={tone}>{label}</Badge>} />
      <div className="space-y-3">
        <Card>
          <KeyValue
            items={[
              ['Name', user.name ?? '—'],
              ['Phone', maskPhone(user.phone)],
              profile?.orgName && ['Organisation', profile.orgName],
              profile?.type && ['Type', DONOR_TYPE[profile.type]],
              profile?.fssaiLicenceNo && ['FSSAI licence', profile.fssaiLicenceNo],
              profile?.regCertNo && ['Registration no.', profile.regCertNo],
              profile?.address && ['Address', profile.address],
              profile?.dailyCapacity != null && ['Daily capacity', `${profile.dailyCapacity} meals`],
              profile?.openFrom && ['Receiving hours', `${profile.openFrom} – ${profile.openTo}`],
              profile?.vegOnly != null && ['Food preference', profile.vegOnly ? 'Veg only' : 'Veg and non-veg'],
              profile?.vehicle && ['Vehicle', VEHICLE[profile.vehicle]],
              profile?.rating != null && ['Rating', `${profile.rating.toFixed(1)} ★`],
              profile?.verifiedAt && ['Verified on', fmtDate(profile.verifiedAt)],
            ]}
          />
        </Card>
        {user.status === 'pending' && <Notice title="Verification pending">An admin reviews new accounts, usually the same day. You will get a notification.</Notice>}
        <Button variant="secondary" block onClick={() => setEditing(true)}>
          Edit profile
        </Button>
        <Button variant="ghost" block onClick={signOut}>
          Log out
        </Button>
        <p className="pt-2 text-center text-xs text-slate-400">Food Rescue · Hubballi pilot</p>
      </div>
    </>
  );
}
