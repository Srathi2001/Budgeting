import { describe, expect, it } from 'vitest';
import { staffEditBlocked } from './fm-save';

describe('FM staff budget guard', () => {
  it('fixes the staff budget for FM once any facility is submitted or approved', () => {
    expect(staffEditBlocked({ role: 'FM' }, ['DRAFT', 'RETURNED'])).toBeNull();
    expect(staffEditBlocked({ role: 'FM' }, ['DRAFT', 'SUBMITTED'])).toMatch(/1 facility is submitted or approved/);
    expect(staffEditBlocked({ role: 'FM' }, ['APPROVED', 'APPROVED', 'DRAFT'])).toMatch(/2 facilities are/);
  });
  it('lets Finance change it (audited before and after)', () => {
    expect(staffEditBlocked({ role: 'FINANCE' }, ['APPROVED'])).toBeNull();
    expect(staffEditBlocked({ role: 'ADMIN' }, ['SUBMITTED'])).toBeNull();
  });
});
