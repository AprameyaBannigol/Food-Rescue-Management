'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { homeFor, useAuth } from '@/lib/auth';
import { Loading } from '@/components/ui';

export default function Home() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading) router.replace(user ? homeFor(user, profile) : '/login');
  }, [loading, user, profile, router]);
  return <Loading />;
}
