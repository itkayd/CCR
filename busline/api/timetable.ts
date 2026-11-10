// GET /api/timetable?line=60&stop=490007670N&d=2026-11-06
// → today's scheduled departures from that stop (minutes after midnight, London time).
import { failStatus, json, tfl } from './_tfl.js';

interface Journey { hour: string; minute: string }
interface Schedule { name: string; knownJourneys: Journey[] }
interface Timetable { direction: string; timetable: { routes: { schedules: Schedule[] }[] } }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Pick the schedule for a given weekday. Term-time ("School …") is the usual case, so prefer it. */
export function pickSchedule(schedules: Schedule[], dow: number): Schedule | undefined {
  const day = DAYS[dow], short = SHORT[dow];
  const weekday = dow >= 1 && dow <= 5;
  const score = (n: string) => {
    const s = n.toLowerCase();
    let v = 0;
    if (s.includes(day.toLowerCase())) v += 10;
    if (dow >= 1 && dow <= 4 && /mon-th/.test(s)) v += 9;
    if (weekday && /(mon.{0,6}fri|monday to friday|weekday)/.test(s)) v += 8;
    if (new RegExp(`\\b${short.toLowerCase()}\\b`).test(s)) v += 6;
    if (!weekday && !s.includes(day.toLowerCase()) && /(sat|sun)/.test(s)) v -= 5;
    if (weekday && /(saturday|sunday)/.test(s)) v -= 20;
    if (/^school /.test(s)) v += 2; else if (/non-school/.test(s)) v += 1;
    return v;
  };
  return [...schedules].sort((a, b) => score(b.name) - score(a.name))[0];
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const line = (q.get('line') ?? '').toLowerCase(), stop = q.get('stop') ?? '';
  if (!/^[a-z]{0,3}\d{1,3}[a-z]?$/.test(line) || !/^[0-9A-Z]{6,16}$/i.test(stop)) return json({ error: 'line and stop required' }, 400);
  // weekday in London (the client passes its date so the edge cache splits by day)
  const now = new Date();
  const londonDow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' })).getDay();
  const d = q.get('d') ?? '';
  const dow = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? new Date(`${d}T12:00:00Z`).getUTCDay() : londonDow;
  try {
    const t = await tfl<Timetable>(`/Line/${line}/Timetable/${stop}`);
    const schedules = t.timetable?.routes?.flatMap((r) => r.schedules) ?? [];
    const s = pickSchedule(schedules, dow);
    const times = (s?.knownJourneys ?? []).map((j) => Number(j.hour) * 60 + Number(j.minute)).sort((a, b) => a - b);
    const res = json({ line: line.toUpperCase(), stop, schedule: s?.name ?? null, times });
    res.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
    return res;
  } catch (e) {
    return json({ error: String((e as Error).message), times: [] }, failStatus(e));
  }
}
