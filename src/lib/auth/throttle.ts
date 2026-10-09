// Sign-in throttling: a small in-memory limiter per account and per address, enough to blunt password
// guessing on a single server. A hosted multi-instance deployment should move this to the database or a
// shared cache (see the SaaS plan); the interface stays the same.

export interface ThrottleRule {
  /** failures allowed inside the window before the key is held */
  max: number;
  /** window length in ms */
  windowMs: number;
  /** how long a key is held once over the limit, in ms */
  holdMs: number;
}

export const ACCOUNT_RULE: ThrottleRule = { max: 5, windowMs: 15 * 60_000, holdMs: 15 * 60_000 };
export const ADDRESS_RULE: ThrottleRule = { max: 50, windowMs: 15 * 60_000, holdMs: 15 * 60_000 };

interface Entry {
  failures: number[];
  heldUntil: number;
}

export class Throttle {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly rule: ThrottleRule) {}

  /** ms the key is still held for (0 = allowed) */
  heldFor(key: string, now = Date.now()): number {
    const e = this.entries.get(key);
    if (!e) return 0;
    return e.heldUntil > now ? e.heldUntil - now : 0;
  }

  /** records a failed attempt; returns the hold in ms it caused (0 = none yet) */
  fail(key: string, now = Date.now()): number {
    const e = this.entries.get(key) ?? { failures: [], heldUntil: 0 };
    e.failures = e.failures.filter((t) => now - t < this.rule.windowMs);
    e.failures.push(now);
    if (e.failures.length >= this.rule.max) {
      e.heldUntil = now + this.rule.holdMs;
      e.failures = [];
    }
    this.entries.set(key, e);
    this.prune(now);
    return e.heldUntil > now ? e.heldUntil - now : 0;
  }

  /** a successful sign-in clears the key */
  succeed(key: string) {
    this.entries.delete(key);
  }

  private prune(now: number) {
    if (this.entries.size < 10_000) return;
    for (const [k, e] of this.entries) if (e.heldUntil <= now && !e.failures.some((t) => now - t < this.rule.windowMs)) this.entries.delete(k);
  }
}

const globalForThrottle = globalThis as unknown as { loginThrottle?: { account: Throttle; address: Throttle } };
/** one limiter per process (survives hot reloads in development) */
export const loginThrottle = globalForThrottle.loginThrottle ?? { account: new Throttle(ACCOUNT_RULE), address: new Throttle(ADDRESS_RULE) };
globalForThrottle.loginThrottle = loginThrottle;

export const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
