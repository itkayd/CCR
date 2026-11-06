// Geographic helpers for the pipeline.
export interface LatLon { lat: number; lon: number }

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Compass bearing in degrees (0 = north, clockwise). */
export function bearing(from: LatLon, to: LatLon): number {
  const y = Math.sin(rad(to.lon - from.lon)) * Math.cos(rad(to.lat));
  const x = Math.cos(rad(from.lat)) * Math.sin(rad(to.lat)) - Math.sin(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.cos(rad(to.lon - from.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export const CENTRE: LatLon = { lat: 51.5073, lon: -0.1276 }; // Charing Cross

/** Local metres east/north of Charing Cross (equirectangular; fine at city scale). */
export function toMetres(lat: number, lon: number): [number, number] {
  const x = rad(lon - CENTRE.lon) * R * Math.cos(rad(CENTRE.lat));
  const y = rad(lat - CENTRE.lat) * R;
  return [x, y];
}

/**
 * Schematic pre-projection: metres → map units (y down), with a radial fisheye
 * r' = k·ln(1 + r/k) that gives Zones 1–2 roughly twice the room of the suburbs.
 * One unit ≈ 100 m at the centre.
 */
export const FISHEYE_K = 8000;
export function project(lat: number, lon: number): [number, number] {
  const [mx, my] = toMetres(lat, lon);
  const r = Math.hypot(mx, my);
  const s = r === 0 ? 1 : (FISHEYE_K * Math.log1p(r / FISHEYE_K)) / r;
  return [(mx * s) / 100, (-my * s) / 100];
}
