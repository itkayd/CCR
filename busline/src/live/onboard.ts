// Live trip tracking: where am I on my journey, right now?
//
// Given the trip's legs and the phone's position, find the bus/tram leg and the
// stop you're at (nearest stop within MATCH_M), never going backwards, and turn
// that into: walk to the stop / now at X, next Y, N stops to go / get off next /
// arrived.

export interface TrackStop { id: string; name: string; lat: number; lon: number }
export interface TrackLeg { mode: 'bus' | 'walk'; line: string | null; stopList: TrackStop[]; to: { name: string; lat: number; lon: number }; minutes: number }
export interface Progress { leg: number; stop: number; offRoute: boolean; arrived: boolean }

const MATCH_M = 180, ARRIVE_M = 120, OFF_ROUTE_M = 450;
const K = Math.PI / 180;
export const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((b.lon - a.lon) * K * Math.cos(((a.lat + b.lat) / 2) * K), (b.lat - a.lat) * K) * 6371000;

export const START: Progress = { leg: 0, stop: -1, offRoute: false, arrived: false };

export function track(legs: TrackLeg[], me: { lat: number; lon: number }, prev: Progress = START): Progress {
  const last = legs[legs.length - 1];
  if (last && metres(me, last.to) < ARRIVE_M) return { ...prev, leg: legs.length - 1, arrived: true, offRoute: false };
  let best: { leg: number; stop: number; d: number } | null = null;
  for (let li = prev.leg; li < legs.length; li++) {
    const l = legs[li];
    if (l.mode !== 'bus') continue;
    // the stop you board at doesn't mean you're on the bus: start matching from the stop after it
    const from = li === prev.leg ? Math.max(1, prev.stop) : 1;
    for (let si = from; si < l.stopList.length; si++) {
      const d = metres(me, l.stopList[si]);
      // prefer the earliest leg that matches; within it, the nearest stop
      if (d < MATCH_M && (!best || (li === best.leg && d < best.d))) best = { leg: li, stop: si, d };
    }
    if (best) break;
  }
  if (best) {
    // reached the end of a ride: move on to the next leg
    const l = legs[best.leg];
    if (best.stop === l.stopList.length - 1 && best.leg < legs.length - 1) return { leg: best.leg + 1, stop: -1, offRoute: false, arrived: false };
    return { leg: best.leg, stop: best.stop, offRoute: false, arrived: false };
  }
  // nothing close: are we anywhere near the trip at all?
  const near = legs.some((l) => (l.mode === 'bus' ? l.stopList : [l.to]).some((s) => metres(me, s) < OFF_ROUTE_M));
  return { ...prev, offRoute: !near };
}

export interface View {
  phase: 'walk' | 'wait' | 'ride' | 'alight' | 'arrived';
  line: string | null;
  now?: string; next?: string; alightAt?: string;
  stopsLeft: number; minutesLeft: number; distanceM?: number; target?: string;
  fraction: number; // 0..1 progress through the current ride
}

export function view(legs: TrackLeg[], p: Progress, me: { lat: number; lon: number }): View {
  if (p.arrived) return { phase: 'arrived', line: null, stopsLeft: 0, minutesLeft: 0, fraction: 1 };
  // next bus/tram leg from here
  let li = p.leg;
  while (li < legs.length && legs[li].mode !== 'bus') li++;
  const l = legs[li];
  if (!l) {
    const end = legs[legs.length - 1].to;
    return { phase: 'walk', line: null, target: end.name, distanceM: Math.round(metres(me, end)), stopsLeft: 0, minutesLeft: Math.round(metres(me, end) / 80), fraction: 1 };
  }
  const onBoard = li === p.leg && p.stop >= 0;
  if (!onBoard) {
    const board = l.stopList[0];
    const d = metres(me, board);
    return { phase: d < 60 ? 'wait' : 'walk', line: l.line, target: board.name, distanceM: Math.round(d), alightAt: l.stopList[l.stopList.length - 1].name, stopsLeft: l.stopList.length - 1, minutesLeft: l.minutes, fraction: 0 };
  }
  const total = l.stopList.length - 1;
  const left = total - p.stop;
  const perStop = l.minutes / Math.max(1, total);
  return {
    phase: left <= 1 ? 'alight' : 'ride',
    line: l.line,
    now: l.stopList[p.stop].name,
    next: l.stopList[Math.min(total, p.stop + 1)].name,
    alightAt: l.stopList[total].name,
    stopsLeft: left, minutesLeft: Math.max(1, Math.round(left * perStop)), fraction: p.stop / Math.max(1, total),
  };
}
