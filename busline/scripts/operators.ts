// Who runs each route (Stagecoach, Arriva, Go-Ahead…). TfL's API doesn't publish this,
// so it comes from Wikipedia's "List of bus routes in London" (CC BY-SA 4.0).
// Output: public/data/operators.json  { generatedAt, source, routes: { "25": "Stagecoach London", … } }
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'operators.json');
const URL_ = 'https://en.wikipedia.org/w/api.php?action=parse&page=List_of_bus_routes_in_London&prop=wikitext&format=json&formatversion=2';

const unlink = (s: string) => s
  .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, '')
  .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
  .replace(/\{\{[^}]*\}\}/g, '').replace(/<br\s*\/?>/g, ' / ').replace(/'''?/g, '').replace(/\s+/g, ' ').trim();

export function parse(wikitext: string): Record<string, string> {
  const out: Record<string, string> = {};
  // only current TfL routes: stop before "Non-TfL" / "Former" sections
  const current = wikitext.split(/\n==\s*(Non-TfL|Former routes)/)[0];
  for (const table of current.split(/\n\{\|/).slice(1)) {
    const chunks = table.split(/\n\|\}/)[0].split('\n|-');
    const hi = chunks.findIndex((c) => /\n!/.test('\n' + c));
    if (hi < 0) continue;
    // header cells, expanding colspan (e.g. Superloop's colour + route)
    const cols: string[] = [];
    for (const m of ('\n' + chunks[hi]).matchAll(/\n!([^\n]*)/g)) {
      for (const cell of m[1].split('!!')) {
        const span = Number(cell.match(/colspan="?(\d+)/)?.[1] ?? 1);
        const label = unlink(cell.includes('|') ? cell.slice(cell.lastIndexOf('|') + 1) : cell).toLowerCase();
        for (let k = 0; k < span; k++) cols.push(label);
      }
    }
    const ri = cols.lastIndexOf('route') >= 0 ? cols.lastIndexOf('route') : cols.findIndex((c) => c.startsWith('route'));
    const oi = cols.findIndex((c) => c.startsWith('operator'));
    if (ri < 0 || oi < 0) continue;
    for (const row of chunks.slice(hi + 1)) {
      const cells = row.split('\n').filter((l) => l.startsWith('|') && !l.startsWith('|+')).flatMap((l) => l.slice(1).split('||'))
        .map((c) => (/^\s*(rowspan|colspan|style|class)=/.test(c) && c.includes('|') ? c.slice(c.indexOf('|') + 1) : /^\s*(style|class)=[^|]*$/.test(c) ? '' : c));
      if (cells.length <= Math.max(ri, oi)) continue;
      const route = unlink(cells[ri]).toUpperCase().replace(/\s+/g, '');
      const op = unlink(cells[oi]).replace(/ \/ /g, ' & ');
      if (/^[A-Z]{0,3}\d{1,3}[A-Z]?$/.test(route) && op && !out[route]) out[route] = op;
    }
  }
  return out;
}

async function main() {
  // OPERATORS_FILE: use a saved API response instead of fetching (Wikipedia rate-limits)
  const file = process.env.OPERATORS_FILE;
  const j = file ? JSON.parse((await import('node:fs')).readFileSync(file, 'utf8'))
    : await (await fetch(URL_, { headers: { 'User-Agent': 'busline-london/0.3 (open data pipeline)' } })).json();
  const routes = parse(j.parse?.wikitext ?? '');
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), source: 'Wikipedia: List of bus routes in London (CC BY-SA 4.0)', routes }));
  const counts = new Map<string, number>();
  for (const o of Object.values(routes)) counts.set(o, (counts.get(o) ?? 0) + 1);
  console.log(`operators: ${Object.keys(routes).length} routes;`, [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([o, n]) => `${o} ${n}`).join(', '));
}
if (import.meta.url === `file://${process.argv[1]}`) main();
