'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { get, post, setToken } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ user: null, profile: null, loading: true });

  const refresh = useCallback(async () => {
    try {
      const { user, profile } = await get('/auth/me');
      setState({ user, profile, loading: false });
      return { user, profile };
    } catch {
      setState({ user: null, profile: null, loading: false });
      return { user: null, profile: null };
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUnauthorized = () => setState((s) => (s.user ? { user: null, profile: null, loading: false } : s));
    window.addEventListener('fr:unauthorized', onUnauthorized);
    return () => window.removeEventListener('fr:unauthorized', onUnauthorized);
  }, [refresh]);

  const signIn = useCallback(
    async (token) => {
      setToken(token);
      return refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    try {
      await post('/auth/logout');
    } catch {
      // ignore: we clear the local session either way
    }
    setToken(null);
    setState({ user: null, profile: null, loading: false });
  }, []);

  const value = useMemo(() => ({ ...state, refresh, signIn, signOut }), [state, refresh, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

// Where each role lands after login.
export function homeFor(user, profile) {
  if (!user) return '/login';
  if (user.role === 'admin') return '/admin';
  if (!profile) return '/onboarding';
  return `/${user.role}`;
}

// Page guard: sends people to login, to onboarding, or to their own home.
export function useRequireRole(...roles) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const allowed = !loading && user && roles.includes(user.role) && (user.role === 'admin' || profile);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (user.role !== 'admin' && !profile) router.replace('/onboarding');
    else if (!roles.includes(user.role)) router.replace(homeFor(user, profile));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, profile, router]);

  return { user, profile, ready: Boolean(allowed) };
}
