// GET /api/vehicle?id=LF73DYA → one bus's live progress: every stop it still has to call at.
import { clean, json, tfl } from './_tfl.js';
import { cached } from './_cache.js';

interface TflArrival { naptanId: string; stationName: string; lineName: string; destinationName: string; timeToStation: number; direction: string; platformName?: string }

export async function GET(request: Request): Promise<Response> {
  const id = (new URL(request.url).searchParams.get('id') ?? '').toUpperCase();
  if (!/^[A-Z0-9]{3,12}$/.test(id)) return json({ error: 'bad vehicle id' }, 400);
  try {
    const all = await cached(`veh:${id}`, 15_000, () => tfl<TflArrival[]>(`/Vehicle/${id}/Arrivals`));
    const stops = all
      .sort((a, b) => a.timeToStation - b.timeToStation)
      .filter((a, i, arr) => arr.findIndex((b) => b.naptanId === a.naptanId) === i)
      .map((a) => ({ stop: a.naptanId, name: clean(a.stationName), letter: (a.platformName ?? '').replace(/^->/, '→').slice(0, 3), eta: a.timeToStation }));
    const first = all[0];
    return json({ vehicle: id, line: first?.lineName?.toUpperCase() ?? null, dest: clean(first?.destinationName), dir: first?.direction ?? null, generatedAt: new Date().toISOString(), stops });
  } catch (e) {
    return json({ error: String((e as Error).message), stops: [] }, 502);
  }
}
