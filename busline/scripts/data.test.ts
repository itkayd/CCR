// Acceptance checks on the generated data. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAME_OK, cleanName } from '../src/lib/names.ts';
import { formatModes } from '../src/lib/modes.ts';
import { MAP_BG_DARK, MAP_BG_LIGHT, contrast, deltaOk } from '../src/lib/colour.ts';
import { MIN_SEP } from './lib/spread.ts';
import { distM } from './lib/geo.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const hubs: any[] = JSON.parse(readFileSync(join(dir, 'hubs.json'), 'utf8'));
const routes: any[] = JSON.parse(readFileSync(join(dir, 'routes.json'), 'utf8'));
const majors = hubs.filter((h) => h.major);
const hubById = new Map(hubs.map((h) => [h.id, h]));

test('cleanName', () => {
  assert.equal(cleanName('.Russell Square'), 'Russell Square');
  assert.equal(cleanName('  St. Paul\'s   Cathedral, '), "St Paul's Cathedral");
  assert.equal(cleanName('St.Mary\'s'), "St Mary's");
  assert.equal(cleanName('Whitechapel Stn  /Royal London Hosp'), 'Whitechapel Stn / Royal London Hosp');
  assert.equal(cleanName("Queen's Park (Kilburn)"), "Queen's Park (Kilburn)");
});

test('no stop, station or terminus name starts with a non-letter/digit', () => {
  const names = [...hubs.map((h) => h.name), ...routes.flatMap((r) => [r.a, r.b])];
  const bad = names.filter((n) => !NAME_OK.test(n) || /\s{2}|\bSt\./.test(n));
  assert.deepEqual(bad, []);
});

test('interchange modes format as display names', () => {
  assert.equal(
    formatModes(['national-rail', 'dlr', 'tube', 'overground', 'elizabeth-line']),
    'Elizabeth line · Tube · Overground · DLR · National Rail',
  );
});

test('every major station on a route is on its line', () => {
  for (const r of routes) for (const v of r.via) assert.ok(r.path.includes(v) && hubById.get(v)?.major, `${r.id} via ${v}`);
});

test('no two major markers overlap at Fit on a 390 px phone', () => {
  let worst = Infinity, pair = '';
  for (let i = 0; i < majors.length; i++)
    for (let j = i + 1; j < majors.length; j++) {
      const d = Math.hypot(majors[i].x - majors[j].x, majors[i].y - majors[j].y);
      if (d < worst) { worst = d; pair = `${majors[i].name} / ${majors[j].name}`; }
    }
  assert.ok(worst >= MIN_SEP - 0.2, `closest majors ${pair}: ${worst.toFixed(1)} < ${MIN_SEP.toFixed(1)}`);
});

test('neighbouring majors (≤ 3 km) differ by OKLab ΔE ≥ 12', () => {
  const bad: string[] = [];
  for (let i = 0; i < majors.length; i++)
    for (let j = i + 1; j < majors.length; j++)
      if (distM(majors[i], majors[j]) <= 3000 && deltaOk(majors[i].colour, majors[j].colour) < 0.12)
        bad.push(`${majors[i].name}/${majors[j].name}`);
  assert.deepEqual(bad, []);
});

test('every major colour has ≥ 3:1 contrast on light and dark maps', () => {
  for (const m of majors) {
    assert.ok(contrast(m.colour, MAP_BG_LIGHT) >= 3, `${m.name} light`);
    assert.ok(contrast(m.colour, MAP_BG_DARK) >= 3, `${m.name} dark`);
  }
});
