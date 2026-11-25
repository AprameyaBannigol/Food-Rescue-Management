'use client';

// Socket.IO connection, the notifications inbox, and small toasts.
// The backend has no notifications table, so the inbox keeps what arrives
// over the socket in this browser (last 100 per user).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL, getToken } from './api';
import { useAuth } from './auth';

const RealtimeContext = createContext(null);
const MAX_ITEMS = 100;

const storageKey = (userId) => `fr_inbox_${userId}`;

function loadInbox(userId) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(userId))) ?? [];
  } catch {
    return [];
  }
}

function saveInbox(userId, items) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // storage full or blocked: the inbox just won't survive a reload
  }
}

export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [inbox, setInbox] = useState([]);
  const [toasts, setToasts] = useState([]);
  const userId = user?.id;
  const isAdmin = user?.role === 'admin';

  const pushToast = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-2), { id, ...toast }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  useEffect(() => {
    if (!userId) {
      setInbox([]);
      return undefined;
    }
    setInbox(loadInbox(userId));
    const s = io(API_URL, { auth: { token: getToken() }, withCredentials: true, transports: ['websocket', 'polling'] });
    setSocket(s);
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));

    const add = (n) => {
      const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, read: false, at: new Date().toISOString(), ...n };
      setInbox((prev) => {
        const next = [item, ...prev].slice(0, MAX_ITEMS);
        saveInbox(userId, next);
        return next;
      });
      pushToast({ title: n.title, body: n.body, tone: n.urgent || n.type === 'expired' ? 'danger' : 'info' });
      showSystemNotification(n);
    };
    s.on('notification', add);
    // Admins also get admin:alert, which duplicates the notification; skip it here.

    return () => {
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [userId, isAdmin, pushToast]);

  const markAllRead = useCallback(() => {
    setInbox((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      if (userId) saveInbox(userId, next);
      return next;
    });
  }, [userId]);

  const clearInbox = useCallback(() => {
    setInbox([]);
    if (userId) saveInbox(userId, []);
  }, [userId]);

  const value = useMemo(
    () => ({ socket, connected, inbox, unread: inbox.filter((n) => !n.read).length, markAllRead, clearInbox, pushToast }),
    [socket, connected, inbox, markAllRead, clearInbox, pushToast],
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-2 z-[1000] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto w-full max-w-md rounded-xl px-4 py-3 shadow-lg ring-1 ${
              t.tone === 'danger' ? 'bg-red-600 text-white ring-red-700' : t.tone === 'success' ? 'bg-brand-700 text-white ring-brand-800' : 'bg-slate-900 text-white ring-slate-800'
            }`}
          >
            <p className="text-sm font-semibold">{t.title}</p>
            {t.body && <p className="mt-0.5 text-sm opacity-90">{t.body}</p>}
          </div>
        ))}
      </div>
    </RealtimeContext.Provider>
  );
}

// Shows a system notification while the app is in the background, if the user allowed it.
function showSystemNotification(n) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
  navigator.serviceWorker?.ready
    .then((reg) => reg.showNotification(n.title, { body: n.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: n.type }))
    .catch(() => {});
}

export function useRealtime() {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used inside RealtimeProvider');
  return ctx;
}

export function useToast() {
  return useRealtime().pushToast;
}

// Subscribe to a socket event for the lifetime of a component.
export function useSocketEvent(event, handler) {
  const { socket } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return undefined;
    const fn = (...args) => ref.current(...args);
    socket.on(event, fn);
    return () => socket.off(event, fn);
  }, [socket, event]);
}

// Join a listing or delivery room (re-joins after a reconnect).
export function useSubscribe(kind, id) {
  const { socket } = useRealtime();
  useEffect(() => {
    if (!socket || !id) return undefined;
    const join = () => socket.emit(`subscribe:${kind}`, id, () => {});
    if (socket.connected) join();
    socket.on('connect', join);
    return () => socket.off('connect', join);
  }, [socket, kind, id]);
}
