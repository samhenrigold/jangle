type CacheEntry<T> = { value: T; expiresAt: number };

// Per-isolate memoization only (Cloudflare isolates are ephemeral and per-PoP;
// the durable layer is the edge s-maxage cache). Expiry was previously checked
// only lazily on get, so high-cardinality keys (app:<param>, icons:oldest:<ids>)
// that are never re-requested were never reclaimed and a long-lived isolate grew
// unbounded. Bound the map and evict least-recently-used on overflow. A Map keeps
// insertion order, so re-inserting on access moves the key to the newest slot and
// the oldest key is always first.
const MAX_ENTRIES = 500;

const store = new Map<string, CacheEntry<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  // Mark as most-recently-used.
  store.delete(key);
  store.set(key, entry);
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  // Re-insert at the newest position, then evict from the oldest end if over cap.
  store.delete(key);
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}


