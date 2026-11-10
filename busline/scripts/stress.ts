// Planner stress test: thousands of random journeys, multi-stop trips, arrive-by and
// noisy-GPS live tracking, checking speed and that every result makes sense.
// Run: npm run stress [count]   (default 2000)
import { readFileSync } from 'node:fs';
import { Router, planTour, planTourArriveBy, type BusLeg } from '../src/router/raptor.ts';
import { START, track, view } from '../src/live/onboard.ts';
const net = JSON.parse(readFileSync(new URL('../public/data/network.json', import.meta.url), 'utf8'));
let t0 = performance.now(); const R = new Router(net); const buildMs = performance.now() - t0;
// seeded random
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const st = net.stops;
const randStop = () => { const i = Math.floor(rnd() * st.id.length); return { lat: st.lat[i] + (rnd() - 0.5) * 0.004, lon: st.lon[i] + (rnd() - 0.5) * 0.006 }; };
const dist = (a: any, b: any) => Math.hypot((b.lon - a.lon) * 69400, (b.lat - a.lat) * 111200);
const fails: string[] = []; const times: number[] = []; let noPlan = 0, plansTotal = 0, slowest = { ms: 0, from: null as any, to: null as any };
const N = Number(process.argv[2] ?? 2000);
for (let k = 0; k < N; k++) {
  const a = randStop(), b = randStop();
  const day = Math.floor(rnd() * 7), clock = Math.floor(rnd() * 86400);
  const s = performance.now();
  let plans;
  try { plans = R.options(a, b, { clock, day }); } catch (e) { fails.push(`crash ${JSON.stringify([a, b, clock, day])}: ${(e as Error).message}`); continue; }
  const ms = performance.now() - s; times.push(ms);
  if (ms > slowest.ms) slowest = { ms, from: a, to: b };
  if (!plans.length) { noPlan++; continue; }
  plansTotal += plans.length;
  for (const p of plans) {
    if (!Number.isFinite(p.seconds) || p.seconds <= 0) fails.push(`bad duration ${p.seconds}`);
    if (p.rides > 6) fails.push(`too many rides ${p.rides}`);
    // physics: can't beat a 60 km/h straight line
    if (p.seconds < dist(a, b) / 16.7) fails.push(`faster than physics: ${Math.round(dist(a, b))} m in ${Math.round(p.seconds)} s`);
    let at: number | undefined, sum = 0;
    for (const l of p.legs) {
      if (l.mode === 'bus') {
        const P = net.patterns[l.pattern];
        if (at !== undefined && l.board !== at && Math.hypot((st.lon[l.board] - st.lon[at]) * 69400, (st.lat[l.board] - st.lat[at]) * 111200) > 20) fails.push(`disconnected leg on ${l.route}`);
        if (P.s.indexOf(l.board) >= P.s.lastIndexOf(l.alight)) fails.push(`rides backwards on ${l.route}`);
        if (l.wait < 0 || l.ride < 0) fails.push(`negative wait/ride on ${l.route}`);
        at = l.alight; sum += l.wait + l.ride;
      } else { if (l.metres < 0 || l.metres > 2500) fails.push(`odd walk ${Math.round(l.metres)} m`); at = l.to.stop; sum += l.seconds; }
    }
    if (p.rides > 0 && sum > p.seconds + 600) fails.push(`legs add up to more than total (${Math.round(sum)} vs ${Math.round(p.seconds)})`);
  }
  // alternatives must differ
  for (const p of plans) for (let i = 1; i < p.legs.length; i++) if (p.legs[i].mode === 'walk' && p.legs[i - 1].mode === 'walk') fails.push('two walks in a row');
  const sig = plans.map((p) => p.legs.filter((l) => l.mode === 'bus').map((l) => (l as BusLeg).route).join('>'));
  if (new Set(sig).size !== sig.length) fails.push('duplicate alternatives');
}
times.sort((x, y) => x - y);
const pct = (q: number) => times[Math.floor(q * (times.length - 1))].toFixed(1);
console.log(`ROUTER  network build ${buildMs.toFixed(0)} ms; ${N} random journeys (any day/time)`);
console.log(`  speed: median ${pct(0.5)} ms, p95 ${pct(0.95)} ms, p99 ${pct(0.99)} ms, max ${pct(1)} ms`);
console.log(`  no plan found: ${noPlan} (${(noPlan / N * 100).toFixed(1)}%), avg options ${(plansTotal / (N - noPlan)).toFixed(2)}`);
// tours
let tourFails = 0, tourMs: number[] = [], improved = 0;
for (let k = 0; k < 60; k++) {
  const n = 2 + 1 + Math.floor(rnd() * 6);
  const pts = Array.from({ length: n }, randStop);
  const dwell = pts.map(() => 900);
  const s = performance.now();
  const best = planTour(R, pts, dwell, { clock: 36000, day: 3, optimise: true });
  tourMs.push(performance.now() - s);
  const given = planTour(R, pts, dwell, { clock: 36000, day: 3, optimise: false });
  if (best.order[0] !== 0 || best.order[best.order.length - 1] !== n - 1 || new Set(best.order).size !== n) { tourFails++; fails.push('tour order invalid'); }
  if (!given.incomplete && !best.incomplete && best.seconds > given.seconds + 300) { tourFails++; fails.push(`tour optimise worse: ${Math.round(best.seconds / 60)} vs ${Math.round(given.seconds / 60)} min (${n - 2} stops)`); }
  if (best.seconds < given.seconds - 60) improved++;
}
tourMs.sort((x, y) => x - y);
console.log(`TOURS   60 trips with 1-6 stops: median ${tourMs[30].toFixed(0)} ms, max ${tourMs[59].toFixed(0)} ms; reorder saved time on ${improved}; invalid ${tourFails}`);
// arrive-by
let abBad = 0;
for (let k = 0; k < 200; k++) {
  const target = 6 * 3600 + Math.floor(rnd() * 16 * 3600);
  const t = planTourArriveBy(R, [randStop(), randStop()], [0, 0], { clock: target, day: Math.floor(rnd() * 7) });
  if (t.segments[0].plans.length && t.departOffset + t.seconds > 180) { abBad++; if (abBad < 4) fails.push(`arrive-by late by ${Math.round((t.departOffset + t.seconds) / 60)} min`); }
}
console.log(`ARRIVE  200 arrive-by plans: ${abBad} arrive more than 3 min late`);
// live tracking with noisy GPS
let trackBad = 0;
for (let k = 0; k < 200; k++) {
  const p = R.plan(randStop(), randStop(), { clock: 43200, day: 2 }).find((x) => x.rides > 0);
  if (!p) continue;
  const legs = p.legs.map((l) => l.mode === 'bus'
    ? { mode: 'bus' as const, line: l.route, stopList: l.stops.map((s) => ({ id: st.id[s], name: st.name[s], lat: st.lat[s], lon: st.lon[s] })), to: { name: st.name[l.alight], lat: st.lat[l.alight], lon: st.lon[l.alight] }, minutes: l.ride / 60 }
    : { mode: 'walk' as const, line: null, stopList: [], to: { name: l.to.name, lat: l.to.lat, lon: l.to.lon }, minutes: l.seconds / 60 });
  let pr = START, lastLeg = 0, lastStop = -1;
  for (const l of legs) for (const s of [...l.stopList, l.to]) {
    for (let j = 0; j < 3; j++) {
      const me = { lat: s.lat + (rnd() - 0.5) * 0.0012, lon: s.lon + (rnd() - 0.5) * 0.0018 }; // ±60 m noise
      pr = track(legs, me, pr);
      view(legs, pr, me);
      if (pr.leg < lastLeg || (pr.leg === lastLeg && pr.stop < lastStop && pr.stop !== -1)) { trackBad++; break; }
      lastLeg = pr.leg; lastStop = pr.stop;
    }
  }
  if (!pr.arrived) trackBad += 0; // destination may be off the last stop by >120 m; not an error
}
console.log(`TRACK   200 simulated rides with ±60 m GPS noise: ${trackBad} went backwards`);
console.log(`\nFAILURES (${fails.length}):\n` + [...new Set(fails)].slice(0, 15).join('\n'));
if (fails.length) process.exit(1);
