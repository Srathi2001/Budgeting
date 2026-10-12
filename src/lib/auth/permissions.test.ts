import { describe, expect, it } from 'vitest';
import { entersData, isAdmin, isFinance } from './permissions';

const as = (role: 'ADMIN' | 'FINANCE' | 'PM' | 'FM', id = 1) => ({ id, name: role, email: `${role}@x`, role, coordinator: role === 'PM' ? 'RUCHI' : null });

describe('each department enters its own data; the rest is Admin', () => {
  it('PM, Finance and FM enter only their own inputs; Admin may enter any', () => {
    expect(entersData(as('PM'), 'PM')).toBe(true);
    expect(entersData(as('PM'), 'FIN')).toBe(false);
    expect(entersData(as('FINANCE'), 'FIN')).toBe(true);
    expect(entersData(as('FINANCE'), 'PM')).toBe(false);
    expect(entersData(as('FINANCE'), 'FM')).toBe(false);
    expect(entersData(as('FM'), 'FM')).toBe(true);
    expect(entersData(as('FM'), 'PM')).toBe(false);
    for (const o of ['PM', 'FIN', 'FM'] as const) expect(entersData(as('ADMIN'), o)).toBe(true);
  });
  it('controls are Admin only; Finance still sees everything', () => {
    expect(isAdmin(as('ADMIN'))).toBe(true);
    expect(isAdmin(as('FINANCE'))).toBe(false);
    expect(isFinance(as('FINANCE'))).toBe(true);
  });
});
