'use client';

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, Segmented, Select, Textarea } from '@/components/ui';
import { post } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useToast } from '@/lib/realtime';
import { DONOR_TYPE, ROLE, VEHICLE, fmtDate, maskPhone } from '@/lib/format';

export default function AdminUsersPage() {
  return (
    <AppShell roles={['admin']} wide>
      <Users />
    </AppShell>
  );
}

const STATUS_TONE = { pending: 'amber', verified: 'green', suspended: 'red' };

function Users() {
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const query = new URLSearchParams(Object.entries({ role, status }).filter(([, v]) => v)).toString();
  const { data, error, loading, reload } = useData(`/admin/users${query ? `?${query}` : ''}`);
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [suspending, setSuspending] = useState(null);
  const [reason, setReason] = useState('');

  async function act(u, kind) {
    setBusy(u.id);
    try {
      if (kind === 'suspend') await post(`/admin/users/${u.id}/suspend`, { reason: reason.trim() || 'Suspended by an admin' });
      else if (kind === 'reinstate') await post(`/admin/users/${u.id}/reinstate`);
      else await post(`/admin/users/${u.id}/verify`);
      toast({ title: 'Done', body: `${u.name ?? u.phone} is now updated.`, tone: 'success' });
      setSuspending(null);
      setReason('');
      reload();
    } catch (err) {
      toast({ title: 'Could not do that', body: err.message, tone: 'danger' });
    } finally {
      setBusy(null);
    }
  }

  const term = q.trim().toLowerCase();
  const users = (data?.users ?? []).filter((u) => {
    if (!term) return true;
    const p = u.donor ?? u.ngo ?? u.volunteer;
    return [u.name, u.phone, p?.orgName, p?.address].filter(Boolean).some((v) => v.toLowerCase().includes(term));
  });

  return (
    <>
      <PageHeader title="Users" subtitle="Everyone on the platform, with verification and suspensions." />

      <div className="mb-3 space-y-2">
        <Input placeholder="Search by name, phone, organisation or area" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex gap-2">
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="flex-1">
            <option value="">All roles</option>
            {Object.entries(ROLE).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="flex-1">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="suspended">Suspended</option>
          </Select>
        </div>
      </div>

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : users.length === 0 ? (
        <Empty icon="🔍" title="No users match">Try another filter.</Empty>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {users.map((u) => {
            const p = u.donor ?? u.ngo ?? u.volunteer;
            return (
              <li key={u.id}>
                <Card className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{p?.orgName ?? u.name ?? 'No name'}</p>
                      <p className="text-sm text-slate-500">
                        {ROLE[u.role]} · {maskPhone(u.phone)}
                      </p>
                      <p className="text-xs text-slate-400">
                        Joined {fmtDate(u.createdAt)}
                        {u.donor && ` · ${DONOR_TYPE[u.donor.type]}`}
                        {u.ngo && ` · ${u.ngo.dailyCapacity} meals/day`}
                        {u.volunteer && ` · ${VEHICLE[u.volunteer.vehicle]} · ${u.volunteer.rating?.toFixed(1)} ★`}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[u.status]}>{u.status}</Badge>
                  </div>

                  {suspending === u.id ? (
                    <div className="space-y-2">
                      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for suspension" rows={2} />
                      <div className="flex gap-2">
                        <Button size="sm" variant="danger" loading={busy === u.id} disabled={reason.trim().length < 3} onClick={() => act(u, 'suspend')}>
                          Suspend
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setSuspending(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    u.role !== 'admin' && (
                      <div className="flex gap-2">
                        {u.status === 'pending' && p && (
                          <Button size="sm" loading={busy === u.id} onClick={() => act(u, 'verify')}>
                            Verify
                          </Button>
                        )}
                        {u.status === 'suspended' ? (
                          <Button size="sm" loading={busy === u.id} onClick={() => act(u, 'reinstate')}>
                            Reinstate
                          </Button>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => setSuspending(u.id)}>
                            Suspend
                          </Button>
                        )}
                      </div>
                    )
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
