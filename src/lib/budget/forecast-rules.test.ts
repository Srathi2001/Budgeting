import { describe, expect, it } from 'vitest';
import { buildForecast, type ForecastLine } from './forecast-rules';

const m12 = (v: number) => Array.from({ length: 12 }, () => v);
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const line = (lineId: number, propertyId: number, projection: number[]): ForecastLine => ({ lineId, unitId: lineId, propertyId, projection });
const actuals = (entries: [number, Record<number, number>][]) => new Map(entries.map(([p, m]) => [p, new Map(Object.entries(m).map(([k, v]) => [Number(k), v]))]));
const jan = (n: number, v: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, v]));

describe('current-year forecast (one rule)', () => {
  it('actuals to the cut-off month, then the leases and the property managers’ inputs', () => {
    const { properties } = buildForecast([line(1, 10, m12(100))], actuals([[10, jan(9, 120)]]), [10], 9);
    const p = properties.get(10)!;
    expect(p.hasActuals).toBe(true);
    expect(sum(p.actual)).toBe(9 * 120);
    expect(sum(p.projected)).toBe(3 * 100);
    expect(sum(p.months)).toBe(1080 + 300);
    expect(p.missing).toEqual([]);
  });
  it('ignores actuals after the cut-off month', () => {
    const { properties } = buildForecast([line(1, 10, m12(100))], actuals([[10, jan(10, 120)]]), [10], 9);
    expect(sum(properties.get(10)!.months)).toBe(1080 + 300);
  });
  it('a property without Oracle actuals (PMC) is projected for the whole year', () => {
    const { properties } = buildForecast([line(1, 20, m12(50))], actuals([]), [20], 9);
    const p = properties.get(20)!;
    expect(p.hasActuals).toBe(false);
    expect(sum(p.months)).toBe(600);
    expect(sum(p.actual)).toBe(0);
  });
  it('a month up to the cut-off with no actual is projected and listed', () => {
    const a = jan(9, 120);
    delete a[4];
    const p = buildForecast([line(1, 10, m12(100))], actuals([[10, a]]), [10], 9).properties.get(10)!;
    expect(p.missing).toEqual([4]);
    expect(p.months[3]).toBe(100);
  });
  it('splits a building’s actual over its units by their projection, equally when there is none', () => {
    const { lines } = buildForecast([line(1, 10, m12(300)), line(2, 10, m12(100)), line(3, 11, m12(0)), line(4, 11, m12(0))], actuals([[10, { 1: 800 }], [11, { 1: 50 }]]), [10, 11], 1);
    expect(lines.get(1)![0]).toBe(600);
    expect(lines.get(2)![0]).toBe(200);
    expect(lines.get(3)![0]).toBe(25);
    expect(lines.get(4)![0]).toBe(25);
    // after the cut-off: each line's own projection
    expect(lines.get(1)![1]).toBe(300);
  });
});
