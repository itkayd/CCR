// Area colour families + neighbour-aware assignment for major stations (spec §4).
import {
  MAP_BG_DARK, MAP_BG_LIGHT, clampChroma, contrast, deltaOk, oklabToRgb, rgbToHex,
} from '../../src/lib/colour.ts';
import { bearing, distM, type LatLon } from './geo.ts';

export type Area = 'central' | 'east' | 'north-east' | 'north' | 'north-west' | 'west' | 'south-west' | 'south-east';

interface Family { hues: [number, number]; chroma: [number, number] }
// OKLCH hue ranges (degrees) and chroma ranges for each area.
const FAMILIES: Record<Area, Family> = {
  east:         { hues: [18, 55],   chroma: [0.13, 0.22] }, // reds / oranges
  'north-east': { hues: [300, 352], chroma: [0.12, 0.22] }, // purples / magentas
  north:        { hues: [62, 95],   chroma: [0.10, 0.17] }, // ambers / golds
  'north-west': { hues: [125, 158], chroma: [0.10, 0.18] }, // greens
  west:         { hues: [170, 215], chroma: [0.08, 0.14] }, // teals / cyans
  'south-west': { hues: [228, 262], chroma: [0.10, 0.19] }, // blues
  'south-east': { hues: [35, 75],   chroma: [0.03, 0.07] }, // browns …
  central:      { hues: [255, 330], chroma: [0.04, 0.2] },  // indigo → violet → plum
};
// slates join the south-east family
const EXTRA: Partial<Record<Area, Family[]>> = { 'south-east': [{ hues: [215, 250], chroma: [0.02, 0.05] }] };

const CENTRAL_RADIUS_M = 3500;
const NEIGHBOUR_M = 3000;
// Central London packs ~30 majors inside 3 km; no single colour family can keep
// them all apart, so in the centre "neighbour" means within 1.5 km.
const NEIGHBOUR_CENTRAL_M = 1500;
export const THRESHOLD = 0.07; // OKLab distance between neighbouring majors
const MIN_CONTRAST = 3;

export function areaOf(p: LatLon, centre: LatLon): Area {
  if (distM(p, centre) < CENTRAL_RADIUS_M) return 'central';
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
    for (let h = f.hues[0]; h <= f.hues[1]; h += 2.5)
      for (const L of [0.5, 0.53, 0.56, 0.59, 0.62, 0.65])
        for (let c = f.chroma[0]; c <= f.chroma[1] + 1e-9; c += 0.02) {
          const hex = rgbToHex(oklabToRgb(clampChroma(L, c, h)));
          if (contrast(hex, MAP_BG_LIGHT) >= MIN_CONTRAST && contrast(hex, MAP_BG_DARK) >= MIN_CONTRAST) out.add(hex);
        }
  }
  return [...out];
}

export function assignColours(
  majors: { id: string; lat: number; lon: number }[],
  centre: LatLon,
  fixed: Record<string, string> = {},
) {
  const area = new Map(majors.map((m) => [m.id, areaOf(m, centre)]));
  const pool = new Map<Area, string[]>();
  for (const a of new Set(area.values())) pool.set(a, candidates(a));

  const neighbours = new Map<string, string[]>(majors.map((m) => [m.id, []]));
  for (let i = 0; i < majors.length; i++)
    for (let j = i + 1; j < majors.length; j++)
      if (distM(majors[i], majors[j]) <= (area.get(majors[i].id) === 'central' && area.get(majors[j].id) === 'central' ? NEIGHBOUR_CENTRAL_M : NEIGHBOUR_M)) {
        neighbours.get(majors[i].id)!.push(majors[j].id);
        neighbours.get(majors[j].id)!.push(majors[i].id);
      }

  const colours = new Map<string, string>(Object.entries(fixed).filter(([id]) => area.has(id)));
  // Within a family, spread colours out too, not just between neighbours.
  const score = (id: string, hex: string) => {
    let nb = Infinity, fam = Infinity, any = Infinity;
    for (const [other, c] of colours) {
      if (other === id) continue;
      const d = deltaOk(hex, c);
      any = Math.min(any, d);
      if (neighbours.get(id)!.includes(other)) nb = Math.min(nb, d);
      if (area.get(other) === area.get(id)) fam = Math.min(fam, d);
    }
    if (any < 0.012) return -1; // never reuse a colour
    return Math.min(nb, 0.2) * 3 + Math.min(fam, 0.2);
  };

  // Most-constrained first, centre outwards.
  const order = [...majors].sort((a, b) => neighbours.get(b.id)!.length - neighbours.get(a.id)!.length);
  for (const m of order) {
    if (colours.has(m.id)) continue;
    const cands = pool.get(area.get(m.id)!)!;
    let best = cands[0], bestS = -Infinity;
    for (const c of cands) { const s = score(m.id, c); if (s > bestS) { bestS = s; best = c; } }
    colours.set(m.id, best);
  }

  // Repair pass: re-pick for any station still too close to a neighbour.
  for (let iter = 0; iter < 20; iter++) {
    let changed = false;
    for (const m of order) {
      if (fixed[m.id]) continue;
      const worst = Math.min(...neighbours.get(m.id)!.map((n) => deltaOk(colours.get(m.id)!, colours.get(n)!)), Infinity);
      if (worst >= THRESHOLD) continue;
      const cands = pool.get(area.get(m.id)!)!;
      let best = colours.get(m.id)!, bestS = score(m.id, best);
      for (const c of cands) { const s = score(m.id, c); if (s > bestS) { bestS = s; best = c; } }
      if (best !== colours.get(m.id)) { colours.set(m.id, best); changed = true; }
    }
    if (!changed) break;
  }

  let minNeighbour = Infinity, worstPair: [string, string] = ['', ''];
  for (const [id, ns] of neighbours)
    for (const n of ns) {
      const d = deltaOk(colours.get(id)!, colours.get(n)!);
      if (d < minNeighbour) { minNeighbour = d; worstPair = [id, n]; }
    }
  const minContrast = Math.min(...[...colours.values()].flatMap((c) => [contrast(c, MAP_BG_LIGHT), contrast(c, MAP_BG_DARK)]));
  const violations = [...neighbours].flatMap(([id, ns]) =>
    ns.filter((n) => id < n && deltaOk(colours.get(id)!, colours.get(n)!) < THRESHOLD).map((n) => [id, n]));

  return { colours, area, minNeighbour, worstPair, minContrast, threshold: THRESHOLD, violations };
}
