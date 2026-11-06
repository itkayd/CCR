/// <reference lib="webworker" />
// Runs the planner off the main thread. Loads the network once, then answers plans.
import { Router, type Network, type Plan } from './raptor';

let router: Router | null = null;
let loading: Promise<Router> | null = null;
const load = () => (loading ??= fetch('/data/network.json').then((r) => r.json()).then((n: Network) => (router = new Router(n))));

export interface PlanRequest { id: number; from: { lat: number; lon: number; name?: string }; to: { lat: number; lon: number; name?: string }; clock: number }
export interface PlanResponse { id: number; plans?: Plan[]; stops?: { id: string[]; name: string[]; letter: string[]; lat: number[]; lon: number[] }; error?: string; ms?: number }

self.onmessage = async (e: MessageEvent<PlanRequest | { warm: true }>) => {
  if ('warm' in e.data) { load().catch(() => {}); return; }
  const { id, from, to, clock } = e.data;
  try {
    const r = router ?? (await load());
    const t0 = performance.now();
    const plans = r.options(from, to, { clock });
    // send only the stop details the plans use
    const used = new Set<number>();
    for (const p of plans) for (const l of p.legs) {
      if (l.mode === 'bus') l.stops.forEach((s) => used.add(s));
      else { if (l.from.stop !== undefined) used.add(l.from.stop); if (l.to.stop !== undefined) used.add(l.to.stop); }
    }
    const st = r.net.stops;
    const stops = { id: [] as string[], name: [] as string[], letter: [] as string[], lat: [] as number[], lon: [] as number[] };
    const remap = new Map<number, number>();
    for (const s of used) { remap.set(s, stops.id.length); stops.id.push(st.id[s]); stops.name.push(st.name[s]); stops.letter.push(st.letter[s]); stops.lat.push(st.lat[s]); stops.lon.push(st.lon[s]); }
    for (const p of plans) for (const l of p.legs) {
      if (l.mode === 'bus') { l.stops = l.stops.map((s) => remap.get(s)!); l.board = remap.get(l.board)!; l.alight = remap.get(l.alight)!; }
      else { if (l.from.stop !== undefined) l.from.stop = remap.get(l.from.stop); if (l.to.stop !== undefined) l.to.stop = remap.get(l.to.stop); }
    }
    (self as unknown as Worker).postMessage({ id, plans, stops, ms: Math.round(performance.now() - t0) } satisfies PlanResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error).message ?? err) } satisfies PlanResponse);
  }
};
