// GET /api/nearby?lat=51.5&lon=-0.12  → bus stops within 400 m, nearest first.
import { clean, json, tfl } from './_tfl.js';

interface TflStop {
  modes?: string[];
  naptanId: string; commonName: string; stopLetter?: string; indicator?: string;
  lat: number; lon: number; distance: number;
  lines?: { id: string }[];
  additionalProperties?: { key: string; value: string }[];
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat - 51.5) > 1 || Math.abs(lon + 0.12) > 1.5)
    return json({ error: 'lat/lon must be in Greater London' }, 400);
  // ~100 m grid so nearby users share the edge cache
  const rlat = lat.toFixed(3), rlon = lon.toFixed(3);
  try {
    const data = await tfl<{ stopPoints: TflStop[] }>('/StopPoint', {
      lat: rlat, lon: rlon, stopTypes: 'NaptanPublicBusCoachTram,NaptanMetroStation', radius: '400', modes: 'bus,tram', returnLines: 'true',
    });
    const stops = data.stopPoints
      // metro stations only count when they are tram stops
      .filter((s) => !s.naptanId.startsWith('940') || (s.modes ?? []).includes('tram'))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 14)
      .map((s) => ({
        id: s.naptanId,
        name: clean(s.commonName.replace(/ Tram Stop$/, '')),
        tram: (s.modes ?? []).includes('tram'),
        letter: (s.stopLetter ?? s.indicator ?? '').replace(/^Stop\s+/i, '').replace(/^->/, '→'),
        towards: clean(s.additionalProperties?.find((p) => p.key === 'Towards')?.value),
        lat: s.lat, lon: s.lon,
        lines: (s.lines ?? []).filter((l) => (s.modes ?? []).includes('tram') || l.id !== 'tram').map((l) => l.id.toUpperCase()),
      }));
    return json({ lat: Number(rlat), lon: Number(rlon), stops });
  } catch (e) {
    return json({ error: String((e as Error).message) }, 502);
  }
}
