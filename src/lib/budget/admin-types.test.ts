import { describe, expect, it } from 'vitest';
import { ADMIN_ACCOUNTS, DEPTS, payrollSplit } from './admin-types';

const row = (dept: string, ctc: number, extra: Partial<Parameters<typeof payrollSplit>[0]> = {}) => ({ dept, ctc, newCtc: null, capPct: null, mjnhPct: null, asrePct: null, ...extra });

describe('admin overheads: 2026 payroll rules', () => {
  it('capitalises PDD in full and slices of Finance, HR, PM and General', () => {
    expect(payrollSplit(row('212', 1000)).cap).toBe(1000);
    expect(payrollSplit(row('201', 1000)).cap).toBeCloseTo(100);
    expect(payrollSplit(row('207', 1000)).cap).toBeCloseTo(50);
    expect(payrollSplit(row('206', 1000)).cap).toBeCloseTo(100);
    expect(payrollSplit(row('000', 1000)).cap).toBeCloseTo(50);
    expect(payrollSplit(row('202', 1000)).cap).toBe(0);
  });

  it('recharges 21% of HR to MJNH and 5% of Senior Management to ASRE; the rest is ANPM G&A', () => {
    const hr = payrollSplit(row('207', 1000));
    expect(hr.mjnh).toBeCloseTo(210);
    expect(hr.net).toBeCloseTo(1000 - 50 - 210);
    expect(payrollSplit(row('214', 2000)).asre).toBeCloseTo(100);
  });

  it('new hires add to the payroll, and an entered rule replaces the default', () => {
    const s = payrollSplit(row('212', 1000, { newCtc: 500, capPct: 0.8 }));
    expect(s.total).toBe(1500);
    expect(s.cap).toBeCloseTo(1200);
  });

  it('FM and Security are budgeted elsewhere; payroll accounts are not entered per account', () => {
    expect(DEPTS.filter((d) => d.elsewhere).map((d) => d.code).sort()).toEqual(['209', '211']);
    expect(new Set(ADMIN_ACCOUNTS.map((a) => a.code)).size).toBe(ADMIN_ACCOUNTS.length);
  });
});
