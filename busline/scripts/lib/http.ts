// Cached, throttled, retrying GET against the TfL Unified API.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = join(here, '..', '.cache');
const BASE = 'https://api.tfl.gov.uk';

loadDotEnv(join(here, '..', '..', '.env'));
const APP_KEY = process.env.TFL_APP_KEY;
// With a key TfL allows ~500 req/min; anonymous is far stricter.
const MIN_GAP_MS = Number(process.env.TFL_MIN_GAP_MS) || (APP_KEY ? 160 : 1300);

function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

let last = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function slot() {
  const now = Date.now();
  const wait = Math.max(0, last + MIN_GAP_MS - now);
  last = now + wait;
  if (wait) await sleep(wait);
}

export function cachePath(path: string) {
  const safe = path.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 80);
  const h = createHash('sha1').update(path).digest('hex').slice(0, 8);
  return join(CACHE_DIR, `${safe}_${h}.json`);
}

/** GET a TfL path (e.g. "/Line/Mode/bus"). Cached on disk forever; delete .cache to refresh. */
export async function tfl<T = any>(path: string, { allow404 = false } = {}): Promise<T | null> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = cachePath(path);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));

  const url = new URL(BASE + path);
  if (APP_KEY) url.searchParams.set('app_key', APP_KEY);

  for (let attempt = 0; attempt < 6; attempt++) {
    await slot();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'busline-london-data/0.1' } });
      if (res.status === 404 && allow404) {
        writeFileSync(file, 'null');
        return null;
      }
      if (res.status === 429 || res.status >= 500) {
        const backoff = 2000 * 2 ** attempt;
        console.warn(`  ${res.status} on ${path}, retrying in ${backoff / 1000}s`);
        await sleep(backoff);
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
      const text = await res.text();
      writeFileSync(file, text);
      return JSON.parse(text);
    } catch (err: any) {
      if (attempt === 5 || /^\d{3} /.test(err.message)) throw err;
      const backoff = 2000 * 2 ** attempt;
      console.warn(`  ${err.message} on ${path}, retrying in ${backoff / 1000}s`);
      await sleep(backoff);
    }
  }
  throw new Error(`gave up on ${path}`);
}

export function hasKey() {
  return Boolean(APP_KEY);
}
