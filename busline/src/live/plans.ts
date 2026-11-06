// Saved plans ("my trips"), recent routes, London time helpers, and service updates.
import { useEffect, useState } from 'react';
import type { Place } from '../store/store';

export interface PlanPoint { place: Place | null; stay: number } // place null = your location
export interface PlanSummary { minutes: number; routes: string[]; board?: { id: string; name: string; letter: string; line: string; walkSec: number } }
export interface SavedPlan {
  id: string; title: string; points: PlanPoint[]; optimise: boolean;
  when: { mode: 'leave' | 'arrive'; time: string; days: number[]; date?: string }; // days: 0 = Sun … 6 = Sat; empty = once on `date`
  remind: number; // minutes before leaving; 0 = off
  last?: PlanSummary;
  created: number;
}

const KEY = 'busline.plans.v1', RECENT = 'busline.recentRoutes.v1';
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

const listeners = new Set<() => void>();
export const loadPlans = (): SavedPlan[] => read<SavedPlan[]>(KEY, []);
export function savePlans(p: SavedPlan[]) { write(KEY, p); listeners.forEach((f) => f()); }
export function upsertPlan(p: SavedPlan) { const all = loadPlans().filter((x) => x.id !== p.id); savePlans([...all, p]); }
export function deletePlan(id: string) { savePlans(loadPlans().filter((x) => x.id !== id)); }
export function usePlans(): SavedPlan[] {
  const [p, setP] = useState(loadPlans);
  useEffect(() => { const f = () => setP(loadPlans()); listeners.add(f); window.addEventListener('storage', f); return () => { listeners.delete(f); window.removeEventListener('storage', f); }; }, []);
  return p;
}

export function pushRecentRoute(id: string) { write(RECENT, [id, ...read<string[]>(RECENT, []).filter((x) => x !== id)].slice(0, 8)); }
export const recentRoutes = () => read<string[]>(RECENT, []);

// ---------------------------------------------------------------- London time
const TZ = 'Europe/London';
function parts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
/** Epoch ms for a London wall-clock date and time (handles BST/GMT). */
export function londonEpoch(date: string, time: string): number {
  const [y, mo, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) { const p = parts(new Date(guess)); guess += (Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi)); }
  return guess;
}
export const londonDate = (t = Date.now()) => { const p = parts(new Date(t)); return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
export const londonTime = (t = Date.now()) => { const p = parts(new Date(t)); return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`; };
/** clock seconds after London midnight and weekday for an epoch */
export const londonClockAt = (t: number) => { const p = parts(new Date(t)); return { clock: p.h * 3600 + p.mi * 60 + p.s, day: p.wd }; };

/** The next time this plan happens (epoch ms of the leave/arrive time), or null if it's in the past. */
export function nextOccurrence(p: SavedPlan, now = Date.now()): number | null {
  if (!p.when.days.length) {
    if (!p.when.date) return null;
    const t = londonEpoch(p.when.date, p.when.time);
    return t > now - 30 * 60_000 ? t : null;
  }
  for (let k = 0; k < 8; k++) {
    const date = londonDate(now + k * 86_400_000);
    const t = londonEpoch(date, p.when.time);
    if (p.when.days.includes(londonClockAt(t).day) && t > now - 5 * 60_000) return t;
  }
  return null;
}

/** When you need to leave for the next occurrence (epoch ms). */
export function leaveTime(p: SavedPlan, now = Date.now()): number | null {
  const t = nextOccurrence(p, now);
  if (t === null) return null;
  return p.when.mode === 'leave' ? t : t - (p.last?.minutes ?? 30) * 60_000;
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function describeWhen(p: SavedPlan): string {
  const d = p.when.days;
  const days = !d.length ? (p.when.date ? new Date(londonEpoch(p.when.date, '12:00')).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }) : '')
    : d.length === 7 ? 'Every day' : d.join() === '1,2,3,4,5' ? 'Weekdays' : d.join() === '0,6' ? 'Weekends' : d.map((x) => DAY_NAMES[x]).join(', ');
  return `${p.when.mode === 'leave' ? 'Leave' : 'Arrive by'} ${p.when.time} · ${days}`;
}

export function countdown(ms: number): string {
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${h} h ${r} min` : `${h} h`;
  const days = Math.round(h / 24);
  return days === 1 ? 'tomorrow' : `${days} days`;
}

// ---------------------------------------------------------------- service updates
export interface Issue { line: string; status: string; kind: string | null; reason: string; from: string | null; to: string | null; now: boolean; stops: string[] }
let statusCache: { at: number; p: Promise<Issue[]> } | null = null;
export function loadIssues(): Promise<Issue[]> {
  if (!statusCache || Date.now() - statusCache.at > 120_000) {
    statusCache = { at: Date.now(), p: fetch('/api/status').then((r) => r.json()).then((d) => d.issues ?? []).catch(() => []) };
  }
  return statusCache.p;
}
/** Issues for these routes (current or upcoming), refreshed every 2 minutes. */
export function useIssues(lines: string[]): Issue[] {
  const [all, setAll] = useState<Issue[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => loadIssues().then((x) => live && setAll(x));
    load();
    const t = window.setInterval(load, 120_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  const want = new Set(lines);
  return all.filter((i) => want.has(i.line));
}
