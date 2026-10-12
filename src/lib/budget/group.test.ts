import { describe, expect, it, vi } from 'vitest';
import { classifyOtherIncome, classifyRent, entityOf, quarterlyCash } from './group';
import type { PropertyRollup, OiMonthly } from './reports';
import type { PropertyExpense } from './expenses';

vi.mock('server-only', () => ({}));
const { groupAtoms, sumAtoms } = await import('./group-report');

const m12 = (v: number) => Array.from({ length: 12 }, () => v);
const sum12 = (m: number[]) => m.reduce((s, v) => s + v, 0);
const roll = (buCode: string, code: string, rent: number) => ({ buCode, code, revenue: m12(rent), cash: m12(0), vat: m12(0), depositIn: m12(0), depositOut: m12(0) }) as unknown as PropertyRollup;
const oi = (scope: string, buCode: string, account: string, v: number, propertyCode: string | null = null): OiMonthly => ({
  scope,
  buCode,
  propertyId: scope.startsWith('P:') ? Number(scope.slice(2)) : null,
  propertyCode,
  account,
  months: m12(v),
});
const cost = (propertyId: number, buCode: string, code: string, line: string, v: number): PropertyExpense => ({ propertyId, code, buCode, line, months: m12(v) });

// PMA fee at 10% of rent: REHL 100/month, REHL-MJN 200, Mall 100
const PMA = [
  { entity: '501' as const, months: m12(10), rent: 1200 },
  { entity: '502' as const, months: m12(20), rent: 2400 },
  { entity: 'MALL' as const, months: m12(10), rent: 1200 },
];
const ROLLS = [roll('501', '30B101', 100), roll('502', '10B111N', 200), roll('502', '10B131N', 100), roll('522', '50B113N', 50)];
const total = (atoms: ReturnType<typeof groupAtoms>, f: (a: ReturnType<typeof groupAtoms>[number]) => boolean) => sum12(sumAtoms(atoms, f));
/** net income the way the statements take it: income − costs, then less owners' share and eliminations */
const net = (atoms: ReturnType<typeof groupAtoms>) => {
  const inc = (a: (typeof atoms)[number]) => a.line === 'rent' || a.line.startsWith('oi:');
  const exp = (a: (typeof atoms)[number]) => a.line.startsWith('exp:');
  const standalone = total(atoms, inc) - total(atoms, exp);
  const owners = total(atoms, (a) => inc(a) && a.cls === 'owners') - total(atoms, (a) => exp(a) && a.cls === 'owners');
  const elim = total(atoms, (a) => inc(a) && a.cls === 'intergroup') - total(atoms, (a) => exp(a) && a.cls === 'intergroup');
  return { standalone, group: standalone - owners - elim };
};

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
  it('the Mall is its own entity', () => {
    expect(entityOf('502', '10B131N')).toBe('MALL');
    expect(entityOf('502', '10B111N')).toBe('502');
  });
});

describe('PMA fee', () => {
  it('everything in view: each landlord carries its fee on its rent, ANPM the income, and the group nets both out', () => {
    const atoms = groupAtoms(ROLLS, [oi('G:521', '521', '52801', 999)], [], [], { anpm: true, pma: PMA, recharged: [] });
    const fee = (e: string) => total(atoms, (a) => a.line === 'exp:pma' && a.entity === e);
    expect(fee('501')).toBeCloseTo(120);
    expect(fee('502')).toBeCloseTo(240);
    expect(fee('MALL')).toBeCloseTo(120);
    expect(fee('522')).toBe(0);
    // the stored fee row is not used: the income is built from the landlords
    expect(total(atoms, (a) => a.line === 'oi:52801')).toBeCloseTo(480);
    expect(total(atoms, (a) => a.line === 'oi:52801' && a.cls === 'intergroup')).toBeCloseTo(480);
    expect(total(atoms, (a) => a.line === 'exp:pma' && a.cls === 'intergroup')).toBeCloseTo(480);
  });
  it('REHL only: REHL carries its PMA cost as a plain cost (ANPM not in view)', () => {
    const atoms = groupAtoms([roll('501', '30B101', 100)], [], [], [], { anpm: false, pma: PMA, recharged: [] });
    expect(total(atoms, (a) => a.line === 'exp:pma' && a.entity === '501' && a.cls === 'group')).toBeCloseTo(120);
    expect(total(atoms, (a) => a.line === 'oi:52801')).toBe(0);
    expect(net(atoms).group).toBeCloseTo(1200 - 120);
  });
  it('ANPM only: the whole fee is ANPM income, no landlord cost', () => {
    const atoms = groupAtoms([], [], [], [], { anpm: true, pma: PMA, recharged: [] });
    expect(total(atoms, (a) => a.line === 'oi:52801' && a.cls === 'group')).toBeCloseTo(480);
    expect(total(atoms, (a) => a.line === 'exp:pma')).toBe(0);
    expect(net(atoms).standalone).toBeCloseTo(480);
  });
  it('ANPM and REHL: only REHL’s share is eliminated', () => {
    const atoms = groupAtoms([roll('501', '30B101', 100)], [], [], [], { anpm: true, pma: PMA, recharged: [] });
    expect(total(atoms, (a) => a.line === 'oi:52801' && a.cls === 'intergroup')).toBeCloseTo(120);
    expect(total(atoms, (a) => a.line === 'oi:52801' && a.cls === 'group')).toBeCloseTo(360);
    expect(net(atoms).group).toBeCloseTo(1200 + 360);
  });
});

describe('ANPM recharges (FM staff, watchmen)', () => {
  const COSTS = [cost(1, '501', '30B101', 'fmStaff', 10), cost(2, '502', '10B111N', 'watchmen', 5), cost(3, '522', '50B113N', 'watchmen', 2)];
  it('everything in view: ANPM shows the recharge income and the staff cost; the group result does not change', () => {
    const before = net(groupAtoms(ROLLS, [], COSTS, [], { anpm: true, pma: PMA, recharged: [] }));
    const atoms = groupAtoms(ROLLS, [], COSTS, [], { anpm: true, pma: PMA, recharged: COSTS });
    expect(total(atoms, (a) => a.line.startsWith('oi:RCH') && a.entity === '521')).toBeCloseTo(204);
    expect(total(atoms, (a) => a.line === 'exp:fmStaff' && a.entity === '521')).toBeCloseTo(120);
    expect(total(atoms, (a) => a.line === 'exp:watchmen' && a.entity === '521')).toBeCloseTo(84);
    // the landlords' cost and ANPM's income on it are eliminated; the PMC owners' payment is ANPM's own income
    expect(total(atoms, (a) => a.line.startsWith('oi:RCH') && a.cls === 'intergroup')).toBeCloseTo(180);
    expect(total(atoms, (a) => a.line.startsWith('oi:RCH') && a.cls === 'group')).toBeCloseTo(24);
    expect(total(atoms, (a) => (a.line === 'exp:fmStaff' || a.line === 'exp:watchmen') && a.cls === 'intergroup')).toBeCloseTo(180);
    const after = net(atoms);
    expect(after.standalone).toBeCloseTo(before.standalone);
    // the group: landlords' rent 4,800 less their staff cost 180 (PMA in and out, PMC to its owners)
    expect(after.group).toBeCloseTo(4800 - 180);
  });
  it('ANPM not in view: building costs stay plain costs, no recharge lines', () => {
    const atoms = groupAtoms(ROLLS, [], COSTS, [], { anpm: false, pma: PMA, recharged: [] });
    expect(total(atoms, (a) => a.line.startsWith('oi:RCH'))).toBe(0);
    expect(total(atoms, (a) => a.cls === 'intergroup')).toBe(0);
  });
  it('ANPM only: recharge income and staff cost, net nil', () => {
    const atoms = groupAtoms([], [], [], [], { anpm: true, pma: [], recharged: COSTS });
    expect(total(atoms, (a) => a.line.startsWith('oi:RCH') && a.cls === 'group')).toBeCloseTo(204);
    expect(net(atoms).standalone).toBeCloseTo(0);
  });
});

describe('VAT', () => {
  it('is not in the cash flow (it passes through to the FTA)', () => {
    const r = { ...roll('501', '30B101', 100), cash: m12(100), vat: m12(5) } as PropertyRollup;
    const atoms = groupAtoms([r], []);
    expect(atoms.some((a) => a.line === 'cash:vat')).toBe(false);
    expect(total(atoms, (a) => a.line === 'cash:rent')).toBe(1200);
  });
});

describe('PMA and AMA cash once a quarter, as the 2026 budget (audit REG-005)', () => {
  const months = [10, 10, 10, 20, 20, 20, 30, 30, 30, 40, 40, 40];
  it('PMA: each quarter paid in its first month (Jan, Apr, Jul, Oct)', () => {
    expect(quarterlyCash(months, 'advance')).toEqual([30, 0, 0, 60, 0, 0, 90, 0, 0, 120, 0, 0]);
  });
  it('AMA: each quarter paid in its last month (Mar, Jun, Sep, Dec)', () => {
    expect(quarterlyCash(months, 'arrears')).toEqual([0, 0, 30, 0, 0, 60, 0, 0, 90, 0, 0, 120]);
  });
});
