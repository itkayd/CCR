// Step 2: turn the cached TfL responses into hubs.json / routes.json / meta.json.
//   - stops → hubs (TfL HUB ids, shared ICS codes, rail-station links, same-name clusters within 250 m)
//   - routes → ordered hub paths
//   - choose major stations, assign area colours, check neighbour colour distance
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachePath } from './lib/http.ts';
import { RAIL_MODES } from './fetch.ts';
import { assignColours } from './lib/palette.ts';
import { distM, project } from './lib/geo.ts';
import { MIN_SEP, PHONE_WIDTH_PX, minMajorSep, spreadMajors } from './lib/spread.ts';
import { cleanName } from '../src/lib/names.ts';
import { formatModes } from '../src/lib/modes.ts';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'data');

// ---- thresholds (spec §3.3) ----
const MAJOR_RAIL_MIN = 10; // spec suggested 8; 10 lands in the 80–120 target
const MAJOR_ANY_MIN = 20; // spec suggested 15
const CLUSTER_M = 250;
const TOWN_NAME_M = 450; // rail hub absorbs groups named after it within this distance
const TOWN_MIN_ROUTES = 8; // only busy groups take part in town-centre merging
const TOWN_M = 500;      // busy bus-only groups merge into the strongest busy group within this distance

const PARTIAL = process.env.PARTIAL === '1'; // dev only: build from an incomplete cache
const read = (path: string) => {
  const f = cachePath(path);
  if (!existsSync(f) && PARTIAL) return null;
  if (!existsSync(f)) throw new Error(`missing cache for ${path}; run npm run data:fetch`);
  return JSON.parse(readFileSync(f, 'utf8'));
};

// ---------------------------------------------------------------- types
interface Stop { id: string; name: string; lat: number; lon: number; ics: string; area: string }
interface RailStation { name: string; lat: number; lon: number; ics: string; top: string; modes: Set<string>; zone?: number }

// ---------------------------------------------------------------- names
const STATION_WORDS = /\b(bus station|underground station|rail station|dlr station|overground station|tram stop|station|stn|interchange)\b/g;

/** "Stratford Stn / Great Eastern Rd" → "stratford" */
export function stem(name: string): string {
  return name
    .toLowerCase()
    .split('/')[0]
    .replace(/\(.*?\)/g, '')
    .replace(/&/g, 'and')
    .replace(STATION_WORDS, '')
    .replace(/['’.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function railDisplayName(name: string) {
  return cleanName(name)
    .replace(/\(.*?\)/g, '')
    .replace(/\b(Underground|Rail|DLR|Overground|Tram|Elizabeth line) Station\b/gi, '')
    .replace(/\bStation\b|\bTram Stop\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}


// ---------------------------------------------------------------- union-find
class UF {
  p = new Map<string, string>();
  find(x: string): string {
    if (!this.p.has(x)) this.p.set(x, x);
    let r = x;
    while (this.p.get(r) !== r) r = this.p.get(r)!;
    let c = x;
    while (c !== r) { const n = this.p.get(c)!; this.p.set(c, r); c = n; }
    return r;
  }
  union(a: string, b: string) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(rb, ra); }
}

// ---------------------------------------------------------------- main
function main() {
  const lines: any[] = read('/Line/Mode/bus');
  const sections: any[] = read('/Line/Mode/bus/Route?serviceTypes=Regular');
  const sectionById = new Map(sections.map((l) => [l.id, l.routeSections as any[]]));

  // ---- rail stations
  const railLines: any[] = read(`/Line/Mode/${RAIL_MODES.join(',')}`);
  const rail: RailStation[] = [];
  const railByIcs = new Map<string, RailStation>();
  const railByTop = new Map<string, RailStation>();
  for (const l of railLines) {
    const seq = read(`/Line/${l.id}/Route/Sequence/outbound`);
    for (const s of seq?.stations ?? []) {
      const key = s.icsId || s.id;
      let r = railByIcs.get(key);
      if (!r) {
        r = { name: cleanName(railDisplayName(s.name)), lat: s.lat, lon: s.lon, ics: s.icsId, top: s.topMostParentId, modes: new Set() };
        railByIcs.set(key, r);
        rail.push(r);
      }
      for (const m of s.modes ?? []) if (m !== 'bus') r.modes.add(m);
      const z = Math.min(...String(s.zone ?? '').split(/[^0-9]+/).filter(Boolean).map(Number));
      if (Number.isFinite(z)) r.zone = Math.min(r.zone ?? 99, z);
      if (s.topMostParentId?.startsWith('HUB')) railByTop.set(s.topMostParentId, r);
    }
  }

  // ---- bus stops and route sequences
  const stops = new Map<string, Stop>();
  type Dir = { seqs: string[][]; stops: string[] };
  const raw = new Map<string, { out?: Dir; inb?: Dir }>();
  if (PARTIAL) lines.splice(0, lines.length, ...lines.filter((l) => existsSync(cachePath(`/Line/${l.id}/Route/Sequence/inbound`))));
  for (const l of lines) {
    const entry: { out?: Dir; inb?: Dir } = {};
    for (const [dir, key] of [['outbound', 'out'], ['inbound', 'inb']] as const) {
      const seq = read(`/Line/${l.id}/Route/Sequence/${dir}`);
      if (!seq) continue;
      for (const sps of seq.stopPointSequences ?? [])
        for (const p of sps.stopPoint ?? [])
          if (!stops.has(p.id))
            stops.set(p.id, { id: p.id, name: cleanName(p.name), lat: p.lat, lon: p.lon, ics: p.icsId, area: p.topMostParentId || p.id });
      const seqs = (seq.orderedLineRoutes ?? [])
        .filter((r: any) => !r.serviceType || r.serviceType === 'Regular')
        .map((r: any) => (r.naptanIds as string[]).filter((id) => stops.has(id)));
      const all = new Set<string>();
      for (const s of seqs) for (const id of s) all.add(id);
      if (seqs.length) entry[key] = { seqs, stops: [...all] };
    }
    raw.set(l.id, entry);
  }

  // ---- hubs: union stop areas
  const uf = new UF();
  for (const s of stops.values()) uf.union(s.area, `stop:${s.id}`);
  // stops sharing an ICS code are one place
  const icsFirst = new Map<string, string>();
  for (const s of stops.values()) {
    if (!s.ics) continue;
    const f = icsFirst.get(s.ics);
    if (f) uf.union(f, s.area); else icsFirst.set(s.ics, s.area);
  }
  // link stop areas to rail stations: HUB id, ICS code, or same name stem within 250 m
  const railOf = new Map<string, RailStation>(); // area root → rail
  const railKey = (r: RailStation) => `rail:${r.ics || r.name}`;
  for (const s of stops.values()) {
    let r = railByTop.get(s.area) ?? (s.ics ? railByIcs.get(s.ics) : undefined);
    if (!r) {
      const st = stem(s.name);
      for (const c of rail) {
        if (Math.abs(c.lat - s.lat) > 0.004) continue;
        const cs = stem(c.name);
        if (cs && (st === cs || st.startsWith(cs + ' ')) && distM(s, c) <= CLUSTER_M) { r = c; break; }
      }
    }
    if (r) uf.union(railKey(r), s.area);
  }
  // remaining: same stem within 250 m (grid-bucketed)
  const areaPts = new Map<string, { lat: number; lon: number; stems: Set<string> }>();
  for (const s of stops.values()) {
    const a = areaPts.get(s.area) ?? { lat: 0, lon: 0, stems: new Set<string>(), n: 0 } as any;
    a.lat += s.lat; a.lon += s.lon; a.n++; a.stems.add(stem(s.name));
    areaPts.set(s.area, a);
  }
  const bucket = new Map<string, string[]>();
  const bk = (lat: number, lon: number) => `${Math.floor(lat / 0.0025)},${Math.floor(lon / 0.004)}`;
  for (const [id, a] of areaPts as any) {
    a.lat /= a.n; a.lon /= a.n;
    const k = bk(a.lat, a.lon);
    (bucket.get(k) ?? bucket.set(k, []).get(k)!).push(id);
  }
  for (const [id, a] of areaPts) {
    const [bi, bj] = bk(a.lat, a.lon).split(',').map(Number);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const other of bucket.get(`${bi + di},${bj + dj}`) ?? []) {
        if (other <= id) continue;
        const b = areaPts.get(other)!;
        if (distM(a, b) > CLUSTER_M) continue;
        if ([...a.stems].some((x) => x.length > 2 && b.stems.has(x))) uf.union(id, other);
      }
    }
  }

  // ---- town centres
  // A passenger thinks of "Romford" or "Kingston" as one place even when the bus
  // stops are spread over several streets. Two passes:
  //   1. rail hubs absorb nearby groups named after them ("Lewisham Centre", "Stratford Centre"),
  //      and rail hubs whose names contain each other merge ("King's Cross & St Pancras" / "St Pancras").
  //   2. busy bus-only groups merge into the strongest busy group within TOWN_M.
  const stopRoutes = new Map<string, Set<string>>();
  for (const [rid, e] of raw)
    if (!/^6\d\d$/.test(rid))
      for (const d of [e.out, e.inb]) for (const s of d?.stops ?? []) (stopRoutes.get(s) ?? stopRoutes.set(s, new Set()).get(s)!).add(rid);

  interface Group { root: string; lat: number; lon: number; n: number; routes: Set<string>; stems: Set<string>; rail?: RailStation }
  const groups = () => {
    const g = new Map<string, Group>();
    for (const s of stops.values()) {
      const root = uf.find(s.area);
      const x = g.get(root) ?? g.set(root, { root, lat: 0, lon: 0, n: 0, routes: new Set(), stems: new Set() }).get(root)!;
      x.lat += s.lat; x.lon += s.lon; x.n++; x.stems.add(stem(s.name));
      for (const r of stopRoutes.get(s.id) ?? []) x.routes.add(r);
    }
    for (const x of g.values()) { x.lat /= x.n; x.lon /= x.n; }
    for (const r of rail) if (uf.p.has(railKey(r))) { const x = g.get(uf.find(railKey(r))); if (x) x.rail ??= r; }
    return [...g.values()];
  };
  const within = (a: string, b: string) => a === b || b.startsWith(a + ' ') || b.includes(' ' + a + ' ') || b.endsWith(' ' + a);

  let gs = groups();
  const railGroups = gs.filter((g) => g.rail);
  for (const r of railGroups) {
    const rs = stem(r.rail!.name);
    if (rs.length < 3) continue;
    for (const o of gs) {
      if (o === r || Math.abs(o.lat - r.lat) > 0.005 || distM(o, r) > TOWN_NAME_M) continue;
      const os = o.rail ? [stem(o.rail.name)] : [...o.stems];
      if (os.some((s) => within(rs, s) || (o.rail && within(s, rs)))) uf.union(r.root, o.root);
    }
  }

  gs = groups().filter((g) => g.routes.size >= TOWN_MIN_ROUTES);
  gs.sort((a, b) => Number(!!b.rail) - Number(!!a.rail) || b.routes.size - a.routes.size);
  const claimed = new Set<string>();
  for (const g of gs) {
    if (claimed.has(g.root)) continue;
    claimed.add(g.root);
    for (const o of gs) {
      if (claimed.has(o.root) || o.rail) continue;
      if (distM(g, o) <= TOWN_M) { uf.union(g.root, o.root); claimed.add(o.root); }
    }
  }

  // ---- collect hubs
  const hubStops = new Map<string, Stop[]>();
  for (const s of stops.values()) {
    const root = uf.find(s.area);
    (hubStops.get(root) ?? hubStops.set(root, []).get(root)!).push(s);
  }
  const rootRail = new Map<string, RailStation>();
  for (const r of rail) if (uf.p.has(railKey(r))) rootRail.set(uf.find(railKey(r)), r);

  interface Hub { id: string; name: string; lat: number; lon: number; rail: string[]; zone?: number; stops: string[]; routes: Set<string> }
  const hubs = new Map<string, Hub>();
  const stopHub = new Map<string, string>();
  const usedIds = new Set<string>();
  for (const [root, ss] of hubStops) {
    const r = rootRail.get(root);
    let name: string;
    if (r) name = r.name;
    else {
      const counts = new Map<string, number>();
      for (const s of ss) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
      name = [...counts].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    }
    const lat = ss.reduce((t, s) => t + s.lat, 0) / ss.length;
    const lon = ss.reduce((t, s) => t + s.lon, 0) / ss.length;
    // readable, stable ids: slug of the name, disambiguated by area
    let id = slug(name);
    if (usedIds.has(id)) id = `${id}-${ss.map((s) => s.area).sort()[0].slice(-6).toLowerCase()}`;
    usedIds.add(id);
    hubs.set(id, { id, name, lat, lon, rail: r ? [...r.modes].sort() : [], zone: r?.zone, stops: ss.map((s) => s.id), routes: new Set() });
    for (const s of ss) stopHub.set(s.id, id);
  }

  // ---- routes
  interface Route { id: string; night: boolean; school: boolean; a: string; b: string; path: string[]; inboundOnly: string[] }
  const routes: Route[] = [];
  const toHubs = (seq: string[]) => {
    const out: string[] = [];
    for (const s of seq) {
      const h = stopHub.get(s)!;
      if (out[out.length - 1] === h) continue;
      // A → x → A: a short excursion out of a merged hub and back; drop it.
      if (out[out.length - 2] === h) { out.pop(); continue; }
      out.push(h);
    }
    return out;
  };
  for (const l of lines) {
    const e = raw.get(l.id)!;
    const canon = e.out ?? e.inb;
    if (!canon) { console.warn(`  route ${l.id}: no sequence, skipped`); continue; }
    const longest = canon.seqs.reduce((a, b) => (b.length > a.length ? b : a));
    const path = toHubs(longest);
    const pathSet = new Set(path);
    const allHubs = new Set<string>();
    for (const d of [e.out, e.inb]) for (const s of d?.stops ?? []) allHubs.add(stopHub.get(s)!);
    for (const h of allHubs) hubs.get(h)!.routes.add(l.id);
    const inboundOnly = [...new Set((e.inb?.stops ?? []).map((s) => stopHub.get(s)!))].filter((h) => !pathSet.has(h));

    const secs = (sectionById.get(l.id) ?? []).filter((s) => s.direction === (e.out ? 'outbound' : 'inbound'));
    const sec = secs[0];
    const first = stops.get(longest[0])!.name, last = stops.get(longest[longest.length - 1])!.name;
    routes.push({
      id: l.id.toUpperCase(),
      night: /^n\d/i.test(l.id),
      school: /^6\d\d$/.test(l.id),
      a: cleanName(sec?.originationName) || first,
      b: cleanName(sec?.destinationName) || last,
      path,
      inboundOnly,
    });
  }
  const routeById = new Map(routes.map((r) => [r.id, r]));

  // ---- majors
  const override = loadOverride();
  const countable = (h: Hub) => [...h.routes].filter((r) => !routeById.get(r.toUpperCase())?.school).length;
  const majors: Hub[] = [];
  for (const h of hubs.values()) {
    const n = countable(h);
    let major = (h.rail.length > 0 && n >= MAJOR_RAIL_MIN) || n >= MAJOR_ANY_MIN;
    if (override.add.includes(h.id)) major = true;
    if (override.remove.includes(h.id)) major = false;
    if (major) majors.push(h);
  }
  for (const id of [...override.add, ...override.remove])
    if (!hubs.has(id)) console.warn(`  override: unknown hub id "${id}"`);

  // ---- colours
  const centre = { lat: 51.5073, lon: -0.1276 }; // Charing Cross
  // previous colours, for the before/after report
  const prevFile = process.env.PREV_HUBS || join(OUT, 'hubs.json');
  const prev = new Map<string, string>();
  if (existsSync(prevFile)) for (const h of JSON.parse(readFileSync(prevFile, 'utf8'))) if (h.colour) prev.set(h.id, h.colour);
  const colourResult = assignColours(
    majors.map((h) => ({ id: h.id, lat: h.lat, lon: h.lon, zone1: h.zone === 1 || (h.zone === undefined && distM(h, centre) < 2500) })),
    centre,
    override.colours,
  );

  // ---- output
  mkdirSync(OUT, { recursive: true });
  const majorSet = new Set(majors.map((h) => h.id));
  const usedHubs = new Set(routes.flatMap((r) => [...r.path, ...r.inboundOnly]));
  const placed = [...hubs.values()].filter((h) => usedHubs.has(h.id));
  const xy = spreadMajors(placed.map((h) => {
    const [x, y] = project(h.lat, h.lon);
    return { id: h.id, x, y, major: majorSet.has(h.id) };
  }));
  const hubOut = placed
    .map((h) => {
      const [x, y] = xy.get(h.id)!;
      return {
        id: h.id,
        name: h.name,
        lat: round(h.lat, 5),
        lon: round(h.lon, 5),
        x: round(x, 1),
        y: round(y, 1),
        major: majorSet.has(h.id),
        ...(majorSet.has(h.id) ? { colour: colourResult.colours.get(h.id), area: colourResult.area.get(h.id) } : {}),
        ...(h.rail.length ? { rail: h.rail } : {}),
        ...(h.zone ? { zone: h.zone } : {}),
        routes: [...h.routes].map((r) => r.toUpperCase()).sort(routeSort),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const routeOut = routes
    .map((r) => ({ ...r, via: r.path.filter((h, i, p) => majorSet.has(h) && p.slice(0, i).filter((x) => majorSet.has(x)).pop() !== h) }))
    .sort((a, b) => routeSort(a.id, b.id));
  const meta = { generatedAt: new Date().toISOString(), source: 'TfL Open Data', routeCount: routeOut.length, hubCount: hubOut.length, majorCount: majors.length };

  writeFileSync(join(OUT, 'hubs.json'), JSON.stringify(hubOut));
  writeFileSync(join(OUT, 'routes.json'), JSON.stringify(routeOut));
  writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
  // every stop (both directions) with its hub, for the live map and Nearby badges
  const usedHubIds = new Set(hubOut.map((h) => h.id));
  // Stop marker colour: the colour of the nearest major station along any route through
  // the stop (by stops travelled). Stops on routes with no major station are red.
  const STOP_FALLBACK = '#D93A2B';
  const nearestMajor = new Map<string, { d: number; c: string }>();
  for (const r of routeOut) {
    const majIdx = r.path.map((h, i) => (majorSet.has(h) ? i : -1)).filter((i) => i >= 0);
    if (!majIdx.length) continue;
    r.path.forEach((h, i) => {
      let d = Infinity, c = '';
      for (const m of majIdx) if (Math.abs(m - i) < d) { d = Math.abs(m - i); c = colourResult.colours.get(r.path[m])!; }
      const prev = nearestMajor.get(h);
      if (!prev || d < prev.d) nearestMajor.set(h, { d, c });
    });
  }
  writeFileSync(join(OUT, 'stops.json'), JSON.stringify(
    [...stops.values()].filter((s) => usedHubIds.has(stopHub.get(s.id)!)).map((s) => {
      const h = stopHub.get(s.id)!;
      return [s.id, round(s.lat, 5), round(s.lon, 5), h, nearestMajor.get(h)?.c ?? STOP_FALLBACK];
    }),
  ));

  // review list for hand-editing majors
  const review = majors
    .map((h) => ({ id: h.id, name: h.name, routes: countable(h), rail: h.rail, area: colourResult.area.get(h.id), colour: colourResult.colours.get(h.id) }))
    .sort((a, b) => b.routes - a.routes);
  writeFileSync(join(here, 'majors.list.json'), JSON.stringify(review, null, 1));

  // ---- summary
  console.log(`\nroutes: ${routeOut.length} (${routeOut.filter((r) => r.night).length} night, ${routeOut.filter((r) => r.school).length} school)`);
  console.log(`stops: ${stops.size}  hubs: ${hubOut.length}  rail-linked hubs: ${hubOut.filter((h) => h.rail).length}`);
  console.log(`majors: ${majors.length}  (rail≥${MAJOR_RAIL_MIN} or any≥${MAJOR_ANY_MIN}; overrides +${override.add.length} −${override.remove.length})`);
  console.log(`colour check: min neighbour ΔE = ${(colourResult.minNeighbour * 100).toFixed(1)} (target ${colourResult.threshold * 100}), worst pair: ${colourResult.worstPair.join(' / ')}`);
  {
    const ms = hubOut.filter((h) => h.major);
    console.log(`layout: min major separation ${minMajorSep(ms).toFixed(1)} units (needs ≥ ${MIN_SEP.toFixed(1)} for no overlap at Fit on a ${PHONE_WIDTH_PX} px phone)`);
    console.log(`colour pairs within 3 km: ${colourResult.pairCount}, under ΔE ${colourResult.threshold * 100}: ${colourResult.violations.length}`);
  }
  console.log(`contrast: min ${colourResult.minContrast.toFixed(2)}:1 vs map backgrounds`);
  const byArea = new Map<string, typeof review>();
  for (const m of review) (byArea.get(m.area!) ?? byArea.set(m.area!, []).get(m.area!)!).push(m);
  for (const [area, list] of byArea) {
    console.log(`\n${area} (${list.length})`);
    for (const m of list) console.log(`  ${m.colour}  ${String(m.routes).padStart(3)}  ${m.name}${m.rail.length ? '  · ' + formatModes(m.rail) : ''}`);
  }

  // before/after for the stations whose colour changed
  const report: string[] = [`Colour changes (previous build → this build); ΔE = OKLab ×100 to closest neighbour within 3 km`];
  for (const m of review) {
    const before = prev.get(m.id);
    if (before === m.colour) continue;
    const zone1 = colourResult.zone1.has(m.id) ? 'Z1' : '  ';
    report.push(`  ${zone1} ${(before ?? '(new)').padEnd(7)} → ${m.colour}   ΔE ${String((before && colourResult.nearest(m.id, prev)?.toFixed(1)) || '—').padStart(5)} → ${String(colourResult.nearest(m.id)?.toFixed(1) ?? "—").padStart(5)}   ${m.name}`);
  }
  writeFileSync(join(here, 'colour-report.txt'), report.join('\n') + '\n');
  console.log('\n' + report.join('\n'));
}

function loadOverride(): { add: string[]; remove: string[]; colours: Record<string, string> } {
  const f = join(here, 'majors.override.json');
  if (!existsSync(f)) return { add: [], remove: [], colours: {} };
  const o = JSON.parse(readFileSync(f, 'utf8'));
  return { add: o.add ?? [], remove: o.remove ?? [], colours: o.colours ?? {} };
}

const slug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
export function routeSort(a: string, b: string) {
  const pa = a.match(/^([A-Z]*)(\d*)(.*)$/)!, pb = b.match(/^([A-Z]*)(\d*)(.*)$/)!;
  return pa[1].localeCompare(pb[1]) || (Number(pa[2]) || 0) - (Number(pb[2]) || 0) || pa[3].localeCompare(pb[3]);
}

main();
