'use client';

// Issues and escalations. Admins handle them all day; on-call volunteers can
// see and resolve them between 10 PM and 7 AM, which is what the API allows.
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useSocketEvent, useToast } from '@/lib/realtime';
import { ISSUE_TYPE, timeAgo } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Loading, Segmented } from './ui';

const TONE = { open: 'red', in_progress: 'amber', resolved: 'green' };

export default function IssueList({ canHandle = true }) {
  const [status, setStatus] = useState('open');
  const { data, error, loading, reload } = useData(`/issues?status=${status}`, { poll: 60000 });
  useSocketEvent('issue:new', reload);
  useSocketEvent('admin:alert', reload);
  const toast = useToast();
  const [busy, setBusy] = useState(null);

  async function update(id, next) {
    setBusy(id);
    try {
      await api(`/issues/${id}`, { method: 'PATCH', body: { status: next } });
      toast({ title: next === 'resolved' ? 'Issue resolved' : 'Marked in progress', tone: 'success' });
      reload();
    } catch (err) {
      toast({ title: 'Could not update', body: err.message, tone: 'danger' });
    } finally {
      setBusy(null);
    }
  }

  const issues = data?.issues ?? [];

  return (
    <>
      <div className="mb-3">
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'in_progress', label: 'In progress' },
            { value: 'resolved', label: 'Resolved' },
          ]}
        />
      </div>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : issues.length === 0 ? (
        <Empty icon="✅" title={`No ${status.replace('_', ' ')} issues`}>Escalations and reported problems show up here.</Empty>
      ) : (
        <ul className="space-y-3">
          {issues.map((i) => (
            <li key={i.id}>
              <Card className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900">{ISSUE_TYPE[i.type] ?? i.type}</p>
                    <p className="text-xs text-slate-500">
                      {timeAgo(i.createdAt)}
                      {i.raisedBy ? ` · ${i.raisedBy.name ?? i.raisedBy.role}` : ' · raised by the system'}
                    </p>
                  </div>
                  <Badge tone={TONE[i.status]}>{i.status.replace('_', ' ')}</Badge>
                </div>

                {i.description && <p className="text-sm text-slate-700">{i.description}</p>}

                {i.listing && (
                  <Link href={`/listing/${i.listing.id}`} className="block rounded-xl bg-slate-50 p-2.5 text-sm">
                    <span className="block font-semibold text-slate-900">{i.listing.title}</span>
                    <span className="block text-xs text-slate-500">
                      {i.listing.donor?.orgName} · {i.listing.status.replace(/_/g, ' ')}
                    </span>
                  </Link>
                )}
                {i.deliveryId && (
                  <Link href={`/delivery/${i.deliveryId}`} className="block text-sm font-semibold text-brand-700">
                    Open the delivery
                  </Link>
                )}

                {canHandle && i.status !== 'resolved' && (
                  <div className="flex gap-2 pt-1">
                    {i.status === 'open' && (
                      <Button size="sm" variant="secondary" loading={busy === i.id} onClick={() => update(i.id, 'in_progress')}>
                        I am on it
                      </Button>
                    )}
                    <Button size="sm" loading={busy === i.id} onClick={() => update(i.id, 'resolved')}>
                      Mark resolved
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
