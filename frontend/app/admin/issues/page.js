'use client';

import AppShell from '@/components/AppShell';
import IssueList from '@/components/IssueList';
import { Notice, PageHeader } from '@/components/ui';

export default function AdminIssuesPage() {
  return (
    <AppShell roles={['admin']} wide>
      <PageHeader title="Issues and escalations" subtitle="Reported problems plus anything the system could not match on its own." />
      <Notice tone="blue" className="mb-3">
        From 10 PM to 7 AM these also go to on-call volunteers, who can resolve them.
      </Notice>
      <IssueList />
    </AppShell>
  );
}
