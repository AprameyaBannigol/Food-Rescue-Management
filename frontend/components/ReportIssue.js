'use client';

// "Report a problem" form, shown on listing and delivery pages for every role.
import { useState } from 'react';
import { post } from '@/lib/api';
import { useToast } from '@/lib/realtime';
import { ISSUE_TYPE } from '@/lib/format';
import { Button, Card, Field, Select, Textarea } from './ui';

export default function ReportIssue({ listingId, deliveryId }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('other');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit() {
    setBusy(true);
    try {
      await post('/issues', { listingId, deliveryId, type, description: description.trim() });
      toast({ title: 'Reported', body: 'An admin will look into it.', tone: 'success' });
      setOpen(false);
      setDescription('');
    } catch (err) {
      toast({ title: 'Could not report', body: err.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <Button variant="ghost" block onClick={() => setOpen(true)}>
        Report a problem
      </Button>
    );

  return (
    <Card className="space-y-3">
      <p className="font-semibold text-slate-900">Report a problem</p>
      <Field label="What happened?">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {['food_quality', 'no_show', 'wrong_quantity', 'safety', 'other'].map((t) => (
            <option key={t} value={t}>
              {ISSUE_TYPE[t]}
            </option>
          ))}
        </Select>
      </Field>
      <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tell the admins what happened" />
      <div className="flex gap-2">
        <Button block loading={busy} disabled={description.trim().length < 3} onClick={submit}>
          Send to admins
        </Button>
        <Button variant="secondary" block onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
