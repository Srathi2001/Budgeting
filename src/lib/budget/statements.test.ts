// Reconciliation of the monthly statements (audit TECH-008): the income statement, the cash flow and the
// Group P&L are built from the same atoms and must agree with each other and with their sources.
import { describe, expect, it } from 'vitest';
import { groupAtoms, type Intergroup } from './group-report';
import { cashStatement, groupPnl, incomeStatement } from './summary';
import type { PropertyRollup, OiMonthly } from './reports';
import type { PropertyExpense } from './expenses';

const m = (v: number) => Array.from({ length: 12 }, () => v);
const tot = (a: (number | null)[] | null | undefined) => (a ?? []).reduce<number>((s, v) => s + (v ?? 0), 0);
const roll = (propertyId: number, buCode: string, code: string, rent: number, cash: number) =>
  ({ propertyId, buCode, code, revenue: m(rent), cash: m(cash), depositIn: m(0), depositOut: m(0) }) as unknown as PropertyRollup;

// two REHL buildings, the Mall, one PMC building; ANPM's fees and recharges in view
const rolls = [roll(1, '501', '30B101', 1000, 900), roll(2, '502', '10B111N', 2000, 2100), roll(3, '502', '10B131N', 4000, 4000), roll(4, '522', '20B110N', 500, 500)];
const oi: OiMonthly[] = [
  { scope: 'P:1', buCode: '501', propertyId: 1, propertyCode: '30B101', account: '52702', months: m(50) },
  { scope: 'P:4', buCode: '522', propertyId: 4, propertyCode: '20B110N', account: '52704', months: m(20) },
  { scope: 'G:751', buCode: '751', propertyId: null, propertyCode: null, account: '52905', months: m(70) },
];
const costs: PropertyExpense[] = [
  { propertyId: 1, code: '30B101', buCode: '501', line: 'utilities', months: m(100) },
  { propertyId: 2, code: '10B111N', buCode: '502', line: 'fmStaff', months: m(80) },
  { propertyId: 3, code: '10B131N', buCode: '502', line: 'watchmen', months: m(40) },
  { propertyId: 4, code: '20B110N', buCode: '522', line: 'maintenance', months: m(30) },
];
const ig: Intergroup = {
  anpm: true,
  pma: [
    { entity: '501', months: m(60), rent: 12000 },
    { entity: '502', months: m(120), rent: 24000 },
    { entity: 'MALL', months: m(240), rent: 48000 },
  ],
  recharged: costs.filter((c) => c.line === 'fmStaff' || c.line === 'watchmen'),
};
const atoms = groupAtoms(rolls, oi, costs, [{ entity: '521', line: 'adminOh', months: m(25) }], ig);
const expenses = new Set(['utilities', 'fmStaff', 'watchmen', 'maintenance', 'adminOh']);

describe('monthly statements reconcile (audit TECH-008)', () => {
  const is = incomeStatement(atoms, expenses);
  const pnl = groupPnl(atoms, expenses);
  const col = (label: string) => pnl.inside.length + ['Standalone', "Owners' share", 'Eliminations', 'group'].indexOf(label);
  const row = (label: string) => pnl.rows.find((r) => r.label === label)!;

  it('rental revenue in the income statement = the rent of the buildings', () => {
    expect(tot(is.find((l) => l.label === 'Rental revenue')!.vals)).toBeCloseTo(12 * (1000 + 2000 + 4000 + 500), 2);
  });
  it('intergroup income and cost cancel: the eliminations net to nil in net income', () => {
    expect(row('Profit after tax (PAT)').vals[col('Eliminations')]).toBeCloseTo(0, 2);
    expect(row('Total income').vals[col('Eliminations')]!).toBeLessThan(0);
  });
  it('the Group P&L adds up: standalone + owners + eliminations = group, and the entities add up to standalone', () => {
    for (const r of pnl.rows.filter((x) => x.kind !== 'group')) {
      const v = r.vals.map((x) => x ?? 0);
      const ent = v.slice(0, pnl.inside.length).reduce((s, x) => s + x, 0);
      expect(v[col('Standalone')]).toBeCloseTo(ent, 2);
      expect(v[col('group')]).toBeCloseTo(v[col('Standalone')] + v[col("Owners' share")] + v[col('Eliminations')], 2);
    }
  });
  it('net income of the group is the same in the income statement and the Group P&L', () => {
    const isNet = tot(is.find((l) => l.kind === 'total' && l.label.startsWith('Profit after tax (PAT)'))!.vals);
    expect(isNet).toBeCloseTo(tot([row('Profit after tax (PAT)').vals[col('group')]]), 2);
  });
  it('entities outside the group (MJNH) stay out of every group total', () => {
    expect(tot(is.find((l) => l.label === 'Total other income')!.vals)).toBeCloseTo(12 * (50 + 20) + 12 * (60 + 120 + 240) + 12 * (80 + 40), 2);
  });
  it('cash: rent cheques = the buildings’ cash, and the PMA fee is paid quarterly', () => {
    const cf = cashStatement(atoms, expenses);
    expect(tot(cf.find((l) => l.label === 'Rent cheques (ex VAT)')!.vals)).toBeCloseTo(12 * (900 + 2100 + 4000 + 500), 2);
    const pmaCash = atoms.filter((a) => a.line === 'cash:exp:pma');
    for (const a of pmaCash) expect(a.months.filter((v) => v !== 0).length).toBeLessThanOrEqual(4);
  });
});

describe('the 2026 layout: EBITDA, below it, PBT, tax, PAT, cash for distribution', () => {
  const extra = groupAtoms(rolls, oi, costs, [
    { entity: '521', line: 'adminOh', months: m(25) },
    { entity: '501', line: 'loanInterest', months: m(300), cash: m(0) },
    { entity: '501', line: 'depreciation', months: m(200), cash: m(0) },
    { entity: '502', line: 'contingencies', months: m(10) },
  ], ig);
  const ex = new Set([...expenses, 'loanInterest', 'depreciation', 'contingencies']);
  const is = incomeStatement(extra, ex);
  const v = (label: string) => tot(is.find((l) => l.label.startsWith(label))!.vals);
  it('PBT = EBITDA less depreciation, loan interest and contingencies; PAT = PBT less tax (none yet)', () => {
    expect(v('Profit before tax (PBT)')).toBeCloseTo(v('Operating profit (EBITDA)') - 12 * (300 + 200 + 10), 2);
    expect(v('Profit after tax (PAT) · standalone')).toBeCloseTo(v('Profit before tax (PBT)'), 2);
  });
  it('cash profit adds depreciation back; cash for distribution is after capex', () => {
    expect(v('Cash profit')).toBeCloseTo(v('Profit after tax (PAT) · REHL') + 12 * 200, 2);
    expect(v('Cash for distribution')).toBeCloseTo(v('Cash profit'), 2);
  });
  it('the Group P&L carries the same PAT', () => {
    const p = groupPnl(extra, ex);
    const r = p.rows.find((x) => x.label === 'Profit after tax (PAT)')!;
    expect(r.vals[p.inside.length + 3]).toBeCloseTo(v('Profit after tax (PAT) · REHL'), 2);
  });
});
