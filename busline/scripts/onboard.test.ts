// Live trip tracking checks. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { START, track, view, type TrackLeg } from '../src/live/onboard.ts';

// a straight bus ride north through 5 stops ~400 m apart, then a short walk
const stops = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: `Stop ${i}`, lat: 51.50 + i * 0.0036, lon: -0.1 }));
const legs: TrackLeg[] = [
  { mode: 'walk', line: null, stopList: [], to: { name: 'Stop 0', lat: stops[0].lat, lon: stops[0].lon }, minutes: 2 },
  { mode: 'bus', line: '25', stopList: stops, to: { name: 'Stop 4', lat: stops[4].lat, lon: stops[4].lon }, minutes: 8 },
  { mode: 'walk', line: null, stopList: [], to: { name: 'Cafe', lat: stops[4].lat + 0.003, lon: -0.1 }, minutes: 4 },
];

test('walking to the first stop', () => {
  const p = track(legs, { lat: 51.4985, lon: -0.1 });
  const v = view(legs, p, { lat: 51.4985, lon: -0.1 });
  assert.equal(v.phase, 'walk'); assert.equal(v.target, 'Stop 0'); assert.ok(v.distanceM! > 100 && v.distanceM! < 200);
});

test('riding: now, next and stops left; never goes backwards', () => {
  let p = track(legs, stops[1], START);
  let v = view(legs, p, stops[1]);
  assert.equal(v.phase, 'ride'); assert.equal(v.now, 'Stop 1'); assert.equal(v.next, 'Stop 2'); assert.equal(v.stopsLeft, 3);
  p = track(legs, stops[2], p);
  p = track(legs, stops[1], p); // GPS jitter back towards an earlier stop
  assert.equal(p.stop, 2, 'stays at the furthest stop reached');
});

test('get off at the next stop, then walk on, then arrive', () => {
  let p = track(legs, stops[3], START);
  assert.equal(view(legs, p, stops[3]).phase, 'alight');
  p = track(legs, stops[4], p);
  assert.equal(p.leg, 2, 'moves on to the walk after the last stop');
  const cafe = { lat: stops[4].lat + 0.003, lon: -0.1 };
  assert.equal(track(legs, cafe, p).arrived, true);
});

test('off route is flagged', () => {
  const p = track(legs, { lat: 51.6, lon: 0.1 }, START);
  assert.equal(p.offRoute, true);
});

test('waiting at the boarding stop is not riding', () => {
  const p = track(legs, stops[0], START);
  assert.equal(view(legs, p, stops[0]).phase, 'wait');
});
