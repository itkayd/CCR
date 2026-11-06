// Journey planner checks on the generated network. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type BusLeg } from '../src/router/raptor.ts';

const net = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'network.json'), 'utf8'));
const R = new Router(net);
const noon = 12 * 3600;
const TRIPS: [string, [number, number], [number, number], number][] = [
  ['Brixton → Camden Town', [51.4627, -0.1145], [51.5392, -0.1426], 110],
  ['South Croydon → East Croydon', [51.35815, -0.09755], [51.3754, -0.0927], 35],
  ['Romford → Ilford', [51.5751, 0.1832], [51.5590, 0.0700], 75],
  ['Stratford → Canning Town', [51.5419, -0.0027], [51.5147, 0.0082], 40],
];

for (const [name, a, b, maxMin] of TRIPS) {
  test(`plans ${name}`, () => {
    const plans = R.options({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }, { clock: noon });
    const bus = plans.filter((p) => p.rides > 0);
    assert.ok(bus.length >= 1, 'at least one bus journey');
    assert.ok(bus[0].seconds / 60 <= maxMin, `fastest ${Math.round(bus[0].seconds / 60)} min ≤ ${maxMin}`);
    for (const p of plans) {
      // legs connect: each bus boards where the previous leg ended
      let at: number | undefined;
      for (const l of p.legs) {
        if (l.mode === 'bus') {
          if (at !== undefined) assert.equal(l.board, at, 'bus boards where the last leg ended');
          const P = net.patterns[l.pattern];
          assert.ok(P.s.indexOf(l.board) < P.s.lastIndexOf(l.alight), 'rides forwards along the route');
          at = l.alight;
        } else { if (at !== undefined && l.from.stop !== undefined) assert.equal(l.from.stop, at); at = l.to.stop; }
      }
      assert.ok(p.rides <= 4);
    }
  });
}

test('alternatives use different routes', () => {
  const plans = R.options({ lat: 51.4627, lon: -0.1145 }, { lat: 51.5392, lon: -0.1426 }, { clock: noon }).filter((p) => p.rides > 0);
  const sigs = new Set(plans.map((p) => p.legs.filter((l) => l.mode === 'bus').map((l) => (l as BusLeg).route).join('>')));
  assert.equal(sigs.size, plans.length);
  assert.ok(plans.length >= 2, 'offers an alternative');
});

test('banned routes are not used', () => {
  const plans = R.plan({ lat: 51.35815, lon: -0.09755 }, { lat: 51.3754, lon: -0.0927 }, { clock: noon, banned: new Set(['312']) });
  for (const p of plans) for (const l of p.legs) if (l.mode === 'bus') assert.notEqual(l.route, '312');
});

import { planTour } from '../src/router/raptor.ts';
test('multi-stop: best order beats the order given', () => {
  // start Brixton, stops given in a zig-zag order, finish Camden Town
  const pts = [
    { lat: 51.4627, lon: -0.1145, name: 'Brixton' },
    { lat: 51.5154, lon: -0.1419, name: 'Oxford Circus' },
    { lat: 51.4964, lon: -0.1432, name: 'Victoria' },
    { lat: 51.5308, lon: -0.1238, name: "King's Cross" },
    { lat: 51.5392, lon: -0.1426, name: 'Camden Town' },
  ];
  const dwell = [0, 900, 900, 900, 0];
  const asGiven = planTour(R, pts, dwell, { clock: noon, optimise: false });
  const best = planTour(R, pts, dwell, { clock: noon, optimise: true });
  assert.equal(best.order[0], 0); assert.equal(best.order[best.order.length - 1], 4);
  assert.equal(new Set(best.order).size, 5, 'every stop visited once');
  assert.ok(best.seconds <= asGiven.seconds + 60, `optimised ${Math.round(best.seconds / 60)} ≤ given ${Math.round(asGiven.seconds / 60)} min`);
  assert.equal(best.tried, 7, 'tried all 6 orders');
  assert.equal(best.segments.length, 4);
});
