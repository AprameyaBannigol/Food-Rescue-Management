'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api';

// Loads an API path, with reload() and optional polling (ms) as a backstop for missed socket events.
export function useData(path, { poll, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(path && enabled));
  const ctrl = useRef(null);

  const reload = useCallback(async () => {
    if (!path || !enabled) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    try {
      const d = await get(path, { signal: c.signal });
      setData(d);
      setError(null);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err);
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, [path, enabled]);

  useEffect(() => {
    setLoading(Boolean(path && enabled));
    reload();
    return () => ctrl.current?.abort();
  }, [reload, path, enabled]);

  useEffect(() => {
    if (!poll || !enabled) return undefined;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, poll);
    return () => clearInterval(t);
  }, [poll, reload, enabled]);

  return { data, error, loading, reload, setData };
}

// Re-renders every `ms` so countdowns stay current.
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
