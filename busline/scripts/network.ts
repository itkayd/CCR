// Step 5: the routable network for our own journey planner → public/data/network.json
//
//   stops:    parallel arrays (id, name, letter, lat, lon) for every stop on a route
//   patterns: one per route + direction: ordered stop indices, cumulative running
//             time in seconds, and the typical daytime headway in seconds
//
// Running times come from TfL timetables (stationIntervals) when fetched
// (scripts/fetch-timetables.ts), else from distance along the stops with a
// zone-based speed. Headways come from the timetable's departures.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachePath } from './lib/http.ts';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'data');

const CENTRE = { lat: 51.5073, lon: -0.1276 };
const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const k = Math.PI / 180, x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k), y = (b.lat - a.lat) * k;
  return Math.hypot(x, y) * 6371000;
};
/** Straight-line speed (m/s) and per-stop dwell, fitted to TfL timetable hops
 *  (least squares over ~3,700 stop-to-stop hops: centre, inner, outer London). */
const zoneOf = (p: { lat: number; lon: number }) => { const d = metres(p, CENTRE); return d < 4000 ? 0 : d < 9000 ? 1 : 2; };
const SPEED = [3.44, 4.13, 5.23];
const DWELL = [22, 15, 17];
const DEFAULT_HEADWAY_S = 12 * 60;

type StopRow = [string, string, string, number, number];
interface Detail { id: string; dirs: { dir: string; to: string; stops: StopRow[] }[] }

function readTimetable(route: string, first: string, dir: string): any | null {
  const f = cachePath(`/Line/${route.toLowerCase()}/Timetable/${first}?direction=${dir}`);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

/** Median gap between weekday departures 07:00–19:00 (or all day for night routes). */
function headway(tt: any, night: boolean): number | null {
  const scheds: any[] = tt?.timetable?.routes?.flatMap((r: any) => r.schedules) ?? [];
  if (!scheds.length) return null;
  const pick = scheds.find((s) => /school (mon|tue|wed|thu)/i.test(s.name)) ?? scheds.find((s) => /mon|weekday|friday/i.test(s.name)) ?? scheds[0];
  const mins = (pick.knownJourneys ?? []).map((j: any) => Number(j.hour) * 60 + Number(j.minute)).sort((a: number, b: number) => a - b);
  const window = night ? mins : mins.filter((m: number) => m >= 420 && m <= 1140);
  if (window.length < 3) return null;
  const gaps = window.slice(1).map((m: number, i: number) => m - window[i]).filter((g: number) => g > 0).sort((a: number, b: number) => a - b);
  if (!gaps.length) return null;
  return Math.min(60, Math.max(2, gaps[gaps.length >> 1])) * 60;
}

function main() {
  const files = readdirSync(join(OUT, 'r')).filter((f) => f.endsWith('.json'));
  const stopIndex = new Map<string, number>();
  const ids: string[] = [], names: string[] = [], letters: string[] = [], lat: number[] = [], lon: number[] = [];
  const addStop = ([id, name, letter, la, lo]: StopRow) => {
    let i = stopIndex.get(id);
    if (i === undefined) { i = ids.length; stopIndex.set(id, i); ids.push(id); names.push(name); letters.push(letter); lat.push(la); lon.push(lo); }
    return i;
  };

  const patterns: { r: string; d: string; to: string; n: 0 | 1; s: number[]; t: number[]; h: number; src: 'tt' | 'est' }[] = [];
  let fromTimetable = 0, estimated = 0, headwayKnown = 0;
  for (const f of files) {
    const det: Detail = JSON.parse(readFileSync(join(OUT, 'r', f), 'utf8'));
    if (/^6\d\d$/.test(det.id)) continue; // school routes: not for general journey planning
    const night = /^N\d/.test(det.id);
    for (const d of det.dirs) {
      const s = d.stops.map(addStop);
      const tt = readTimetable(det.id, d.stops[0][0], d.dir);
      // timetable minutes from the first stop, by stop id
      const known = new Map<string, number>();
      for (const set of tt?.timetable?.routes?.[0]?.stationIntervals ?? []) {
        for (const iv of set.intervals ?? []) if (!known.has(iv.stopId)) known.set(iv.stopId, Number(iv.timeToArrival) * 60);
        break; // first interval set = the main pattern
      }
      // estimate everything, then pin to timetable values where we have them (keeps order monotone)
      const est: number[] = [0];
      for (let i = 1; i < d.stops.length; i++) {
        const a = { lat: d.stops[i - 1][3], lon: d.stops[i - 1][4] }, b = { lat: d.stops[i][3], lon: d.stops[i][4] };
        const z = zoneOf(b);
        est.push(est[i - 1] + metres(a, b) / SPEED[z] + DWELL[z]);
      }
      let t = est;
      const pins = d.stops.map((x, i) => [i, known.get(x[0])] as const).filter(([, v]) => v !== undefined) as [number, number][];
      if (pins.length >= Math.max(3, d.stops.length * 0.5)) {
        // piecewise: between pinned stops scale the estimate to match the timetable
        t = est.slice();
        const anchors: [number, number][] = [[0, 0], ...pins.filter(([i]) => i > 0)];
        for (let a = 0; a < anchors.length; a++) {
          const [i0, v0] = anchors[a];
          const [i1, v1] = anchors[a + 1] ?? [d.stops.length - 1, v0 + (est[d.stops.length - 1] - est[i0])];
          const span = est[i1] - est[i0] || 1;
          for (let i = i0; i <= i1; i++) t[i] = v0 + ((est[i] - est[i0]) / span) * Math.max(0, v1 - v0);
        }
        for (let i = 1; i < t.length; i++) if (t[i] < t[i - 1]) t[i] = t[i - 1];
        fromTimetable++;
      } else estimated++;
      const h = headway(tt, night);
      if (h) headwayKnown++;
      patterns.push({ r: det.id, d: d.dir, to: d.to, n: night ? 1 : 0, s, t: t.map((x) => Math.round(x)), h: h ?? (night ? 30 * 60 : DEFAULT_HEADWAY_S), src: pins.length ? 'tt' : 'est' });
    }
  }
  const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
  const net = { generatedAt: new Date().toISOString(), stops: { id: ids, name: names, letter: letters, lat: lat.map(r5), lon: lon.map(r5) }, patterns };
  writeFileSync(join(OUT, 'network.json'), JSON.stringify(net));
  console.log(`network: ${ids.length} stops, ${patterns.length} patterns (${fromTimetable} timed from timetables, ${estimated} estimated), headways known for ${headwayKnown}`);
}

main();
