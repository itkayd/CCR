// Fetch each route's timetable from the first stop of each direction (cached in scripts/.cache).
// Gives stop-to-stop running times (stationIntervals) and departures (for headways).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tfl } from './lib/http.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'public', 'data', 'r');

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
  console.log('timetables done');
}
main();
