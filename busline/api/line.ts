// GET /api/line?id=25  → live buses on a route: for each vehicle, the next stop it reaches.
import { clean, json, tfl } from './_tfl.js';
import { cached } from './_cache.js';

interface TflArrival { vehicleId: string; naptanId: string; direction: string; destinationName: string; timeToStation: number; stationName: string }

export async function GET(request: Request): Promise<Response> {
  const id = (new URL(request.url).searchParams.get('id') ?? '').toLowerCase();
  if (!/^[a-z]{0,3}\d{1,3}[a-z]?$/.test(id)) return json({ error: 'bad route id' }, 400);
  try {
    const all = await cached(`line:${id}`, 15_000, () => tfl<TflArrival[]>(`/Line/${id}/Arrivals`));
    const next = new Map<string, TflArrival>();
    for (const a of all) {
      const cur = next.get(a.vehicleId);
      if (!cur || a.timeToStation < cur.timeToStation) next.set(a.vehicleId, a);
    }
    const vehicles = [...next.values()].map((a) => ({
      vehicle: a.vehicleId, stop: a.naptanId, dir: a.direction, dest: clean(a.destinationName), eta: a.timeToStation,
    }));
    return json({ id: id.toUpperCase(), generatedAt: new Date().toISOString(), vehicles });
  } catch (e) {
    return json({ error: String((e as Error).message) }, 502);
  }
}
