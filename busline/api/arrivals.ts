// GET /api/arrivals?ids=490007670N,490007670S  → live predictions, soonest first.
import { clean, json, tfl } from './_tfl.js';
import { cached } from './_cache.js';

interface TflArrival {
  naptanId: string; lineId: string; lineName: string; direction: string;
  destinationName: string; towards: string; timeToStation: number; vehicleId: string; expectedArrival: string;
}

const ID = /^[0-9A-Z]{6,16}$/i;

export async function GET(request: Request): Promise<Response> {
  const ids = (new URL(request.url).searchParams.get('ids') ?? '').split(',').filter((s) => ID.test(s)).slice(0, 14);
  if (!ids.length) return json({ error: 'ids required' }, 400);
  const results = await Promise.allSettled(ids.map((id) => cached(`arr:${id}`, 15_000, () => tfl<TflArrival[]>(`/StopPoint/${id}/Arrivals`))));
  const arrivals = results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .map((a) => ({
      stop: a.naptanId,
      line: a.lineName.toUpperCase(),
      dir: a.direction,
      dest: clean(a.destinationName),
      eta: a.timeToStation,
      at: a.expectedArrival,
      vehicle: a.vehicleId,
    }))
    .sort((a, b) => a.eta - b.eta);
  const failed = results.filter((r) => r.status === 'rejected').length;
  return json({ generatedAt: new Date().toISOString(), failed, arrivals });
}
