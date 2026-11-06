// Busline's own journey planner: RAPTOR (round-based public transit routing)
// adapted to a frequency-based bus network.
//
//   round 0  walk from the origin to nearby stops
//   round k  ride one more bus: scan every route pattern touched by a stop
//            improved in round k-1, then walk to nearby stops (transfers)
//
// Waiting uses half the headway (capped), riding uses each pattern's running
// times. Each round gives the best journey with exactly k buses, so the result
// is naturally a set of options: fastest, fewer changes, etc.

export interface Network {
  stops: { id: string[]; name: string[]; letter: string[]; lat: number[]; lon: number[] };
  patterns: { r: string; d: string; to: string; n: 0 | 1; s: number[]; t: number[]; h: number }[];
}

export interface PlanOptions {
  /** seconds since London midnight, for picking day/night routes */
  clock: number;
  maxRides?: number;
  walkSpeed?: number;   // m/s
  maxAccessM?: number;  // walk to the first stop / from the last
  transferM?: number;   // walk between stops when changing
  /** route ids not to use (for alternatives) */
  banned?: Set<string>;
}

export interface WalkLeg { mode: 'walk'; from: Pt; to: Pt; seconds: number; metres: number; start: number }
export interface BusLeg {
  mode: 'bus'; route: string; towards: string; pattern: number;
  board: number; alight: number; // stop indices
  stops: number[];               // every stop ridden through, board → alight
  wait: number; ride: number; start: number; headway: number;
}
export type Leg = WalkLeg | BusLeg;
export interface Pt { name: string; lat: number; lon: number; stop?: number }
export interface Plan { seconds: number; rides: number; walkMetres: number; legs: Leg[] }

const R = 6371000, K = Math.PI / 180;
const dist = (la1: number, lo1: number, la2: number, lo2: number) =>
  Math.hypot((lo2 - lo1) * K * Math.cos(((la1 + la2) / 2) * K), (la2 - la1) * K) * R;

export class Router {
  readonly net: Network;
  private stopPatterns: { p: number; i: number }[][];
  private grid = new Map<string, number[]>();
  private foot: { to: number; m: number }[][];
  private readonly CELL = 0.004; // ≈ 280–450 m

  constructor(net: Network, transferM = 300) {
    this.net = net;
    const n = net.stops.id.length;
    this.stopPatterns = Array.from({ length: n }, () => []);
    net.patterns.forEach((pt, p) => pt.s.forEach((s, i) => this.stopPatterns[s].push({ p, i })));
    for (let s = 0; s < n; s++) {
      const k = this.cell(net.stops.lat[s], net.stops.lon[s]);
      (this.grid.get(k) ?? this.grid.set(k, []).get(k)!).push(s);
    }
    this.foot = Array.from({ length: n }, (_, s) => this.near(net.stops.lat[s], net.stops.lon[s], transferM).filter((x) => x.to !== s));
  }

  private cell(lat: number, lon: number) { return `${Math.floor(lat / this.CELL)},${Math.floor(lon / (this.CELL * 1.6))}`; }

  /** Stops within `m` metres of a point. */
  near(lat: number, lon: number, m: number): { to: number; m: number }[] {
    const out: { to: number; m: number }[] = [];
    const ci = Math.floor(lat / this.CELL), cj = Math.floor(lon / (this.CELL * 1.6));
    const span = Math.ceil(m / 280) + 1;
    for (let i = ci - span; i <= ci + span; i++)
      for (let j = cj - span; j <= cj + span; j++)
        for (const s of this.grid.get(`${i},${j}`) ?? []) {
          const d = dist(lat, lon, this.net.stops.lat[s], this.net.stops.lon[s]);
          if (d <= m) out.push({ to: s, m: d });
        }
    return out;
  }

  plan(from: { lat: number; lon: number; name?: string }, to: { lat: number; lon: number; name?: string }, o: PlanOptions): Plan[] {
    const { stops, patterns } = this.net;
    const n = stops.id.length;
    const walk = o.walkSpeed ?? 1.3, maxRides = o.maxRides ?? 4, access = o.maxAccessM ?? 800;
    const TRANSFER_PENALTY = 90; // s, getting off and finding the next stop
    const night = o.clock < 5 * 3600 || o.clock > 24 * 3600 - 1800;
    const active = patterns.map((p) => (night ? true : p.n === 0) && !o.banned?.has(p.r));

    const INF = 1e12;
    // per round: arrival time, and how we got there
    const arr: Float64Array[] = [], ptype: Uint8Array[] = [], pa: Int32Array[] = [], pb: Int32Array[] = [], pc: Int32Array[] = [];
    const best = new Float64Array(n).fill(INF);
    const newRound = () => { arr.push(new Float64Array(n).fill(INF)); ptype.push(new Uint8Array(n)); pa.push(new Int32Array(n).fill(-1)); pb.push(new Int32Array(n)); pc.push(new Int32Array(n)); };

    // round 0: walk to stops near the origin
    newRound();
    let marked = new Set<number>();
    for (const { to: s, m } of this.near(from.lat, from.lon, access)) {
      const t = m / walk;
      if (t < arr[0][s]) { arr[0][s] = t; best[s] = Math.min(best[s], t); ptype[0][s] = 1; pb[0][s] = Math.round(m); marked.add(s); }
    }
    const egress = new Map<number, number>();
    for (const { to: s, m } of this.near(to.lat, to.lon, access)) egress.set(s, m);
    const direct = dist(from.lat, from.lon, to.lat, to.lon);

    const results: Plan[] = [];
    let bestTotal = direct < 2000 ? direct / walk : INF;

    for (let k = 1; k <= maxRides && marked.size; k++) {
      newRound();
      const A = arr[k], prev = arr[k - 1];
      // which patterns to scan, from which position
      const queue = new Map<number, number>();
      for (const s of marked) for (const { p, i } of this.stopPatterns[s]) {
        if (!active[p]) continue;
        const q = queue.get(p);
        if (q === undefined || i < q) queue.set(p, i);
      }
      const improved = new Set<number>();
      for (const [p, start] of queue) {
        const P = patterns[p];
        const wait = Math.min(P.h / 2, 15 * 60);
        let boardPos = -1, boardTime = INF;
        for (let i = start; i < P.s.length; i++) {
          const s = P.s[i];
          if (boardPos >= 0) {
            const t = boardTime + (P.t[i] - P.t[boardPos]);
            // target pruning: no point arriving later than the best journey found
            if (t < A[s] && t < best[s] && t < bestTotal) {
              A[s] = t; best[s] = t; ptype[k][s] = 2; pa[k][s] = p; pb[k][s] = boardPos; pc[k][s] = i; improved.add(s);
            }
          }
          // (re)board here if waiting at this stop beats staying on from earlier
          if (prev[s] < INF) {
            const dep = prev[s] + (k > 1 ? TRANSFER_PENALTY : 0) + wait;
            const ridingAt = boardPos >= 0 ? boardTime + (P.t[i] - P.t[boardPos]) : INF;
            if (dep < ridingAt) { boardPos = i; boardTime = dep; }
          }
        }
      }
      // transfers on foot from stops reached by bus this round
      marked = new Set(improved);
      for (const s of improved) for (const { to: x, m } of this.foot[s]) {
        const t = A[s] + m / walk;
        if (t < A[x] && t < best[x]) { A[x] = t; best[x] = t; ptype[k][x] = 3; pa[k][x] = s; pb[k][x] = Math.round(m); marked.add(x); }
      }
      // best way to finish with k rides
      let bestStop = -1, bestT = INF;
      for (const [s, m] of egress) {
        if (A[s] >= INF) continue;
        const t = A[s] + m / walk;
        if (t < bestT) { bestT = t; bestStop = s; }
      }
      // keep it only if it beats fewer rides by a worthwhile margin
      if (bestStop >= 0 && bestT < bestTotal - (results.length ? 120 : 0)) {
        bestTotal = Math.min(bestTotal, bestT);
        results.push(this.backtrack(k, bestStop, bestT, egress.get(bestStop)!, from, to, arr, ptype, pa, pb, pc, walk));
      }
    }
    if (direct < 2000) {
      results.push({ seconds: direct / walk, rides: 0, walkMetres: direct, legs: [{ mode: 'walk', from: { name: from.name ?? 'Start', ...from }, to: { name: to.name ?? 'Destination', ...to }, seconds: direct / walk, metres: direct, start: 0 }] });
    }
    return results.sort((a, b) => a.seconds - b.seconds);
  }

  /** Best plans plus genuinely different alternatives: re-plan with each bus of the
   *  best journey taken out in turn. Distinct by the sequence of routes used. */
  options(from: { lat: number; lon: number; name?: string }, to: { lat: number; lon: number; name?: string }, o: PlanOptions, max = 4): Plan[] {
    const seen = new Map<string, Plan>();
    const key = (p: Plan) => p.legs.filter((l) => l.mode === 'bus').map((l) => (l as BusLeg).route).join('>') || 'walk';
    const add = (ps: Plan[]) => { for (const p of ps) { const k = key(p); if (!seen.has(k) || seen.get(k)!.seconds > p.seconds) seen.set(k, p); } };
    const base = this.plan(from, to, o);
    add(base);
    const fastest = base.find((p) => p.rides > 0);
    if (fastest) {
      for (const l of fastest.legs) if (l.mode === 'bus') add(this.plan(from, to, { ...o, banned: new Set([...(o.banned ?? []), l.route]) }));
    }
    const all = [...seen.values()].sort((a, b) => a.seconds - b.seconds);
    const top = all[0]?.seconds ?? 0;
    // drop options much slower than the best, unless they need fewer changes
    const minRides = Math.min(...all.map((p) => p.rides));
    return all.filter((p) => p.seconds <= top * 1.5 + 600 || p.rides === minRides).slice(0, max);
  }

  private pt(s: number): Pt { const st = this.net.stops; return { name: st.name[s], lat: st.lat[s], lon: st.lon[s], stop: s }; }

  private backtrack(k: number, stop: number, total: number, egressM: number, from: { lat: number; lon: number; name?: string }, to: { lat: number; lon: number; name?: string },
    arr: Float64Array[], ptype: Uint8Array[], pa: Int32Array[], pb: Int32Array[], pc: Int32Array[], walk: number): Plan {
    const legs: Leg[] = [];
    const end: Pt = { name: to.name ?? 'Destination', lat: to.lat, lon: to.lon };
    legs.push({ mode: 'walk', from: this.pt(stop), to: end, seconds: egressM / walk, metres: egressM, start: arr[k][stop] });
    let s = stop, r = k;
    while (r >= 0) {
      const type = ptype[r][s];
      if (type === 3) { // walked from another stop this round
        const from = pa[r][s];
        legs.push({ mode: 'walk', from: this.pt(from), to: this.pt(s), seconds: pb[r][s] / walk, metres: pb[r][s], start: arr[r][from] });
        s = from; continue;
      }
      if (type === 2) { // rode a bus
        const p = pa[r][s], P = this.net.patterns[p], bi = pb[r][s], ai = pc[r][s];
        const board = P.s[bi];
        const ride = P.t[ai] - P.t[bi];
        const reachBoard = arr[r - 1][board];
        const wait = arr[r][s] - ride - reachBoard;
        legs.push({ mode: 'bus', route: P.r, towards: P.to, pattern: p, board, alight: s, stops: P.s.slice(bi, ai + 1), wait, ride, start: reachBoard, headway: P.h });
        s = board; r--; continue;
      }
      if (type === 1) { // walked from the origin
        legs.push({ mode: 'walk', from: { name: from.name ?? 'Start', lat: from.lat, lon: from.lon }, to: this.pt(s), seconds: pb[r][s] / walk, metres: pb[r][s], start: 0 });
      }
      break;
    }
    legs.reverse();
    const merged = legs.filter((l) => !(l.mode === 'walk' && l.metres < 15));
    return {
      seconds: total,
      rides: merged.filter((l) => l.mode === 'bus').length,
      walkMetres: merged.reduce((t, l) => t + (l.mode === 'walk' ? l.metres : 0), 0),
      legs: merged,
    };
  }
}

// ---------------------------------------------------------------- multi-stop trips
export interface TourPoint { lat: number; lon: number; name?: string }
export interface TourSegment { from: number; to: number; plans: Plan[]; start: number }
export interface Tour { order: number[]; segments: TourSegment[]; seconds: number; optimised: boolean; tried: number }

/**
 * Plan start → stops → destination. `dwell[i]` is how long you stay at point i (s).
 * With `optimise`, the in-between stops are re-ordered for the quickest overall trip:
 * travel times between every pair of points come from the planner, then every order
 * of the stops is tried (exact for up to 6 stops; nearest-neighbour + 2-opt above).
 */
export function planTour(router: Router, points: TourPoint[], dwell: number[], o: PlanOptions & { optimise?: boolean }): Tour {
  const n = points.length;
  const mids = Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 1);
  let order = [0, ...mids, n - 1];
  let tried = 1;
  if (o.optimise && mids.length >= 2) {
    // pairwise fastest door-to-door times (seconds); clock shift is small, ignore it here
    const T: number[][] = Array.from({ length: n }, () => new Array(n).fill(Infinity));
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (a === b || b === 0 || a === n - 1) continue;
      const best = router.plan(points[a], points[b], o)[0];
      T[a][b] = best ? best.seconds : Infinity;
    }
    const cost = (ord: number[]) => ord.slice(1).reduce((t, p, i) => t + T[ord[i]][p], 0);
    let bestOrd = order, bestCost = cost(order);
    if (mids.length <= 6) {
      const permute = (arr: number[], k: number) => {
        if (k === arr.length) { tried++; const ord = [0, ...arr, n - 1], c = cost(ord); if (c < bestCost) { bestCost = c; bestOrd = ord; } return; }
        for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; permute(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
      };
      permute(mids.slice(), 0);
    } else {
      // greedy, then 2-opt improvement
      const left = new Set(mids); const ord = [0];
      while (left.size) { const last = ord[ord.length - 1]; let nx = -1, bc = Infinity; for (const m of left) if (T[last][m] < bc) { bc = T[last][m]; nx = m; } ord.push(nx); left.delete(nx); }
      ord.push(n - 1);
      let improved = true;
      while (improved) {
        improved = false;
        for (let i = 1; i < ord.length - 2; i++) for (let j = i + 1; j < ord.length - 1; j++) {
          const cand = [...ord.slice(0, i), ...ord.slice(i, j + 1).reverse(), ...ord.slice(j + 1)];
          tried++;
          if (cost(cand) < cost(ord) - 1) { ord.splice(0, ord.length, ...cand); improved = true; }
        }
      }
      bestOrd = ord;
    }
    order = bestOrd;
  }
  // full plans (with alternatives) for each leg of the chosen order, advancing the clock
  const segments: TourSegment[] = [];
  let t = 0;
  for (let i = 0; i < order.length - 1; i++) {
    const a = order[i], b = order[i + 1];
    const clock = (o.clock + t) % 86400;
    const plans = router.options(points[a], points[b], { ...o, clock }, 3);
    segments.push({ from: a, to: b, plans, start: t });
    t += (plans[0]?.seconds ?? 0) + (i + 1 < order.length - 1 ? dwell[b] ?? 0 : 0);
  }
  return { order, segments, seconds: t, optimised: !!o.optimise && mids.length >= 2, tried };
}
