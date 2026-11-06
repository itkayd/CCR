/// <reference lib="webworker" />
// Runs the planner off the main thread. Loads the network once, then answers requests.
import { Router, planTour, type Network, type Plan, type Tour, type TourPoint } from './raptor';

let router: Router | null = null;
let loading: Promise<Router> | null = null;
const load = () => (loading ??= fetch('/data/network.json').then((r) => r.json()).then((n: Network) => (router = new Router(n))));

export interface TourRequest { id: number; points: TourPoint[]; dwell: number[]; optimise: boolean; clock: number }
export type StopTable = { id: string[]; name: string[]; letter: string[]; lat: number[]; lon: number[] };
export interface TourResponse { id: number; tour?: Tour; stops?: StopTable; error?: string; ms?: number }

/** Send only the stop details the plans use, renumbered. */
function compact(r: Router, plans: Plan[]): StopTable {
  const used = new Set<number>();
  for (const p of plans) for (const l of p.legs) {
    if (l.mode === 'bus') l.stops.forEach((s) => used.add(s));
    else { if (l.from.stop !== undefined) used.add(l.from.stop); if (l.to.stop !== undefined) used.add(l.to.stop); }
  }
  const st = r.net.stops;
  const out: StopTable = { id: [], name: [], letter: [], lat: [], lon: [] };
  const remap = new Map<number, number>();
  for (const s of used) { remap.set(s, out.id.length); out.id.push(st.id[s]); out.name.push(st.name[s]); out.letter.push(st.letter[s]); out.lat.push(st.lat[s]); out.lon.push(st.lon[s]); }
  for (const p of plans) for (const l of p.legs) {
    if (l.mode === 'bus') { l.stops = l.stops.map((s) => remap.get(s)!); l.board = remap.get(l.board)!; l.alight = remap.get(l.alight)!; }
    else { if (l.from.stop !== undefined) l.from.stop = remap.get(l.from.stop); if (l.to.stop !== undefined) l.to.stop = remap.get(l.to.stop); }
  }
  return out;
}

self.onmessage = async (e: MessageEvent<TourRequest | { warm: true }>) => {
  if ('warm' in e.data) { load().catch(() => {}); return; }
  const { id, points, dwell, optimise, clock } = e.data;
  try {
    const r = router ?? (await load());
    const t0 = performance.now();
    const tour = planTour(r, points, dwell, { clock, optimise });
    const stops = compact(r, tour.segments.flatMap((s) => s.plans));
    (self as unknown as Worker).postMessage({ id, tour, stops, ms: Math.round(performance.now() - t0) } satisfies TourResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error).message ?? err) } satisfies TourResponse);
  }
};
