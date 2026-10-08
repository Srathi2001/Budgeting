import { describe, expect, it } from 'vitest';
import { BOH_ACCOUNTS, BOH_LINES, paidInOneMonth, phase } from './boh-types';

describe('building overheads', () => {
  it('phases contracts evenly over the year', () => {
    expect(phase(12000, 'flat', 1)).toEqual(Array(12).fill(1000));
  });

  it('books a lump sum in the month it is paid', () => {
    const m = phase(50000, 'due', 4);
    expect(m[3]).toBe(50000);
    expect(m.reduce((s, v) => s + v, 0)).toBe(50000);
  });

  it("follows last year's monthly pattern for water & electricity, and falls back to even months", () => {
    const pattern = [1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1]; // summer twice as high
    const m = phase(16000, 'seasonal', 1, pattern);
    expect(m[0]).toBe(1000);
    expect(m[5]).toBe(2000);
    expect(phase(12000, 'seasonal', 1, null)).toEqual(Array(12).fill(1000));
    expect(phase(12000, 'seasonal', 1, Array(12).fill(0))).toEqual(Array(12).fill(1000));
  });

  it('insurance is expensed monthly and paid in one month', () => {
    const ins = BOH_ACCOUNTS.filter((a) => a.line === 'insurance');
    expect(ins.length).toBeGreaterThan(0);
    expect(ins.every((a) => a.phasing === 'flat' && a.paidUpfront && paidInOneMonth(a))).toBe(true);
    expect(paidInOneMonth(BOH_ACCOUNTS.find((a) => a.code === '62502')!)).toBe(false); // cleaning AMC
  });

  it('every account feeds a Building P&L line, once', () => {
    const lines = new Set(BOH_LINES.map((l) => l.key));
    expect(BOH_ACCOUNTS.every((a) => lines.has(a.line))).toBe(true);
    expect(new Set(BOH_ACCOUNTS.map((a) => a.code)).size).toBe(BOH_ACCOUNTS.length);
    // FM works and FM staff are budgeted in the FM budget, not here
    expect(BOH_ACCOUNTS.some((a) => /^(627|117)/.test(a.code) || a.code === '62326')).toBe(false);
  });
});
