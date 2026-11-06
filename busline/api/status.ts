// GET /api/status?lines=60,312  (or no lines = every bus route with an issue)
// → diversions, closures and other notices from TfL's line status feed.
import { json, tfl } from './_tfl.js';

interface LineStatus {
  statusSeverity: number; statusSeverityDescription: string; reason?: string;
  validityPeriods?: { fromDate: string; toDate: string; isNow: boolean }[];
  disruption?: { category?: string; categoryDescription?: string; description?: string; affectedStops?: { naptanId?: string; id?: string }[] };
}
interface Line { id: string; lineStatuses: LineStatus[] }

const tidy = (s = '') => s.replace(/\s+/g, ' ').trim();

export async function GET(request: Request): Promise<Response> {
  const want = new Set((new URL(request.url).searchParams.get('lines') ?? '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean));
  try {
    // (detail=true takes ~40 s for every bus route; the plain feed already has reasons and dates)
    const all = await tfl<Line[]>('/Line/Mode/bus/Status', {}, 15000);
    const issues = all
      .filter((l) => !want.size || want.has(l.id.toUpperCase()))
      .flatMap((l) => l.lineStatuses
        .filter((s) => s.statusSeverity !== 10) // 10 = Good Service
        .map((s) => {
          const period = s.validityPeriods?.[0];
          return {
            line: l.id.toUpperCase(),
            status: s.statusSeverityDescription,
            kind: s.disruption?.categoryDescription ?? null,
            reason: tidy(s.reason ?? s.disruption?.description),
            from: period?.fromDate ?? null, to: period?.toDate ?? null,
            // TfL's isNow is unreliable; work it out from the dates
            now: !period || (Date.parse(period.fromDate) <= Date.now() && Date.now() <= Date.parse(period.toDate)),
            stops: (s.disruption?.affectedStops ?? []).map((x) => x.naptanId ?? x.id).filter(Boolean).slice(0, 80),
          };
        }))
      // the same notice is often listed once per line: keep one per line + reason
      .filter((x, i, a) => a.findIndex((y) => y.line === x.line && y.reason === x.reason) === i);
    const res = json({ generatedAt: new Date().toISOString(), issues });
    res.headers.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=60');
    return res;
  } catch (e) {
    return json({ error: String((e as Error).message), issues: [] }, 502);
  }
}
