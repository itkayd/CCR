// Fetch each route's timetable from the first stop of each direction (cached in scripts/.cache).
// Gives stop-to-stop running times (stationIntervals) and departures (for headways).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tfl } from './lib/http.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'public', 'data', 'r');

export const altIndex = (n: number) => Math.min(n - 2, Math.max(1, Math.floor(n * 0.15)));
export function weekdayDepartures(tt: any): number {
  const scheds: any[] = tt?.timetable?.routes?.flatMap((r: any) => r.schedules) ?? [];
  return Math.max(0, ...scheds.filter((x) => !/saturday|sunday/i.test(x.name)).map((x) => x.knownJourneys?.length ?? 0));
}

async function main() {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  let n = 0;
  for (const f of files) {
    const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    for (const d of r.dirs) {
      const first = d.stops[0][0];
      await tfl(`/Line/${r.id.toLowerCase()}/Timetable/${first}?direction=${d.dir}`, { allow404: true }).catch((e) => console.warn(`  ${r.id} ${d.dir}: ${e.message}`));
    }
    if (++n % 50 === 0) console.log(`  ${n}/${files.length} routes`);
  }
  // second pass: where the first stop is a short school/depot extension (very few
  // departures), fetch again from a stop ~15% along the route for frequencies
  let alt = 0;
  for (const f of files) {
    const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    for (const d of r.dirs) {
      const tt = await tfl<any>(`/Line/${r.id.toLowerCase()}/Timetable/${d.stops[0][0]}?direction=${d.dir}`, { allow404: true }).catch(() => null);
      if (weekdayDepartures(tt) >= 10) continue;
      const k = altIndex(d.stops.length);
      if (k <= 0) continue;
      await tfl(`/Line/${r.id.toLowerCase()}/Timetable/${d.stops[k][0]}?direction=${d.dir}`, { allow404: true }).catch(() => null);
      alt++;
    }
  }
  console.log(`timetables done (${alt} re-fetched from further along the route)`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
