// Official route operators from the Traveline National Dataset (TNDS).
//
// TNDS publishes every bus timetable in Great Britain as TransXChange XML; the
// London region ("L") holds the TfL routes. Each file names its service's line
// (e.g. "25") and its operator, with the official National Operator Code.
//
// Usage:  TNDS_DIR=/path/to/unzipped/L npx tsx scripts/tnds.ts
// (download L.zip from TNDS with your free login and unzip it first)
//
// Output: public/data/operators.json with source TNDS, and a report of any
// route where TNDS and the previous (Wikipedia) list disagree.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'data', 'operators.json');
const REPORT = join(here, 'operators-diff.txt');

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.trim();
const all = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => ({ attrs: m[1], body: m[2] }));
const decode = (s = '') => s.replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** Operator brand names → the names riders know (TNDS often has legal names). */
const FRIENDLY: [RegExp, string][] = [
  [/go[- ]?ahead|london general|london central|metrobus|blue triangle/i, 'Go-Ahead London'],
  [/stagecoach|east london bus|selkent|thames transit/i, 'Stagecoach London'],
  [/metroline/i, 'Metroline'],
  [/arriva/i, 'Arriva London'],
  [/transport uk|london united|london sovereign|abellio|rati?p/i, 'Transport UK London Bus'],
  [/first/i, 'First Bus London'],
  [/uno/i, 'Uno'],
];
export const friendly = (n: string) => FRIENDLY.find(([re]) => re.test(n))?.[1] ?? n;

export interface TndsEntry { line: string; operator: string; noc?: string }

/** Parse one TransXChange document into line → operator. */
export function parseTxc(xml: string): TndsEntry[] {
  const ops = new Map<string, { name: string; noc?: string }>();
  for (const o of all(xml, 'Operator')) {
    const id = o.attrs.match(/id="([^"]+)"/)?.[1];
    if (!id) continue;
    const name = decode(tag(o.body, 'TradingName') ?? tag(o.body, 'OperatorShortName') ?? tag(o.body, 'OperatorNameOnLicence') ?? '');
    ops.set(id, { name, noc: tag(o.body, 'NationalOperatorCode') });
  }
  const out: TndsEntry[] = [];
  for (const svc of all(xml, 'Service')) {
    const ref = tag(svc.body, 'RegisteredOperatorRef');
    const op = (ref && ops.get(ref)) ?? [...ops.values()][0];
    if (!op?.name) continue;
    for (const l of all(svc.body, 'Line')) {
      const line = decode(tag(l.body, 'LineName') ?? '').toUpperCase().replace(/\s+/g, '');
      if (/^[A-Z]{0,3}\d{1,3}[A-Z]?$/.test(line)) out.push({ line, operator: friendly(op.name), noc: op.noc });
    }
  }
  return out;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.xml$/i.test(f) ? [p] : [];
  });
}

function main() {
  const dir = process.env.TNDS_DIR;
  if (!dir || !existsSync(dir)) { console.log('tnds: set TNDS_DIR to the unzipped London (L) folder; skipping'); return; }
  // a line can appear in several files (variants, school days): keep the most frequent operator
  const votes = new Map<string, Map<string, number>>();
  const nocs = new Map<string, string>();
  for (const f of files(dir)) {
    for (const e of parseTxc(readFileSync(f, 'utf8'))) {
      const v = votes.get(e.line) ?? votes.set(e.line, new Map()).get(e.line)!;
      v.set(e.operator, (v.get(e.operator) ?? 0) + 1);
      if (e.noc) nocs.set(`${e.line}|${e.operator}`, e.noc);
    }
  }
  const routes: Record<string, string> = {}, noc: Record<string, string> = {};
  for (const [line, v] of votes) {
    const op = [...v].sort((a, b) => b[1] - a[1])[0][0];
    routes[line] = op;
    const code = nocs.get(`${line}|${op}`);
    if (code) noc[line] = code;
  }
  if (Object.keys(routes).length < 300) { console.warn(`tnds: only ${Object.keys(routes).length} London routes found; keeping operators.json`); return; }

  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).routes ?? {} : {};
  const diff = Object.keys({ ...prev, ...routes }).sort()
    .filter((r) => prev[r] && routes[r] && prev[r] !== routes[r])
    .map((r) => `${r.padEnd(5)} previous: ${prev[r].padEnd(26)} TNDS: ${routes[r]}`);
  // keep previous entries for routes TNDS doesn't cover, but TNDS wins where both exist
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), source: 'Traveline National Dataset (TNDS), with Wikipedia for gaps', routes: { ...prev, ...routes }, noc }));
  writeFileSync(REPORT, (diff.length ? diff : ['TNDS and the previous list agree on every shared route.']).join('\n') + '\n');
  console.log(`tnds: ${Object.keys(routes).length} routes from ${votes.size ? 'TNDS' : '-'}; ${diff.length} differ from the previous list (see scripts/operators-diff.txt)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
