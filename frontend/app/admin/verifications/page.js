'use client';

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import MapView from '@/components/MapView';
import { Badge, Button, Card, Empty, ErrorBox, KeyValue, Loading, Notice, PageHeader } from '@/components/ui';
import { post } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useSocketEvent, useToast } from '@/lib/realtime';
import { DONOR_TYPE, ROLE, VEHICLE, fmtDateTime, maskPhone } from '@/lib/format';

export default function VerificationsPage() {
  return (
    <AppShell roles={['admin']} wide>
      <Queue />
    </AppShell>
  );
}

function Queue() {
  const { data, error, loading, reload } = useData('/admin/verifications', { poll: 60000 });
  useSocketEvent('verification:new', reload);
  const toast = useToast();
  const [busy, setBusy] = useState(null);

  async function act(user, kind) {
    setBusy(user.id);
    try {
      if (kind === 'verify') await post(`/admin/users/${user.id}/verify`);
      else await post(`/admin/users/${user.id}/suspend`, { reason: 'Documents could not be verified' });
      toast({ title: kind === 'verify' ? 'Verified' : 'Rejected', body: user.name ?? user.phone, tone: 'success' });
      reload();
    } catch (err) {
      toast({ title: 'Could not do that', body: err.message, tone: 'danger' });
    } finally {
      setBusy(null);
    }
  }

  const users = data?.users ?? [];
  if (loading && !data) return <Loading />;

  return (
    <>
      <PageHeader title="Verification queue" subtitle="Check the document, then approve. Nobody can post, claim or deliver until you do." />
      <ErrorBox error={error} onRetry={reload} />

      {users.length === 0 ? (
        <Empty icon="✅" title="Queue is empty">New donors, NGOs and volunteers land here as soon as they submit their profile.</Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {users.map((u) => {
            const p = u.donor ?? u.ngo ?? u.volunteer;
            const doc = p?.licenceUrl ?? p?.regCertUrl ?? p?.idProofUrl;
            const demo = doc?.startsWith('https://example.org');
            return (
              <li key={u.id}>
                <Card className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{p?.orgName ?? u.name ?? 'No name'}</p>
                      <p className="text-sm text-slate-500">
                        {u.name ?? '—'} · {maskPhone(u.phone)}
                      </p>
                    </div>
                    <Badge tone="blue">{ROLE[u.role]}</Badge>
                  </div>

                  <KeyValue
                    items={[
                      ['Applied', fmtDateTime(u.createdAt)],
                      u.donor && ['Type', DONOR_TYPE[u.donor.type]],
                      u.donor && ['FSSAI licence', u.donor.fssaiLicenceNo ?? '—'],
                      u.ngo && ['Registration no.', u.ngo.regCertNo ?? '—'],
                      u.ngo && ['Daily capacity', `${u.ngo.dailyCapacity} meals`],
                      u.ngo && ['Hours', `${u.ngo.openFrom} – ${u.ngo.openTo}`],
                      u.ngo && ['Food', u.ngo.vegOnly ? 'Veg only' : 'Veg and non-veg'],
                      u.volunteer && ['Vehicle', VEHICLE[u.volunteer.vehicle]],
                      p?.address && ['Address', p.address],
                    ]}
                  />

                  {doc && (
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Document</p>
                      {demo ? (
                        <Notice tone="blue">Uploaded in demo mode, so there is no file to open.</Notice>
                      ) : (
                        <a href={doc} target="_blank" rel="noreferrer" className="block">
                          <img src={doc} alt="Uploaded document" className="max-h-40 w-full rounded-xl object-contain bg-slate-50 ring-1 ring-slate-200" />
                          <span className="mt-1 block text-xs font-semibold text-brand-700">Open full size</span>
                        </a>
                      )}
                    </div>
                  )}

                  {p?.lat != null && <MapView height={150} markers={[{ lat: p.lat, lng: p.lng, emoji: u.role === 'ngo' ? '🏠' : '🍲' }]} zoom={14} />}

                  <div className="flex gap-2">
                    <Button block loading={busy === u.id} onClick={() => act(u, 'verify')}>
                      Verify
                    </Button>
                    <Button variant="danger" loading={busy === u.id} onClick={() => act(u, 'reject')}>
                      Reject
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
