// A single in-memory read cache for the browser. Mutations and live events
// invalidate resource groups; older requests then join the current read.
export function createRequestCache({ getScope, now = Date.now, maxAge = 1000, maxEntries = 200 }) {
  const entries = new Map();
  const writes = new Set();
  function read(key, load, { tags = [], fresh = false } = {}) {
    const scope = getScope();
    const scopedKey = `${scope}:${key}`;
    for (const [oldKey, entry] of entries) {
      if (!entry.pending && now() >= entry.expiresAt) entries.delete(oldKey);
    }
    const existing = entries.get(scopedKey);
    if (existing?.pending) return existing.pending;
    if (existing && !fresh) return Promise.resolve(existing.data);
    const entry = { scope, tags, pending: null, data: null, expiresAt: 0 };
    entries.set(scopedKey, entry);
    entry.pending = Promise.resolve().then(load).then((data) => {
      if (scope !== getScope()) {
        const error = new Error("The account changed while loading this page.");
        error.name = "AbortError";
        throw error;
      }
      if (entries.get(scopedKey) !== entry) return read(key, load, { tags });
      entry.pending = null;
      entry.data = data;
      entry.expiresAt = now() + maxAge;
      // Never evict an in-flight request that another reader may be joining.
      for (const [oldKey, oldEntry] of entries) {
        if (entries.size <= maxEntries) break;
        if (!oldEntry.pending) entries.delete(oldKey);
      }
      return data;
    }).catch((error) => {
      if (entries.get(scopedKey) === entry) entries.delete(scopedKey);
      throw error;
    });
    return entry.pending;
  }
  return {
    read,
    beginWrite(tags) {
      let finish;
      const done = new Promise((resolve) => { finish = resolve; });
      const write = { tags, done };
      writes.add(write);
      return () => { writes.delete(write); finish(); };
    },
    async waitForWrites(tags) {
      let relevant;
      do {
        relevant = [...writes].filter((write) => !write.tags || write.tags.some((tag) => tags.includes(tag)));
        await Promise.all(relevant.map((write) => write.done));
      } while (relevant.length);
    },
    invalidate(tags) {
      for (const [key, entry] of entries) {
        if (!tags || entry.tags.some((tag) => tags.includes(tag))) entries.delete(key);
      }
    },
  };
}
