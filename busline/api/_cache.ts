// Tiny in-memory cache with request coalescing, shared by everyone hitting the same
// warm function instance: 50 people at one stop = 1 TfL request per TTL.
const store = new Map<string, { at: number; p: Promise<unknown> }>();
export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p as Promise<T>;
  const p = load().catch((e) => { store.delete(key); throw e; });
  store.set(key, { at: Date.now(), p });
  if (store.size > 2000) for (const [k, v] of store) if (Date.now() - v.at > ttlMs * 4) store.delete(k);
  return p;
}
