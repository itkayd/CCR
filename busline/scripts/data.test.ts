// Acceptance checks on the generated data. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAME_OK, cleanName } from '../src/lib/names.ts';
import { formatModes } from '../src/lib/modes.ts';
import { MAP_BG_LIGHT, NEUTRAL, VISIONS, contrast, deltaOk, hexToRgb, rgbToOklab, simulate } from '../src/lib/colour.ts';
import { TRAM_COLOUR } from '../src/lib/data.ts';
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

test('neighbouring majors (≤ 3 km) look clearly different (OKLab ΔE ≥ 7)', () => {
  const bad: string[] = [];
  for (let i = 0; i < majors.length; i++)
    for (let j = i + 1; j < majors.length; j++)
      if (distM(majors[i], majors[j]) <= 3000 && deltaOk(majors[i].colour, majors[j].colour) < 0.07)
        bad.push(`${majors[i].name}/${majors[j].name}`);
  assert.deepEqual(bad, []);
});

test('colour-blind riders: no two neighbouring majors look the same (ΔE ≥ 4 with protanopia, deuteranopia, tritanopia)', () => {
  const bad: string[] = [];
  for (let i = 0; i < majors.length; i++)
    for (let j = i + 1; j < majors.length; j++) {
      if (distM(majors[i], majors[j]) > 3000) continue;
      for (const v of VISIONS) if (deltaOk(simulate(majors[i].colour, v), simulate(majors[j].colour, v)) < 0.04) bad.push(`${v}: ${majors[i].name}/${majors[j].name}`);
    }
  assert.deepEqual(bad, []);
});

test('white route numbers are readable on every route colour (WCAG AA 4.5:1), and colours are soft', () => {
  for (const m of majors) {
    assert.ok(contrast(m.colour, '#FFFFFF') >= 4.5, `${m.name} ${m.colour} white text`);
    assert.ok(contrast(m.colour, MAP_BG_LIGHT) >= 3, `${m.name} on the light map`);
    const [, a, b] = rgbToOklab(hexToRgb(m.colour));
    assert.ok(Math.hypot(a, b) <= 0.19, `${m.name} ${m.colour} is too saturated`);
  }
  for (const c of [NEUTRAL, TRAM_COLOUR, '#C9362A', '#1F62D3']) assert.ok(contrast(c, '#FFFFFF') >= 4.5, `${c} white text`);
});
