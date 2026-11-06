// Shared helper for the serverless functions. TFL_APP_KEY stays on the server.
const BASE = 'https://api.tfl.gov.uk';

export async function tfl<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const key = process.env.TFL_APP_KEY;
  if (key) url.searchParams.set('app_key', key);
  const res = await fetch(url, { headers: { 'User-Agent': 'busline-london/0.2' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`TfL ${res.status}`);
  return res.json() as Promise<T>;
}

/** JSON response, cached at the edge for 20 s (spec: 20 s caching). */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, s-maxage=20, stale-while-revalidate=10' : 'no-store',
    },
  });
}

export const clean = (s: string | undefined) =>
  (s ?? '').replace(/\bSt\./g, 'St').replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N})]+$/u, '').trim();
