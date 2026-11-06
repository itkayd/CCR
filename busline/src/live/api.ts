import { useEffect, useRef, useState } from 'react';

export interface NearbyStop { id: string; name: string; letter: string; towards: string; lat: number; lon: number; lines: string[] }
export interface Arrival { stop: string; line: string; dir: string; dest: string; eta: number; at: string; vehicle: string }
export interface LatLon { lat: number; lon: number }

const REFRESH_MS = 30_000;

export function distM(a: LatLon, b: LatLon) {
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371000;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** Nearby stops for a position, refetched only when the user moves > 120 m. */
export function useNearby(pos: LatLon | null) {
  const [stops, setStops] = useState<NearbyStop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<LatLon | null>(null);
  useEffect(() => {
    if (!pos) return;
    if (last.current && distM(last.current, pos) < 120) return;
    last.current = pos;
    let live = true;
    getJSON<{ stops: NearbyStop[] }>(`/api/nearby?lat=${pos.lat}&lon=${pos.lon}`)
      .then((d) => { if (live) { setStops(d.stops); setError(null); } })
      .catch((e) => live && setError(String(e.message ?? e)));
    return () => { live = false; };
  }, [pos]);
  return { stops, error };
}

/** Live arrivals for a set of stops, refreshed every 30 s while `active` and the tab is visible. */
export function useArrivals(ids: string[], active: boolean) {
  const [arrivals, setArrivals] = useState<Arrival[] | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);
  const key = ids.join(',');
  useEffect(() => {
    if (!key || !active) return;
    let live = true, timer = 0;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      getJSON<{ arrivals: Arrival[] }>(`/api/arrivals?ids=${key}`)
        .then((d) => { if (live) { setArrivals(d.arrivals); setUpdated(new Date()); } })
        .catch(() => { /* keep last good data */ });
    };
    load();
    timer = window.setInterval(load, REFRESH_MS);
    const vis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', vis);
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', vis); };
  }, [key, active]);
  return { arrivals, updated };
}

export const DEFAULT_POS: LatLon = { lat: 51.50806, lon: -0.12806 }; // Trafalgar Square
const inLondon = (p: LatLon) => Math.abs(p.lat - 51.5) < 0.35 && Math.abs(p.lon + 0.12) < 0.55;

export type LocState = 'locating' | 'ok' | 'denied' | 'outside' | 'unsupported';

export function useLocation() {
  const [pos, setPos] = useState<LatLon | null>(null);
  const [state, setState] = useState<LocState>('locating');
  useEffect(() => {
    if (!('geolocation' in navigator)) { setState('unsupported'); setPos(DEFAULT_POS); return; }
    const fallback = window.setTimeout(() => setPos((p) => p ?? DEFAULT_POS), 6000);
    const id = navigator.geolocation.watchPosition(
      (g) => {
        const p = { lat: g.coords.latitude, lon: g.coords.longitude };
        if (inLondon(p)) { setPos(p); setState('ok'); } else { setPos(DEFAULT_POS); setState('outside'); }
      },
      () => { setState('denied'); setPos(DEFAULT_POS); },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 10_000 },
    );
    return () => { clearTimeout(fallback); navigator.geolocation.clearWatch(id); };
  }, []);
  return { pos, state };
}
