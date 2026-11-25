'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth, useRequireRole } from '@/lib/auth';
import { useRealtime } from '@/lib/realtime';
import { Loading, Notice, cx } from './ui';
import Icon from './Icon';

const NAV = {
  donor: [
    { href: '/donor', label: 'Home', icon: 'home' },
    { href: '/donor/post', label: 'Post food', icon: 'plus' },
    { href: '/donor/impact', label: 'Impact', icon: 'chart' },
    { href: '/profile', label: 'Profile', icon: 'user' },
  ],
  ngo: [
    { href: '/ngo', label: 'Food nearby', icon: 'home' },
    { href: '/ngo/deliveries', label: 'Incoming', icon: 'truck' },
    { href: '/ngo/settings', label: 'Settings', icon: 'settings' },
    { href: '/profile', label: 'Profile', icon: 'user' },
  ],
  volunteer: [
    { href: '/volunteer', label: 'Tasks', icon: 'home' },
    { href: '/volunteer/history', label: 'History', icon: 'chart' },
    { href: '/volunteer/issues', label: 'On call', icon: 'alert' },
    { href: '/profile', label: 'Profile', icon: 'user' },
  ],
  admin: [
    { href: '/admin', label: 'Live', icon: 'map' },
    { href: '/admin/verifications', label: 'Verify', icon: 'check' },
    { href: '/admin/issues', label: 'Issues', icon: 'alert' },
    { href: '/admin/users', label: 'Users', icon: 'users' },
    { href: '/admin/stats', label: 'Stats', icon: 'chart' },
  ],
};

export default function AppShell({ roles, wide = false, children }) {
  const { user, profile, ready } = useRequireRole(...roles);
  if (!ready) return <Loading />;
  return (
    <Frame user={user} profile={profile} wide={wide}>
      {children}
    </Frame>
  );
}

function Frame({ user, profile, wide, children }) {
  const pathname = usePathname();
  const { unread, connected } = useRealtime();
  const { signOut } = useAuth();
  const items = NAV[user.role] ?? [];
  const active = (href) => (href === `/${user.role}` ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className={cx('mx-auto flex h-14 items-center gap-3 px-4', wide ? 'max-w-6xl' : 'max-w-2xl')}>
          <Link href={`/${user.role}`} className="flex items-center gap-2 font-bold text-brand-700">
            <img src="/icons/icon.svg" alt="" className="h-7 w-7" />
            <span>Food Rescue</span>
          </Link>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {user.role === 'admin' ? 'Admin' : profile?.orgName ?? user.name ?? 'Volunteer'}
          </span>
          <span className="flex-1" />
          <span title={connected ? 'Live updates on' : 'Reconnecting…'} className={cx('h-2 w-2 rounded-full', connected ? 'bg-brand-500' : 'bg-slate-300')} />
          <Link href="/notifications" aria-label="Notifications" className="relative rounded-full p-2 text-slate-700 hover:bg-slate-100">
            <Icon name="bell" />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </Link>
          <button type="button" onClick={signOut} className="hidden rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 sm:block">
            Log out
          </button>
        </div>
      </header>

      <main className={cx('mx-auto px-4 pt-4 pb-nav', wide ? 'max-w-6xl' : 'max-w-2xl')}>
        {user.status === 'pending' && user.role !== 'admin' && (
          <Notice className="mb-4" title="Waiting for verification">
            An admin is checking your documents. You can look around, but posting, claiming and delivering open once you are verified.
          </Notice>
        )}
        {children}
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white">
        <div className={cx('mx-auto grid', wide ? 'max-w-6xl' : 'max-w-2xl')} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className={cx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', active(it.href) ? 'text-brand-700' : 'text-slate-500')}
            >
              <Icon name={it.icon} />
              {it.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
