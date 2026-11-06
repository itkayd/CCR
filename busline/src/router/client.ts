// Main-thread side of the planner worker.
import type { TourRequest, TourResponse } from './worker';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: TourResponse) => void>();

function get() {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<TourResponse>) => { pending.get(e.data.id)?.(e.data); pending.delete(e.data.id); };
  }
  return worker;
}

/** Start downloading the network in the background (call when the user starts searching). */
export const warmPlanner = () => get().postMessage({ warm: true });

/** Plan start → stops → destination (two points = a simple journey). */
export function planTrip(points: TourRequest['points'], dwell: number[], optimise: boolean, clock: number, day: number, arriveBy = false): Promise<TourResponse> {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    get().postMessage({ id, points, dwell, optimise, clock, day, arriveBy } satisfies TourRequest);
  });
}
