// GET /api/journey?from=51.35,-0.09&to=51.54,-0.002  (or to=<postcode>)
// → up to 4 bus journeys, fastest first, with each leg's line, stops and path.
import { clean, json, tfl } from './_tfl.js';

interface Point { commonName: string; naptanId?: string; stopLetter?: string; lat: number; lon: number }
interface Leg {
  duration: number; departureTime: string; arrivalTime: string;
  mode: { id: string }; instruction: { summary: string };
  routeOptions?: { name: string; directions?: string[] }[];
  departurePoint: Point; arrivalPoint: Point;
  path: { lineString?: string; stopPoints?: { name: string }[] };
}
interface TflJourney { duration: number; startDateTime: string; arrivalDateTime: string; legs: Leg[] }

const LATLON = /^-?\d{1,2}\.\d+,-?\d{1,3}\.\d+$/;
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

function path(ls?: string): [number, number][] {
  if (!ls) return [];
  try {
    const pts = (JSON.parse(ls) as [number, number][]).map(([lat, lon]) => [r5(lon), r5(lat)] as [number, number]);
    // thin long paths: keep every nth point (map only needs the shape)
    const step = Math.max(1, Math.floor(pts.length / 400));
    return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  } catch { return []; }
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const from = (q.get('from') ?? '').replace(/\s+/g, ''), to = (q.get('to') ?? '').trim();
  const ok = (s: string) => LATLON.test(s.replace(/\s+/g, '')) || POSTCODE.test(s);
  if (!ok(from) || !ok(to)) return json({ error: 'from/to must be "lat,lon" or a postcode' }, 400);
  try {
    const data = await tfl<{ journeys?: TflJourney[] }>(
      `/Journey/JourneyResults/${encodeURIComponent(from)}/to/${encodeURIComponent(to.replace(/\s+/g, ''))}`,
      { mode: 'bus,walking', journeyPreference: 'leasttime', alternativeWalking: 'false' },
    );
    const journeys = (data.journeys ?? [])
      .filter((j) => j.legs.some((l) => l.mode.id === 'bus'))
      .sort((a, b) => a.duration - b.duration)
      .slice(0, 4)
      .map((j) => ({
        duration: j.duration, start: j.startDateTime, arrive: j.arrivalDateTime,
        legs: j.legs.map((l) => ({
          mode: l.mode.id, duration: l.duration, dep: l.departureTime, arr: l.arrivalTime,
          line: l.routeOptions?.[0]?.name?.toUpperCase() ?? null,
          towards: clean(l.routeOptions?.[0]?.directions?.[0]?.replace(/ \(.*\)$/, '')),
          summary: clean(l.instruction.summary),
          from: { name: clean(l.departurePoint.commonName), letter: (l.departurePoint.stopLetter ?? '').replace(/^->/, '→'), lat: l.departurePoint.lat, lon: l.departurePoint.lon },
          to: { name: clean(l.arrivalPoint.commonName), lat: l.arrivalPoint.lat, lon: l.arrivalPoint.lon },
          stops: l.path.stopPoints?.length ?? 0,
          path: path(l.path.lineString),
        })),
      }));
    const res = json({ journeys });
    res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
    return res;
  } catch (e) {
    return json({ error: String((e as Error).message) }, 502);
  }
}
