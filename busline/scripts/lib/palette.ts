// Area colour families + neighbour-aware assignment for major stations (spec §4).
import {
  MAP_BG_LIGHT, VISIONS, clampChroma, contrast, hexToRgb, oklabToRgb, rgbToHex, rgbToOklab, simulate, type Lab,
} from '../../src/lib/colour.ts';

const labCache = new Map<string, Lab>();
const lab = (hex: string) => {
  let v = labCache.get(hex);
  if (!v) { v = rgbToOklab(hexToRgb(hex)); labCache.set(hex, v); }
  return v;
};
const rawDelta = (a: string, b: string) => {
  const p = lab(a), q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
const simCache = new Map<string, string[]>();
const sims = (hex: string) => { let v = simCache.get(hex); if (!v) { v = VISIONS.map((t) => simulate(hex, t)); simCache.set(hex, v); } return v; };
/** ΔE with colour-blind vision (worst of protanopia, deuteranopia, tritanopia). */
export const cvdDelta = (a: string, b: string) => { const sa = sims(a), sb = sims(b); return Math.min(...sa.map((x, i) => rawDelta(x, sb[i]))); };
export const CVD_THRESHOLD = 0.07; // neighbours must differ by ≥ ΔE 7 for colour-blind riders too
/** Combined distance: normal vision, with colour-blind vision scaled so ΔE 7 there counts as 12 here. */
const deltaOk = (a: string, b: string) => Math.min(rawDelta(a, b), cvdDelta(a, b) * (0.12 / CVD_THRESHOLD));
import { bearing, distM, type LatLon } from './geo.ts';

export type Area = 'central' | 'east' | 'north-east' | 'north' | 'north-west' | 'west' | 'south-west' | 'south-east';

interface Family { hues: [number, number]; chroma: [number, number] }
// OKLCH hue ranges (degrees) and chroma ranges for each area.
const FAMILIES: Record<Area, Family> = {
  east:         { hues: [15, 58],   chroma: [0.12, 0.22] }, // reds / oranges
  'north-east': { hues: [300, 352], chroma: [0.12, 0.22] }, // purples / magentas
  north:        { hues: [50, 115],  chroma: [0.07, 0.19] }, // ambers / golds
  'north-west': { hues: [118, 165], chroma: [0.08, 0.20] }, // greens
  west:         { hues: [160, 230], chroma: [0.05, 0.17] }, // teals / cyans
  'south-west': { hues: [225, 268], chroma: [0.08, 0.20] }, // blues
  'south-east': { hues: [25, 80],   chroma: [0.06, 0.12] }, // browns …
  // Zone 1 packs ~40 majors into a few km, so it may use the whole hue circle at
  // high chroma; indigo is only its starting point.
  central:      { hues: [0, 355], chroma: [0.10, 0.26] },
};
// slates join the south-east family
const EXTRA: Partial<Record<Area, Family[]>> = { 'south-east': [{ hues: [215, 250], chroma: [0.05, 0.09] }] };

export const NEIGHBOUR_M = 3000;
export const THRESHOLD = 0.12; // OKLab ΔE (×100 = 12) between majors within NEIGHBOUR_M
const MIN_CONTRAST = 3;
/** white route numbers on the colour must be readable (WCAG AA text) */
const MIN_WHITE_TEXT = 4.5;
/** soft, not neon: cap OKLCH chroma */
const MAX_CHROMA = 0.18;

export function areaOf(p: LatLon, centre: LatLon, zone1: boolean): Area {
  if (zone1) return 'central';
  const b = bearing(centre, p);
  if (b >= 335 || b < 25) return 'north';
  if (b < 65) return 'north-east';
  if (b < 125) return 'east';
  if (b < 180) return 'south-east';
  if (b < 240) return 'south-west';
  if (b < 295) return 'west';
  return 'north-west';
}

function candidates(area: Area): string[] {
  const out = new Set<string>();
  for (const f of [FAMILIES[area], ...(EXTRA[area] ?? [])]) {
    for (let h = f.hues[0]; h <= f.hues[1]; h += f.hues[1] - f.hues[0] > 120 ? 5 : 2.5)
      // a wide lightness range: lightness is what colour-blind riders can still tell apart
      for (const L of [0.36, 0.4, 0.44, 0.48, 0.52, 0.56, 0.6])
        for (let c = Math.min(f.chroma[0], MAX_CHROMA); c <= Math.min(f.chroma[1], MAX_CHROMA) + 1e-9; c += f.hues[1] - f.hues[0] > 120 ? 0.03 : 0.02) {
          const lab = clampChroma(L, c, h);
          if (Math.hypot(lab[1], lab[2]) < Math.min(f.chroma[0], MAX_CHROMA) - 0.005) continue; // gamut-clipped below the family's chroma floor
          const hex = rgbToHex(oklabToRgb(lab));
          // on the dark map, lines and markers get a light casing, so only light-map contrast is needed here
          if (contrast(hex, MAP_BG_LIGHT) >= MIN_CONTRAST && contrast(hex, '#FFFFFF') >= MIN_WHITE_TEXT) out.add(hex);
        }
  }
  return [...out];
}

export function assignColours(
  majors: { id: string; lat: number; lon: number; zone1: boolean }[],
  centre: LatLon,
  fixed: Record<string, string> = {},
) {
  const area = new Map(majors.map((m) => [m.id, areaOf(m, centre, m.zone1)]));
  const zone1 = new Set(majors.filter((m) => m.zone1).map((m) => m.id));
  const pool = new Map<Area, string[]>();
  for (const a of new Set(area.values())) pool.set(a, candidates(a));

  const neighbours = new Map<string, string[]>(majors.map((m) => [m.id, []]));
  for (let i = 0; i < majors.length; i++)
    for (let j = i + 1; j < majors.length; j++)
      if (distM(majors[i], majors[j]) <= NEIGHBOUR_M) {
        neighbours.get(majors[i].id)!.push(majors[j].id);
        neighbours.get(majors[j].id)!.push(majors[i].id);
      }

  const colours = new Map<string, string>(Object.entries(fixed).filter(([id]) => area.has(id)));
  const nearestIn = (id: string, hex: string, map: Map<string, string>) => {
    let d = Infinity;
    for (const n of neighbours.get(id)!) { const c = map.get(n); if (c) d = Math.min(d, deltaOk(hex, c)); }
    return d;
  };
  // Score a candidate: closest neighbour first, then spread within the family.
  const score = (id: string, hex: string) => {
    let fam = Infinity, any = Infinity;
    for (const [other, c] of colours) {
      if (other === id) continue;
      const d = deltaOk(hex, c);
      any = Math.min(any, d);
      if (area.get(other) === area.get(id)) fam = Math.min(fam, d);
    }
    if (any < 0.012) return -1; // never reuse a colour
    return Math.min(nearestIn(id, hex, colours), 0.3) * 4 + Math.min(fam, 0.15);
  };
  // A station that still can't reach the threshold inside its own family may
  // borrow from the next family round the compass (never from Zone 1's).
  const RING: Area[] = ['north', 'north-east', 'east', 'south-east', 'south-west', 'west', 'north-west'];
  const borrowPool = (a: Area) => {
    if (a === 'central') return [];
    const i = RING.indexOf(a);
    // neighbours round the compass first; any outer family if that still isn't enough
    const order = [RING[(i + 1) % RING.length], RING[(i + RING.length - 1) % RING.length], ...RING.filter((_, k) => k !== i)];
    return [...new Set(order)].flatMap((n) => pool.get(n) ?? (pool.set(n, candidates(n)), pool.get(n)!));
  };
  const best = (id: string) => {
    let pick = colours.get(id) ?? pool.get(area.get(id)!)![0], s = colours.has(id) ? score(id, pick) : -Infinity;
    for (const c of pool.get(area.get(id)!)!) { const v = score(id, c); if (v > s) { s = v; pick = c; } }
    if (colours.has(id) && nearestIn(id, pick, colours) < THRESHOLD) {
      for (const c of borrowPool(area.get(id)!)) { const v = score(id, c) - 0.01; if (v > s) { s = v; pick = c; } }
    }
    return pick;
  };

  // Greedy, most-constrained first.
  const order = [...majors].sort((a, b) => neighbours.get(b.id)!.length - neighbours.get(a.id)!.length);
  for (const m of order) if (!colours.has(m.id)) colours.set(m.id, best(m.id));

  // Coordinate descent on the worst stations until nothing improves.
  for (let round = 0; round < 80; round++) {
    const worstFirst = [...majors]
      .filter((m) => !fixed[m.id])
      .sort((a, b) => nearestIn(a.id, colours.get(a.id)!, colours) - nearestIn(b.id, colours.get(b.id)!, colours));
    let changed = 0;
    for (const m of worstFirst) {
      const now = colours.get(m.id)!, pick = best(m.id);
      if (pick !== now) { colours.set(m.id, pick); changed++; }
    }
    if (!changed) break;
  }

  let minNeighbour = Infinity, worstPair: [string, string] = ['', ''];
  for (const [id, ns] of neighbours)
    for (const n of ns) {
      const d = rawDelta(colours.get(id)!, colours.get(n)!);
      if (d < minNeighbour) { minNeighbour = d; worstPair = [id, n]; }
    }
  const minContrast = Math.min(...[...colours.values()].map((c) => contrast(c, '#FFFFFF')));
  let minCvd = Infinity; for (const [id, ns] of neighbours) for (const nb of ns) minCvd = Math.min(minCvd, cvdDelta(colours.get(id)!, colours.get(nb)!));
  const cvdViolations = [...neighbours].flatMap(([id, ns]) => ns.filter((nb) => id < nb && cvdDelta(colours.get(id)!, colours.get(nb)!) < CVD_THRESHOLD).map((nb) => [id, nb]));
  const violations = [...neighbours].flatMap(([id, ns]) =>
    ns.filter((n) => id < n && rawDelta(colours.get(id)!, colours.get(n)!) < THRESHOLD).map((n) => [id, n]));
  const pairCount = [...neighbours.values()].reduce((t, ns) => t + ns.length, 0) / 2;

  /** ΔE×100 from a station to its closest neighbour, under a given colour map. */
  const nearest = (id: string, map: Map<string, string> = colours) => {
    const c = map.get(id);
    if (!c) return undefined;
    const d = nearestIn(id, c, map);
    return Number.isFinite(d) ? d * 100 : undefined;
  };

  return { colours, area, zone1, neighbours, minNeighbour, worstPair, minContrast, threshold: THRESHOLD, violations, pairCount, nearest, minCvd, cvdViolations };
}
