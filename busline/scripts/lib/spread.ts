// Turn fisheye-projected positions into map units where no two major markers
// overlap at the default "Fit" zoom on a 390 px-wide phone.
//
// 1. Normalise so the network is MAP_WIDTH units wide.
// 2. Relax major stations apart until every pair is at least MIN_SEP units apart,
//    with a weak spring back to their geographic position.
// 3. Move every other hub by a smooth, distance-weighted blend of the nearby
//    majors' displacements, so lines still run through their stations.

export const MAP_WIDTH = 1000;
export const FIT_PAD = 0.02;           // fraction of width the app adds on each side when fitting
export const PHONE_WIDTH_PX = 390;
export const MARKER_DIAMETER_PX = 12;   // major marker outer ring at Fit zoom
const GAP_PX = 2;
export const MIN_SEP = ((MARKER_DIAMETER_PX + GAP_PX) * MAP_WIDTH * (1 + 2 * FIT_PAD)) / PHONE_WIDTH_PX;

interface P { id: string; x: number; y: number; major: boolean }

export function spreadMajors(points: P[]): Map<string, [number, number]> {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const k = MAP_WIDTH / (x1 - x0);
  const norm = points.map((p) => ({ ...p, x: (p.x - (x0 + x1) / 2) * k, y: (p.y - (y0 + y1) / 2) * k }));

  const majors = norm.filter((p) => p.major).map((p) => ({ id: p.id, ox: p.x, oy: p.y, x: p.x, y: p.y }));
  for (let it = 0; it < 2000; it++) {
    let worst = Infinity;
    for (let i = 0; i < majors.length; i++)
      for (let j = i + 1; j < majors.length; j++) {
        const a = majors[i], b = majors[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        worst = Math.min(worst, d);
        if (d >= MIN_SEP) continue;
        if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
        const push = (MIN_SEP - d) / 2 + 0.3;
        a.x -= (dx / d) * push; a.y -= (dy / d) * push;
        b.x += (dx / d) * push; b.y += (dy / d) * push;
      }
    if (worst >= MIN_SEP) break;
    // weak pull home keeps the picture geographic
    const pull = 0.01 * Math.max(0, 1 - it / 800);
    for (const m of majors) { m.x += (m.ox - m.x) * pull; m.y += (m.oy - m.y) * pull; }
  }

  const SIGMA = MIN_SEP * 1.5;
  const out = new Map<string, [number, number]>();
  for (const m of majors) out.set(m.id, [m.x, m.y]);
  for (const p of norm) {
    if (p.major) continue;
    let wx = 0, wy = 0, ws = 0;
    for (const m of majors) {
      const d2 = (p.x - m.ox) ** 2 + (p.y - m.oy) ** 2;
      if (d2 > (SIGMA * 4) ** 2) continue;
      const w = Math.exp(-d2 / (SIGMA * SIGMA));
      wx += w * (m.x - m.ox); wy += w * (m.y - m.oy); ws += w;
    }
    const s = ws > 0 ? 1 / Math.max(ws, 0.35) : 0; // far from any major → barely moves
    out.set(p.id, [p.x + wx * s * Math.min(1, ws / 0.35), p.y + wy * s * Math.min(1, ws / 0.35)]);
  }
  return out;
}

/** Smallest centre-to-centre distance between majors (for tests/summary). */
export function minMajorSep(pts: { x: number; y: number }[]) {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.min(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  return m;
}
