import { NEUTRAL, mix } from './colour';

export interface Hub {
  id: string; name: string; lat: number; lon: number; x: number; y: number;
  major: boolean; colour?: string; area?: string; rail?: string[]; routes: string[];
}
export interface Route {
  id: string; night: boolean; school: boolean; a: string; b: string;
  path: string[]; via: string[]; inboundOnly: string[];
}
export interface Meta { generatedAt: string; source: string; routeCount: number; hubCount: number; majorCount: number }

export interface Data {
  hubs: Map<string, Hub>;
  routes: Map<string, Route>;
  meta: Meta;
}

export async function loadData(): Promise<Data> {
  const [hubs, routes, meta] = await Promise.all(
    ['hubs', 'routes', 'meta'].map((f) => fetch(`/data/${f}.json`).then((r) => r.json())),
  );
  return {
    hubs: new Map((hubs as Hub[]).map((h) => [h.id, h])),
    routes: new Map((routes as Route[]).map((r) => [r.id, r])),
    meta,
  };
}

/** Colour of a route at each hub on its path (spec §4.3): blend between the
 *  nearest major behind and ahead, by position along the path. */
export function pathColours(route: Route, hubs: Map<string, Hub>): string[] {
  const p = route.path;
  const majorIdx = p.map((id, i) => (hubs.get(id)?.major ? i : -1)).filter((i) => i >= 0);
  if (!majorIdx.length) return p.map(() => NEUTRAL);
  return p.map((_, i) => {
    let before = -1, after = -1;
    for (const m of majorIdx) { if (m <= i) before = m; if (m >= i && after < 0) after = m; }
    const cb = before >= 0 ? hubs.get(p[before])!.colour! : undefined;
    const ca = after >= 0 ? hubs.get(p[after])!.colour! : undefined;
    if (cb && ca) return before === after ? cb : mix(cb, ca, (i - before) / (after - before));
    return (cb ?? ca)!;
  });
}

/** Colour of a route at a given hub (for badges at minor stops). */
export function colourAt(route: Route, hubId: string, hubs: Map<string, Hub>): string {
  const h = hubs.get(hubId);
  if (h?.major) return h.colour!;
  const i = route.path.indexOf(hubId);
  const cols = pathColours(route, hubs);
  return i >= 0 ? cols[i] : (route.via[0] ? hubs.get(route.via[0])!.colour! : NEUTRAL);
}

export function routeSort(a: string, b: string) {
  const pa = a.match(/^([A-Z]*)(\d*)(.*)$/)!, pb = b.match(/^([A-Z]*)(\d*)(.*)$/)!;
  return pa[1].localeCompare(pb[1]) || (Number(pa[2]) || 0) - (Number(pb[2]) || 0) || pa[3].localeCompare(pb[3]);
}
