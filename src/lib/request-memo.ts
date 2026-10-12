// Loaders that several parts of a page ask for (the dashboard asks for the forecast three times, the
// summary for the fees four or five times), and that every user's pages ask for again, are worked out once
// and shared:
// - within one request (React's cache(), one server render);
// - across requests and users, until the data changes: every committed save (db/index.ts) calls
//   dataChanged(), which drops everything kept; a result is kept at most DATA_TTL_MS, and only the last
//   DATA_MAX results, as a safety net (e.g. a script writing on its own).
// Each caller gets its own copy of a shared result, so one changing it can't affect another.
// scripts/figures.ts sets `scriptScope.map` to share results across a whole run of loaders, so the
// before/after comparison also covers the sharing (a loader that changed a shared result would show).
import { cache } from 'react';

export const scriptScope: { map: Map<string, unknown> | null } = { map: null };

const DATA_TTL_MS = 60_000;
const DATA_MAX = 60;
// unit tests mock the database: nothing is kept between them
const enabled = process.env.NODE_ENV !== 'test' && process.env.DATA_CACHE !== 'off';

type Entry = { gen: number; at: number; p: Promise<unknown> };
const g = globalThis as unknown as { __dataCache?: { gen: number; entries: Map<string, Entry> } };
// one store per server process (kept across hot reloads in development)
const store = (g.__dataCache ??= { gen: 0, entries: new Map() });

/** The data changed (a save committed, here or in another app instance): nothing kept is used again. */
export function dataChanged() {
  store.gen++;
  store.entries.clear();
}

// started when something is first kept (db/index.ts: listening for other instances' changes)
let starter: (() => void) | null = null;
export function onFirstCacheUse(fn: () => void) {
  starter = fn;
}

function shared<T>(k: string, compute: () => Promise<T>): Promise<T> {
  if (!enabled) return compute();
  if (starter) {
    starter();
    starter = null;
  }
  const now = Date.now();
  const e = store.entries.get(k);
  if (e && e.gen === store.gen && now - e.at < DATA_TTL_MS) {
    // most recently used last
    store.entries.delete(k);
    store.entries.set(k, e);
    return e.p as Promise<T>;
  }
  // the generation is taken before the data is read: a save committing meanwhile makes this result stale
  const entry: Entry = { gen: store.gen, at: now, p: compute() };
  store.entries.set(k, entry);
  entry.p.catch(() => {
    if (store.entries.get(k) === entry) store.entries.delete(k);
  });
  while (store.entries.size > DATA_MAX) store.entries.delete(store.entries.keys().next().value!);
  return entry.p as Promise<T>;
}

export function perRequest<A extends unknown[], T>(name: string, key: (...args: A) => string, fn: (...args: A) => Promise<T>) {
  const box = cache((k: string) => ({ k, p: undefined as Promise<T> | undefined }));
  return async (...args: A): Promise<T> => {
    const k = `${name}|${key(...args)}`;
    if (scriptScope.map) {
      if (!scriptScope.map.has(k)) scriptScope.map.set(k, fn(...args));
      return structuredClone(await (scriptScope.map.get(k) as Promise<T>));
    }
    const b = box(k);
    return structuredClone(await (b.p ??= shared(k, () => fn(...args))));
  };
}
