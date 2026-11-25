'use client';

import { useEffect } from 'react';
import { AuthProvider } from '@/lib/auth';
import { RealtimeProvider } from '@/lib/realtime';

export default function Providers({ children }) {
  useEffect(() => {
    // Register the service worker (installable PWA + offline fallback). Skipped in dev so hot reload isn't cached.
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return (
    <AuthProvider>
      <RealtimeProvider>{children}</RealtimeProvider>
    </AuthProvider>
  );
}
