// Main-thread side of the planner worker.
import type { PlanRequest, PlanResponse } from './worker';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: PlanResponse) => void>();

function get() {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<PlanResponse>) => { pending.get(e.data.id)?.(e.data); pending.delete(e.data.id); };
  }
  return worker;
}

/** Start downloading the network in the background (call when the user starts searching). */
export const warmPlanner = () => get().postMessage({ warm: true });

export function planJourney(from: PlanRequest['from'], to: PlanRequest['to'], clock: number): Promise<PlanResponse> {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    get().postMessage({ id, from, to, clock } satisfies PlanRequest);
  });
}
