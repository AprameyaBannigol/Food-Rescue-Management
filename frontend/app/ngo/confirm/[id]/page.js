'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { Stars } from '@/components/bits';
import { Button, Card, ErrorBox, Field, KeyValue, Loading, Notice, PageHeader, Textarea, cx } from '@/components/ui';
import { post } from '@/lib/api';
import { useData } from '@/lib/useData';
import { useToast } from '@/lib/realtime';
import { fmtTime } from '@/lib/format';

export default function ConfirmPage({ params }) {
  const { id } = use(params);
  return (
    <AppShell roles={['ngo']}>
      <Confirm id={id} />
    </AppShell>
  );
}

function Confirm({ id }) {
  const router = useRouter();
  const toast = useToast();
  const { data, error, loading } = useData(`/deliveries/${id}`);
  const [rating, setRating] = useState(5);
  const [foodOk, setFoodOk] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const d = data.delivery;

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      await post(`/deliveries/${id}/confirm`, { rating, foodOk, comment: comment.trim() || undefined });
      toast({ title: 'Thank you', body: 'The meals are now counted for everyone.', tone: 'success' });
      router.replace('/ngo/deliveries');
    } catch (e2) {
      setErr(e2);
      setBusy(false);
    }
  }

  if (d.status === 'confirmed') {
    return (
      <>
        <PageHeader title="Already confirmed" back="/ngo/deliveries" />
        <Notice tone="green">This delivery was confirmed at {fmtTime(d.confirmedAt)}.</Notice>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Confirm receipt" subtitle="Takes 10 seconds and keeps the donor honest." back="/ngo/deliveries" />
      <div className="space-y-3">
        <Card>
          <KeyValue
            items={[
              ['Food', d.listing.title],
              ['From', d.donor.orgName],
              ['Meals', d.servings],
              d.deliveredAt && ['Handed over', fmtTime(d.deliveredAt)],
            ]}
          />
          {d.listing.handling && <Notice tone="blue" className="mt-3">{d.listing.handling}</Notice>}
        </Card>

        <Card className="space-y-4">
          <Field label="Was the food in good condition?" group>
            <div className="grid grid-cols-2 gap-2">
              {[
                [true, '👍 Yes, all good'],
                [false, '👎 No, there was a problem'],
              ].map(([v, label]) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setFoodOk(v)}
                  className={cx(
                    'min-h-14 rounded-xl text-sm font-semibold ring-2 transition',
                    foodOk === v ? (v ? 'bg-brand-50 text-brand-800 ring-brand-500' : 'bg-red-50 text-red-800 ring-red-400') : 'bg-white text-slate-700 ring-slate-200',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Rate this delivery" group>
            <Stars value={rating} onChange={setRating} />
          </Field>

          <Field label={foodOk === false ? 'What was wrong?' : 'Anything to add? (optional)'}>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={foodOk === false ? 'Describe the problem for the admins' : 'A word of thanks, or a note for next time'} />
          </Field>

          {foodOk === false && (
            <Notice tone="red">
              This opens an issue for the admins. Two such reports about the same donor in 30 days pauses them until an admin reviews.
            </Notice>
          )}

          <ErrorBox error={err} />
          <Button block size="lg" loading={busy} disabled={foodOk === null} onClick={submit}>
            Confirm receipt
          </Button>
        </Card>
      </div>
    </>
  );
}
