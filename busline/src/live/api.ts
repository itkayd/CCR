import { useEffect, useRef, useState } from 'react';

export interface NearbyStop { id: string; name: string; letter: string; towards: string; lat: number; lon: number; lines: string[] }
export interface Arrival { stop: string; line: string; dir: string; dest: string; eta: number; at: string; vehicle: string }
export interface LatLon { lat: number; lon: number }

const REFRESH_MS = 30_000;

export function distM(a: LatLon, b: LatLon) {
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371000;
}

/** fetch with a timeout and one retry: a stalled mobile request must never hang the UI */
async function getJSON<T>(url: string, tries = 2): Promise<T> {
  for (let i = 0; ; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12_000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error(`server said ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i + 1 >= tries) throw new Error((e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message);
      await new Promise((r) => setTimeout(r, 1200));
    } finally {
      clearTimeout(t);
    }
  }
}

/** Nearby stops for a position, refetched only when the user moves > 120 m. */
export function useNearby(pos: LatLon | null) {
  const [stops, setStops] = useState<NearbyStop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const last = useRef<LatLon | null>(null);
  const lastAttempt = useRef(0);
  useEffect(() => {
    if (!pos) return;
    if (last.current && distM(last.current, pos) < 120 && lastAttempt.current === attempt) return;
    last.current = pos;
    lastAttempt.current = attempt;
    setError(null);
    let live = true;
    getJSON<{ stops: NearbyStop[] }>(`/api/nearby?lat=${pos.lat}&lon=${pos.lon}`)
      .then((d) => { if (live) { setStops(d.stops); setError(null); } })
      .catch((e) => live && setError(String(e.message ?? e)));
    return () => { live = false; };
  }, [pos, attempt]);
  return { stops, error, retry: () => setAttempt((n) => n + 1) };
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

export type LocState = 'locating' | 'slow' | 'ok' | 'denied' | 'outside' | 'unsupported';

export function useLocation() {
  const [pos, setPos] = useState<LatLon | null>(null);
  const [state, setState] = useState<LocState>('locating');
  useEffect(() => {
    if (!('geolocation' in navigator)) { setState('unsupported'); setPos(DEFAULT_POS); return; }
    let gotFix = false;
    // never leave the user staring at a spinner: show Trafalgar Square after 6 s, then move when a fix arrives
    const fallback = window.setTimeout(() => { if (!gotFix) { setPos((p) => p ?? DEFAULT_POS); setState((s) => (s === 'locating' ? 'slow' : s)); } }, 6000);
    const onFix = (g: GeolocationPosition) => {
      gotFix = true;
      const p = { lat: g.coords.latitude, lon: g.coords.longitude };
      if (inLondon(p)) { setPos(p); setState('ok'); } else { setPos(DEFAULT_POS); setState('outside'); }
    };
    const onErr = (e: GeolocationPositionError) => {
      if (gotFix) return; // keep the last good fix
      setPos((p) => p ?? DEFAULT_POS);
      setState(e.code === 1 ? 'denied' : 'slow');
    };
    // quick, coarse fix first (iPhones can take a long time for a high-accuracy first fix) …
    navigator.geolocation.getCurrentPosition(onFix, onErr, { enableHighAccuracy: false, maximumAge: 120_000, timeout: 8_000 });
    // … then keep refining
    const id = navigator.geolocation.watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 });
    return () => { clearTimeout(fallback); navigator.geolocation.clearWatch(id); };
  }, []);
  return { pos, state };
}
