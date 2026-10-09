import { describe, expect, it } from 'vitest';
import { Throttle } from './throttle';

describe('sign-in throttle', () => {
  it('holds a key after the allowed failures inside the window', () => {
    const t = new Throttle({ max: 3, windowMs: 1000, holdMs: 5000 });
    expect(t.fail('a', 0)).toBe(0);
    expect(t.fail('a', 100)).toBe(0);
    expect(t.fail('a', 200)).toBe(5000);
    expect(t.heldFor('a', 1000)).toBe(4200);
    expect(t.heldFor('a', 5300)).toBe(0);
  });
  it('forgets failures outside the window and clears on success', () => {
    const t = new Throttle({ max: 2, windowMs: 1000, holdMs: 5000 });
    t.fail('b', 0);
    expect(t.fail('b', 2000)).toBe(0);
    t.fail('c', 0);
    t.succeed('c');
    expect(t.fail('c', 10)).toBe(0);
  });
});
