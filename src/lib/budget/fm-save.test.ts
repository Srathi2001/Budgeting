import { describe, expect, it } from 'vitest';
import { staffEditBlocked } from './fm-save';

describe('FM staff budget guard', () => {
  it('fixes the staff budget once any facility is submitted or approved', () => {
    expect(staffEditBlocked({ role: 'FM' }, ['DRAFT', 'RETURNED'])).toBeNull();
    expect(staffEditBlocked({ role: 'FM' }, ['DRAFT', 'SUBMITTED'])).toMatch(/1 facility is submitted or approved/);
    expect(staffEditBlocked({ role: 'FM' }, ['APPROVED', 'APPROVED', 'DRAFT'])).toMatch(/2 facilities are/);
  });
  it('holds Admin to the same rule: it returns the facilities first', () => {
    expect(staffEditBlocked({ role: 'ADMIN' }, ['DRAFT'])).toBeNull();
    expect(staffEditBlocked({ role: 'ADMIN' }, ['SUBMITTED'])).toMatch(/Admin returns them/);
  });
  it('leaves the staff budget to facilities management, not Finance or PMs', () => {
    expect(staffEditBlocked({ role: 'FINANCE' }, [])).toMatch(/entered by facilities management/);
    expect(staffEditBlocked({ role: 'PM' }, [])).toMatch(/entered by facilities management/);
  });
});
