import { describe, expect, it } from 'vitest';
import { count, fmt, fmtDate, parseDate, pct, pctSigned, short } from './format';

describe('formatting', () => {
  it('amounts: separators, 2 decimals, brackets, dash for zero', () => {
    expect(fmt(1234567.891)).toBe('1,234,567.89');
    expect(fmt(-1234.5)).toBe('(1,234.50)');
    expect(fmt(0)).toBe('-');
    expect(fmt(0.004)).toBe('-');
    expect(fmt(0.005)).toBe('0.01');
    expect(fmt(null)).toBe('');
  });
  it('counts are whole numbers, fractions up to 2 decimals', () => {
    expect(count(1245)).toBe('1,245');
    expect(count(2.7)).toBe('2.7');
    expect(count(0)).toBe('0');
  });
  it('percentages with 2 decimals', () => {
    expect(pct(0.12345)).toBe('12.35%');
    expect(pct(0)).toBe('0.00%');
    expect(pctSigned(-0.011)).toBe('−1.10%');
    expect(pctSigned(0.05)).toBe('+5.00%');
  });
  it('short amounts for charts and tiles', () => {
    expect(short(259_356_577)).toBe('259.36M');
    expect(short(450_500)).toBe('450.50K');
    expect(short(-6_280_000)).toBe('−6.28M');
    expect(short(950)).toBe('950.00');
  });
  it('dates 08-Oct-2026, and typed dates read back', () => {
    expect(fmtDate('2026-10-08')).toBe('08-Oct-2026');
    expect(parseDate('08-Oct-2026')).toBe('2026-10-08');
    expect(parseDate('8/10/2026')).toBe('2026-10-08');
    expect(parseDate('2026-10-08')).toBe('2026-10-08');
    expect(parseDate('31-Foo-2026')).toBeNull();
  });
});
