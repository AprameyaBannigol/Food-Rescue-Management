'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import ProfileForm from '@/components/ProfileForm';
import { Loading, Notice, PageHeader } from '@/components/ui';

const INTRO = {
  donor: 'Tell us about your kitchen. An admin checks your FSSAI licence before your first post.',
  ngo: 'Tell us where you receive food and how much you can take. An admin checks your registration certificate.',
  volunteer: 'Tell us how you travel and upload an ID. An admin checks it before your first task.',
};

export default function OnboardingPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (user.role === 'admin') router.replace('/admin');
    else if (profile) router.replace(`/${user.role}`);
  }, [loading, user, profile, router]);

  if (loading || !user || user.role === 'admin' || profile) return <Loading />;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <PageHeader title="Set up your account" subtitle={INTRO[user.role]} />
      <Notice tone="blue" className="mb-4">
        Your documents are seen only by the project admins, for verification.
      </Notice>
      <ProfileForm submitLabel="Submit for verification" onSaved={() => router.replace(`/${user.role}`)} />
    </div>
  );
}
