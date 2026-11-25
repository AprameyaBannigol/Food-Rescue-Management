'use client';

// Leaflet + OpenStreetMap map (free, no API key).
// markers: [{ id, lat, lng, label, emoji, color }]
// lines:   [[{lat,lng},{lat,lng}], ...] drawn as dashed routes
// onPick:  if set, a tap on the map calls onPick({lat,lng})
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { HUBBALLI } from '@/lib/format';

export default function MapView({ markers = [], lines = [], onPick, height = 260, zoom = 13, fit = true, className = '' }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const L = useRef(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const fitted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    import('leaflet').then((mod) => {
      if (cancelled || map.current) return;
      L.current = mod.default ?? mod;
      const first = markers[0] ?? HUBBALLI;
      map.current = L.current.map(el.current, { zoomControl: true, attributionControl: true }).setView([first.lat, first.lng], zoom);
      L.current
        .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap',
        })
        .addTo(map.current);
      layer.current = L.current.layerGroup().addTo(map.current);
      map.current.on('click', (e) => pickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
      draw();
    });
    return () => {
      cancelled = true;
      // Leaflet throws if a pan or zoom animation runs after the container is gone,
      // so stop animations and drop listeners before removing the map.
      try {
        map.current?.stop();
        map.current?.off();
        map.current?.remove();
      } catch {
        // already torn down
      }
      map.current = null;
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(markers), JSON.stringify(lines)]);

  function draw() {
    if (!map.current || !L.current || !layer.current) return;
    try {
      drawInner();
    } catch {
      // the map was removed mid-render
    }
  }

  function drawInner() {
    const Lf = L.current;
    layer.current.clearLayers();
    const pts = [];
    for (const line of lines) {
      const ll = line.filter((p) => p && p.lat != null).map((p) => [p.lat, p.lng]);
      if (ll.length > 1) Lf.polyline(ll, { color: '#1a7d4e', weight: 4, opacity: 0.7, dashArray: '6 8' }).addTo(layer.current);
    }
    for (const m of markers) {
      if (m.lat == null || m.lng == null) continue;
      pts.push([m.lat, m.lng]);
      const icon = Lf.divIcon({
        className: '',
        html: `<div style="background:${m.color ?? '#1a7d4e'};width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff"><span style="transform:rotate(45deg);font-size:16px;line-height:1">${m.emoji ?? '📍'}</span></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 34],
        popupAnchor: [0, -30],
      });
      const mk = Lf.marker([m.lat, m.lng], { icon }).addTo(layer.current);
      if (m.label) mk.bindPopup(m.label);
      if (m.onClick) mk.on('click', m.onClick);
    }
    // Fit once (and again if a pick moves the only marker), so live updates don't keep zooming.
    if (fit && pts.length && (!fitted.current || onPick)) {
      if (pts.length === 1) map.current.setView(pts[0], Math.max(map.current.getZoom(), zoom));
      else map.current.fitBounds(pts, { padding: [36, 36], maxZoom: 15 });
      fitted.current = true;
    }
  }

  return <div ref={el} style={{ height }} className={`w-full overflow-hidden rounded-2xl ring-1 ring-slate-200 ${className}`} />;
}
