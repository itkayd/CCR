// Step 3: real-world route geometry for the live map.
//   public/data/lines.json  GeoJSON: each route's outbound line cut into one piece per
//                           stop-to-stop interval, coloured by the major-station rule
//                           (blend between the major behind and the major ahead).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cleanName } from '../src/lib/names.ts';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachePath } from './lib/http.ts';
import { NEUTRAL, mix } from '../src/lib/colour.ts';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'data');
const read = (p: string) => JSON.parse(readFileSync(cachePath(p), 'utf8'));
const readOut = (f: string) => JSON.parse(readFileSync(join(OUT, f), 'utf8'));

type Pt = [number, number]; // lon, lat
const SIMPLIFY_DEG = 0.00004; // ≈ 3–4 m
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
    let worst = -1, wd = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > wd) { wd = d; worst = i; }
    }
    if (wd > tol) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function main() {
  const hubs: any[] = readOut('hubs.json');
  const routes: any[] = readOut('routes.json');
  const hubById = new Map(hubs.map((h) => [h.id, h]));
  const lines: any[] = read('/Line/Mode/bus');

  const stopPos = new Map<string, Pt>();

  const features: any[] = [];
  let vertices = 0;
  for (const l of lines) {
    const route = routes.find((r) => r.id === l.id.toUpperCase());
    if (!route) continue;
    const dir = read(`/Line/${l.id}/Route/Sequence/outbound`) ? 'outbound' : 'inbound';
    const seq = read(`/Line/${l.id}/Route/Sequence/${dir}`);
    for (const sps of seq.stopPointSequences ?? []) for (const p of sps.stopPoint ?? []) stopPos.set(p.id, [p.lon, p.lat]);

    // longest regular variant, as in build.ts
    const variants = (seq.orderedLineRoutes ?? []).filter((r: any) => !r.serviceType || r.serviceType === 'Regular');
    const ids: string[] = variants.reduce((a: any, b: any) => (b.naptanIds.length > a.naptanIds.length ? b : a)).naptanIds.filter((id: string) => stopPos.has(id));
    const strings: Pt[][] = (seq.lineStrings ?? []).map((s: string) => JSON.parse(s)[0] as Pt[]);
    if (!strings.length || ids.length < 2) continue;
    const line = strings.reduce((a, b) => (b.length > a.length ? b : a));

    // hub of each stop: nearest hub on the route's path that contains this stop's position
    const pathHubs = route.path.map((id: string) => hubById.get(id));
    // Colour at each hub on the path (blend between majors by index)
    const majorIdx = route.path.map((id: string, i: number) => (hubById.get(id)?.major ? i : -1)).filter((i: number) => i >= 0);
    const hubColour = route.path.map((_: string, i: number) => {
      if (!majorIdx.length) return NEUTRAL;
      let before = -1, after = -1;
      for (const m of majorIdx) { if (m <= i) before = m; if (m >= i && after < 0) after = m; }
      const cb = before >= 0 ? hubById.get(route.path[before]).colour : undefined;
      const ca = after >= 0 ? hubById.get(route.path[after]).colour : undefined;
      if (cb && ca) return before === after ? cb : mix(cb, ca, (i - before) / (after - before));
      return cb ?? ca;
    });
    // map each stop to its position on the path: walk forward, picking the nearest path hub
    let k = 0;
    const stopColour = ids.map((id) => {
      const [lon, lat] = stopPos.get(id)!;
      let best = k, bd = Infinity;
      for (let j = k; j < Math.min(pathHubs.length, k + 4); j++) {
        const h = pathHubs[j];
        const d = (h.lat - lat) ** 2 + ((h.lon - lon) * 0.62) ** 2;
        if (d < bd) { bd = d; best = j; }
      }
      k = best;
      return hubColour[best];
    });

    // nearest vertex on the line for each stop, moving forward only
    let v = 0;
    const cut = ids.map((id) => {
      const [lon, lat] = stopPos.get(id)!;
      let best = v, bd = Infinity;
      for (let j = v; j < line.length; j++) {
        const d = (line[j][0] - lon) ** 2 + (line[j][1] - lat) ** 2;
        if (d < bd) { bd = d; best = j; }
        if (d > bd * 400 && j - v > 50) break;
      }
      v = best;
      return best;
    });
    cut[0] = 0; cut[cut.length - 1] = line.length - 1;

    const coloured = route.via.length > 0;
    for (let s = 0; s < ids.length - 1; s++) {
      const a = cut[s], b = Math.max(cut[s + 1], a + 1);
      if (b >= line.length) break;
      const piece = simplify(line.slice(a, b + 1), SIMPLIFY_DEG).map(([x, y]) => [r5(x), r5(y)]);
      if (piece.length < 2) continue;
      vertices += piece.length;
      features.push({
        type: 'Feature',
        properties: { r: route.id, c: coloured ? mix(stopColour[s], stopColour[s + 1], 0.5) : NEUTRAL, m: coloured ? 1 : 0, n: route.night ? 1 : 0 },
        geometry: { type: 'LineString', coordinates: piece },
      });
    }
  }

  writeFileSync(join(OUT, 'lines.json'), JSON.stringify({ type: 'FeatureCollection', features }));
  console.log(`geometry: ${features.length} pieces, ${vertices} vertices`);
}

main();

// ---- per-route stop lists for the route screen: public/data/r/{ID}.json ----

function routeDetails() {
  const routes: any[] = readOut('routes.json');
  const sections: any[] = read('/Line/Mode/bus/Route?serviceTypes=Regular');
  const secById = new Map(sections.map((l) => [l.id.toUpperCase(), l.routeSections as any[]]));
  const dir = join(OUT, 'r');
  mkdirSync(dir, { recursive: true });
  let files = 0;
  for (const r of routes) {
    const dirs: any[] = [];
    for (const d of ['outbound', 'inbound']) {
      let seq: any;
      try { seq = read(`/Line/${r.id.toLowerCase()}/Route/Sequence/${d}`); } catch { continue; }
      if (!seq?.orderedLineRoutes?.length) continue;
      const info = new Map<string, any>();
      for (const sps of seq.stopPointSequences ?? []) for (const p of sps.stopPoint ?? []) info.set(p.id, p);
      const variants = seq.orderedLineRoutes.filter((v: any) => !v.serviceType || v.serviceType === 'Regular');
      const ids: string[] = variants.reduce((a: any, b: any) => (b.naptanIds.length > a.naptanIds.length ? b : a)).naptanIds.filter((id: string) => info.has(id));
      if (ids.length < 2) continue;
      const sec = (secById.get(r.id) ?? []).find((s) => s.direction === d);
      const stops = ids.map((id) => {
        const p = info.get(id);
        const letter = String(p.stopLetter ?? '').replace(/^->/, '→');
        return [id, cleanName(p.name), letter.length <= 3 ? letter : '', Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5];
      });
      dirs.push({ dir: d, to: cleanName(sec?.destinationName) || stops[stops.length - 1][1], stops });
    }
    if (!dirs.length) continue;
    writeFileSync(join(dir, `${r.id}.json`), JSON.stringify({ id: r.id, a: r.a, b: r.b, dirs }));
    files++;
  }
  console.log(`route details: ${files} files`);
}
routeDetails();
