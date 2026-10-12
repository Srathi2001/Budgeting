// Scripts only (import after allow-server-only): lets a script call page loaders and route handlers outside
// a Next request. cookies() and headers() read what setRequestCookies() set; revalidatePath/Tag do nothing.
// Also counts database round trips, and with SIM_LATENCY_MS adds that much delay to each one (to imitate a
// database across the network, e.g. Azure). Never imported by the app.
import Module from 'node:module';
import { Client } from 'pg';

const jar = new Map<string, string>();
export function setRequestCookies(c: Record<string, string | undefined>) {
  jar.clear();
  for (const [k, v] of Object.entries(c)) if (v !== undefined) jar.set(k, v);
}

const store = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  has: (name: string) => jar.has(name),
  set: (name: string, value: string | { value: string }) => {
    jar.set(name, typeof value === 'string' ? value : value.value);
    return store;
  },
  delete: (name: string) => {
    jar.delete(name);
    return store;
  },
};
const fakeHeaders = { cookies: async () => store, headers: async () => new Headers(), draftMode: async () => ({ isEnabled: false }) };
const noop = () => {};
const fakeCache = { revalidatePath: noop, revalidateTag: noop, updateTag: noop, refresh: noop, cacheTag: noop, cacheLife: noop, unstable_noStore: noop };

const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const load = M._load;
M._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === 'next/headers') return fakeHeaders;
  if (request === 'next/cache') return { ...(load.call(this, request, ...rest) as object), ...fakeCache };
  return load.call(this, request, ...rest);
};

// round trips: every query of every pooled client
export const queryStats = { count: 0 };
const latency = Number(process.env.SIM_LATENCY_MS ?? 0);
const proto = Client.prototype as unknown as { query: (...a: unknown[]) => unknown };
const query = proto.query;
proto.query = function (this: unknown, ...args: unknown[]) {
  queryStats.count++;
  if (!latency) return query.apply(this, args);
  // pool.query passes a callback and ignores the return value
  if (typeof args[args.length - 1] === 'function') {
    setTimeout(() => query.apply(this, args), latency);
    return undefined;
  }
  return new Promise((r) => setTimeout(r, latency)).then(() => query.apply(this, args));
};
