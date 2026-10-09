import { describe, expect, it } from 'vitest';
import { ADMIN_ACCOUNTS, DEPTS, anpmOverheads, payrollSplit } from './admin-types';

const row = (dept: string, ctc: number, extra: Partial<Parameters<typeof payrollSplit>[0]> = {}) => ({ dept, ctc, newCtc: null, capPct: null, mjnhPct: null, asrePct: null, seniorCtc: null, ...extra });

describe('admin overheads: 2026 payroll rules', () => {
  // H.E. MJN_Budget 2026.xlsm, PayrollxCost rows 14-23: payroll (C), the department's admin overheads (D)
  it('reproduces the 2026 allocation: PDD and ASRE on payroll + overheads, MJNH on payroll', () => {
    const hr = payrollSplit(row('207', 1475985.92), 98862.1367);
    expect(hr.cap).toBeCloseTo(78742.4, 1);
    expect(hr.mjnh).toBeCloseTo(309957.04, 1);
    expect(hr.net).toBeCloseTo(1186148.61, 1);
    expect(payrollSplit(row('201', 2106889.83), 165908.1791).net).toBeCloseTo(2045518.21, 1);
    const pm = payrollSplit(row('206', 3586435.435, { seniorCtc: 1471280.665 }), 325157.2721);
    expect(pm.cap).toBeCloseTo(391159.27, 1);
    expect(pm.asre).toBeCloseTo(73564.03, 1);
    expect(pm.net).toBeCloseTo(3446869.4, 1);
    expect(payrollSplit(row('214', 3043633.8), 111643.7667).asre).toBeCloseTo(157763.88, 1);
    expect(payrollSplit(row('212', 3160222.84), 45090.8267).net).toBeCloseTo(0, 2);
    expect(payrollSplit(row('000', 0), 1227437.7).cap).toBeCloseTo(61371.89, 1);
    // with the departments the rules leave whole (Legal, the family office, Excom, Office Support): J25
    const net = [
      hr.net,
      2045518.21,
      pm.net,
      payrollSplit(row('214', 3043633.8), 111643.7667).net,
      payrollSplit(row('000', 0), 1227437.7).net,
      payrollSplit(row('202', 414993.1), 17039.36).net,
      payrollSplit(row('106', 355296.3), 34371.23).net,
      payrollSplit(row('214', 1650000, { asrePct: 0 })).net,
      payrollSplit(row('208', 1039272.654), 85971.1141).net,
    ].reduce((s, v) => s + v, 0);
    expect(net).toBeCloseTo(14439059.48, 0);
  });

  it('takes ASRE only on senior staff outside Senior Management, and an entered rule wins', () => {
    expect(payrollSplit(row('201', 1000)).asre).toBe(0);
    expect(payrollSplit(row('201', 1000, { seniorCtc: 400 })).asre).toBeCloseTo(20);
    const s = payrollSplit(row('212', 1000, { newCtc: 500, capPct: 0.8 }));
    expect(s.total).toBe(1500);
    expect(s.cap).toBeCloseTo(1200);
  });

  it("adds up what ANPM pays per department, the schedules' amount first", () => {
    const m = anpmOverheads([
      { dept: '201', b: { '521': 100, '501': 50 }, items: { '521': null } },
      { dept: '201', b: { '521': 10 }, items: { '521': 30 } },
    ]);
    expect(m.get('201')).toBe(130);
  });

  it('FM and Security are budgeted elsewhere; payroll accounts are not entered per account', () => {
    expect(DEPTS.filter((d) => d.elsewhere).map((d) => d.code).sort()).toEqual(['209', '211']);
    expect(new Set(ADMIN_ACCOUNTS.map((a) => a.code)).size).toBe(ADMIN_ACCOUNTS.length);
  });
});
