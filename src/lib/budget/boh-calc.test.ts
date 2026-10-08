import { describe, expect, it } from 'vitest';
import { contractAmount, contractMonths, forecastY1, parBudget, plBudget, termsOf, waterBudget, watchmenBudget } from './boh-calc';

const months = (m: Record<number, number>) => Array.from({ length: 12 }, (_, i) => m[i + 1] ?? 0);

describe('building overheads: last year forecast', () => {
  it('water: paid so far + last year Oct–Dec × (1 + %)', () => {
    const ytd = months({ 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100, 8: 100, 9: 100 });
    const last = months({ 10: 50, 11: 50, 12: 100 });
    expect(forecastY1('seasonal', ytd, last, 9, 0.05)).toBe(900 + 200 * 1.05);
    expect(waterBudget(1110, 0.05)).toBe(1165.5);
  });
  it('paid every month so far: run-rate (also a contract new this year)', () => {
    expect(forecastY1('flat', months({ 1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10, 7: 10, 8: 10, 9: 10 }), undefined, 9)).toBe(120);
  });
  it('paid now and then: so far + last year’s remaining months', () => {
    expect(forecastY1('flat', months({ 4: 840 }), months({ 3: 500, 11: 300 }), 9)).toBe(1140);
    // nothing yet this year
    expect(forecastY1('flat', undefined, months({ 10: 1000 }), 9)).toBe(1000);
  });
  it('a yearly fee: this year’s payment, or last year’s if more', () => {
    expect(forecastY1('due', undefined, months({ 10: 345 }), 9)).toBe(345); // not due yet
    expect(forecastY1('due', months({ 7: 340 }), months({ 10: 345 }), 9)).toBe(345);
    expect(forecastY1('due', months({ 7: 340, 9: 340 }), undefined, 9)).toBe(680);
    // quarterly charges: three quarters paid, last year four
    expect(forecastY1('due', months({ 3: 61, 6: 61, 9: 61 }), months({ 3: 61, 6: 61, 9: 61, 12: 61 }), 9)).toBe(244);
  });
});

describe('building overheads: calculated budgets', () => {
  it('insurance and watchmen', () => {
    expect(parBudget(63_991_851, 0.0001168979, 0.07)).toBeCloseTo(63_991_851 * 0.0001168979 * 1.07, 1);
    expect(plBudget(762.375, 0.07)).toBe(815.74);
    expect(parBudget(null, 0.0001, 0.07)).toBeNull();
    expect(watchmenBudget(2.7, 49335)).toBe(133204.5);
  });
  it('contracts: amount and when paid', () => {
    expect(contractAmount({ quantity: 12, rate: 7000 })).toBe(84000);
    expect(contractMonths({ terms: 'Monthly', quantity: 12, rate: 7000, startMonth: null })).toEqual(Array(12).fill(7000));
    // starts in April for 9 months
    const apr = contractMonths({ terms: 'Monthly', quantity: 9, rate: 100, startMonth: 4 });
    expect(apr.slice(0, 3)).toEqual([0, 0, 0]);
    expect(apr.slice(3).every((v) => v === 100)).toBe(true);
    // 400 collections a year, spread monthly
    expect(contractMonths({ terms: 'Monthly', quantity: 400, rate: 52, startMonth: null })[0]).toBeCloseTo(20800 / 12);
    const q = contractMonths({ terms: 'Quarterly', quantity: 4, rate: 500, startMonth: null });
    expect([q[2], q[5], q[8], q[11]]).toEqual([500, 500, 500, 500]);
    const h = contractMonths({ terms: 'Half-yearly', quantity: 2, rate: 8000, startMonth: 1 });
    expect([h[0], h[6]]).toEqual([8000, 8000]);
    expect(contractMonths({ terms: 'One-off', quantity: 1, rate: 300, startMonth: 5 })[4]).toBe(300);
  });
  it('terms from a purchase order line', () => {
    expect(termsOf('Monthly Pest Control Services (Common Area) at Al Shoala', 12)).toBe('Monthly');
    expect(termsOf('Half Yearly Pest Control Services at Umm Suqueim', 2)).toBe('Half-yearly');
    expect(termsOf('Security Services in CBD-10 Male Security Guards 12Hours X 7 Days', 12)).toBe('Monthly');
    expect(termsOf('One time anti termite control service', null)).toBe('One-off');
    expect(termsOf('Yearly Pest Control Services (Common Area)', 1)).toBe('Yearly');
  });
});
