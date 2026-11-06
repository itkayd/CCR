// Every stop's position, hub and marker colour (public/data/stops.json), loaded once.
export interface StopRec { id: string; lat: number; lon: number; hub: string; c: string }
let p: Promise<{ byId: Map<string, StopRec>; byHub: Map<string, StopRec[]> }> | null = null;
export function loadStopsDb() {
  return (p ??= fetch('/data/stops.json').then((r) => r.json()).then((rows: [string, number, number, string, string][]) => {
    const byId = new Map<string, StopRec>(), byHub = new Map<string, StopRec[]>();
    for (const [id, lat, lon, hub, c] of rows) {
      const s = { id, lat, lon, hub, c };
      byId.set(id, s);
      (byHub.get(hub) ?? byHub.set(hub, []).get(hub)!).push(s);
    }
    return { byId, byHub };
  }));
}

/** Which company runs each route (public/data/operators.json, from Wikipedia). */
let ops: Promise<Record<string, string>> | null = null;
export const loadOperators = () => (ops ??= fetch('/data/operators.json').then((r) => r.json()).then((d) => d.routes ?? {}).catch(() => ({})));
