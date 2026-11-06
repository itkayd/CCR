// Step 1: download everything the pipeline needs into scripts/.cache.
// Re-runs only fetch what is missing. Delete scripts/.cache to force a full refresh.
import { hasKey, tfl } from './lib/http.ts';

export const RAIL_MODES = ['tube', 'dlr', 'overground', 'elizabeth-line', 'tram', 'national-rail'];

async function main() {
  console.log(`TfL fetch (${hasKey() ? 'with app key' : 'anonymous: slower pacing; set TFL_APP_KEY in .env to speed up'})`);

  const lines = (await tfl<any[]>('/Line/Mode/bus'))!;
  console.log(`bus routes: ${lines.length}`);
  // One request gives TfL's own origin/destination names for every route section.
  await tfl('/Line/Mode/bus/Route?serviceTypes=Regular');

  const railLines = (await tfl<any[]>(`/Line/Mode/${RAIL_MODES.join(',')}`))!;
  console.log(`rail lines: ${railLines.length}`);
  for (const l of railLines) await tfl(`/Line/${l.id}/Route/Sequence/outbound`, { allow404: true });

  let n = 0;
  for (const l of lines) {
    for (const dir of ['outbound', 'inbound']) {
      await tfl(`/Line/${l.id}/Route/Sequence/${dir}`, { allow404: true });
    }
    if (++n % 25 === 0) console.log(`  ${n}/${lines.length} routes`);
  }
  console.log('fetch done');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
