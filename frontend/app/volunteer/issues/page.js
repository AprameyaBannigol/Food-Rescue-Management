'use client';

import AppShell from '@/components/AppShell';
import IssueList from '@/components/IssueList';
import { Notice, PageHeader, Toggle, Card } from '@/components/ui';
import { patch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/realtime';
import { useState } from 'react';

export default function VolunteerIssuesPage() {
  return (
    <AppShell roles={['volunteer']}>
      <OnCall />
    </AppShell>
  );
}

// Between 10 PM and 7 AM IST the on-call volunteer handles escalations instead of the admins.
function isNightNow() {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const h = ist.getHours();
  return h >= 22 || h < 7;
}

function OnCall() {
  const { profile, refresh } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const night = isNightNow();
  const onCall = Boolean(profile?.isOnCall);

  async function toggle(v) {
    setBusy(true);
    try {
      await patch('/profile/volunteer/availability', { isOnCall: v });
      await refresh();
    } catch (err) {
      toast({ title: 'Could not change that', body: err.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="On call" subtitle="Night escalations, 10 PM to 7 AM" />
      <Card className="mb-3">
        <Toggle
          checked={onCall}
          disabled={busy || !profile?.verifiedAt}
          onChange={toggle}
          label="I am on call tonight"
          hint="You get the alerts an admin would get, and can resolve them"
        />
      </Card>

      {!onCall ? (
        <Notice tone="blue">Turn on the switch above to take tonight's escalations. You can still see problems you reported yourself below.</Notice>
      ) : !night ? (
        <Notice tone="blue">It is daytime, so the admins are handling escalations. Yours show up here from 10 PM.</Notice>
      ) : (
        <Notice tone="amber" className="mb-3" title="You are on call">
          Unclaimed food and stuck deliveries come to you. Call the donor or NGO and note what you did.
        </Notice>
      )}

      <div className="mt-3">
        <IssueList canHandle={onCall && night} />
      </div>
    </>
  );
}
