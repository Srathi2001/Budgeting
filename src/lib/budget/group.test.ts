import { describe, expect, it, vi } from 'vitest';
import { classifyOtherIncome, classifyRent } from './group';
import type { PropertyRollup, OiMonthly } from './reports';

vi.mock('server-only', () => ({}));
const { groupAtoms, sumAtoms } = await import('./group-report');

const m12 = (v: number) => Array.from({ length: 12 }, () => v);
const roll = (buCode: string, code: string, rent: number) => ({ buCode, code, revenue: m12(rent), cash: m12(0), vat: m12(0), depositIn: m12(0), depositOut: m12(0) }) as unknown as PropertyRollup;
const oi = (scope: string, buCode: string, account: string, v: number, propertyCode: string | null = null): OiMonthly => ({
  scope,
  buCode,
  propertyId: scope.startsWith('P:') ? Number(scope.slice(2)) : null,
  propertyCode,
  account,
  months: m12(v),
});

describe('group classes', () => {
  it('MJNH and the Private Office are outside the group', () => {
    expect(classifyOtherIncome('G:751', '751', '52801')).toBe('outside');
    expect(classifyOtherIncome('G:703', '703', '52311')).toBe('outside');
  });
  it("ANPM's PMA fee is intergroup; other management fees are not", () => {
    expect(classifyOtherIncome('G:521', '521', '52801')).toBe('intergroup');
    expect(classifyOtherIncome('P:40', '502', '52801')).toBe('group');
  });
  it("PMC properties: rent and landlord-side income are the owners'; ANPM's fees are the group's", () => {
    expect(classifyRent('522')).toBe('owners');
    expect(classifyOtherIncome('P:60', '522', '52702')).toBe('owners');
    expect(classifyOtherIncome('P:60', '522', '52402')).toBe('group');
    expect(classifyOtherIncome('G:522', '522', '52701')).toBe('group');
    expect(classifyRent('501')).toBe('group');
  });
});

describe('group atoms', () => {
  it('mirrors the PMA fee as a cost of REHL, REHL-MJN and the Mall by rent, so the group nets it out', () => {
    const atoms = groupAtoms([roll('501', '30B101', 100), roll('502', '10B111N', 200), roll('502', '10B131N', 100), roll('522', '50B113N', 50)], [oi('G:521', '521', '52801', 40)]);
    const cost = (e: string) => sum12(sumAtoms(atoms, (a) => a.line === 'exp:pma' && a.entity === e));
    expect(cost('501')).toBeCloseTo(120);
    expect(cost('502')).toBeCloseTo(240);
    expect(cost('MALL')).toBeCloseTo(120);
    expect(cost('522')).toBe(0);
    const income = sum12(sumAtoms(atoms, (a) => a.line.startsWith('oi:') && a.cls === 'intergroup'));
    const mirrored = sum12(sumAtoms(atoms, (a) => a.line.startsWith('exp:') && a.cls === 'intergroup'));
    expect(income).toBeCloseTo(480);
    expect(mirrored).toBeCloseTo(480);
  });
  it('mirrors the PMA fee as charged to each landlord when the fee is set per landlord', () => {
    const fee = { ...oi('G:521', '521', '52801', 30), payers: [{ entity: '501' as const, months: m12(10) }, { entity: 'MALL' as const, months: m12(20) }] };
    const atoms = groupAtoms([roll('501', '30B101', 100), roll('502', '10B131N', 100)], [fee]);
    const cost = (e: string) => sum12(sumAtoms(atoms, (a) => a.line === 'exp:pma' && a.entity === e));
    expect(cost('501')).toBeCloseTo(120);
    expect(cost('MALL')).toBeCloseTo(240);
    expect(cost('502')).toBe(0);
  });
});

const sum12 = (m: number[]) => m.reduce((s, v) => s + v, 0);
