import { describe, expect, it } from 'vitest';
import { buildModel, nameSimilarity, selectContracts, unitKey, type ReportRow } from './tenant-lease';

const row = (unitCode: string, leaseNumber: string | null, start: string, end: string, amount: number, extra: Partial<ReportRow> = {}): ReportRow => ({
  businessUnit: 'THE REAL ESTATE HOLDING COMPANY LLC', propertyName: 'P', unitCode, bedrooms: null, area: 100, unitType: 'Office',
  unitStatus: leaseNumber ? 'Leased' : 'Available', leaseNumber, tenantCode: 'T-1', tenantName: 'ACME LLC', customerClass: 'EXTERNAL PARTY',
  commencement: start, start, end, amount, rentPerYear: amount, securityDeposit: null, maintenanceFee: null, ...extra,
});

describe('unitKey', () => {
  it('matches P-coded PMC units and codes without the N to the budget code', () => {
    expect(unitKey('50B113P-GF-S4')).toBe(unitKey('50B113N-GF-S4'));
    expect(unitKey('10B110-B6.B-06')).toBe(unitKey('10B110N-B6.B-06'));
  });
  it('drops a note after a space but keeps brackets inside the code', () => {
    expect(unitKey('10B111N-L9-E904 (D)')).toBe(unitKey('10B111N-L9-E904'));
    expect(unitKey('10B111N-MZ-MZ(5A)')).not.toBe(unitKey('10B111N-MZ-MZ(5B)'));
  });
});

describe('selectContracts', () => {
  const y = (start: string, end: string, amount = 1) => ({ start, end, amount });
  it('takes the year running on the as-of date and the later years as contracted', () => {
    const r = selectContracts([y('2027-05-01', '2028-04-30', 3), y('2025-05-01', '2026-04-30', 1), y('2026-05-01', '2027-04-30', 2)], '2026-10-05');
    expect(r.current?.amount).toBe(2);
    expect(r.following.map((p) => p.amount)).toEqual([3]);
  });
  it('a lease that has ended stays current (renewal pending)', () => {
    expect(selectContracts([y('2025-10-01', '2026-09-30')], '2026-10-05').current?.end).toBe('2026-09-30');
  });
  it('a lease starting after the as-of date is current when nothing has run before', () => {
    expect(selectContracts([y('2026-11-01', '2027-10-31')], '2026-10-05').current?.start).toBe('2026-11-01');
  });
});

describe('buildModel', () => {
  it('a lease total repeated on each of its units is counted once', () => {
    const { leases } = buildModel([row('A-GF-1', 'L1', '2026-01-01', '2026-12-31', 900), row('A-GF-2', 'L1', '2026-01-01', '2026-12-31', 900)]);
    expect(leases.get('L1')!.periods).toEqual([{ start: '2026-01-01', end: '2026-12-31', amount: 900 }]);
    expect(leases.get('L1')!.units).toHaveLength(2);
  });
  it('different amounts per unit are added up', () => {
    const { leases } = buildModel([row('A-GF-1', 'L1', '2026-01-01', '2026-12-31', 500), row('A-GF-2', 'L1', '2026-01-01', '2026-12-31', 400)]);
    expect(leases.get('L1')!.periods[0].amount).toBe(900);
  });
  it('a first year billed from the lease commencement starts there', () => {
    // 15 months billed (1.25 × annual rent) on a 12-month contract year that follows 3 months of early access
    const { leases } = buildModel([row('A-GF-1', 'L1', '2025-05-01', '2026-04-30', 1250, { commencement: '2025-02-01', rentPerYear: 1000 })]);
    expect(leases.get('L1')!.periods[0].start).toBe('2025-02-01');
  });
  it('available units have no lease', () => {
    const { units, leases } = buildModel([row('A-GF-3', null, '', '', 0, { start: null, end: null, amount: null })]);
    expect(units.get(unitKey('A-GF-3'))!.leaseNumbers).toEqual([]);
    expect(leases.size).toBe(0);
  });
});

describe('nameSimilarity', () => {
  it('ignores legal suffixes and punctuation', () => {
    expect(nameSimilarity('CETULA FACADE CONTRACTING L.L.C', 'Cetula Facade Contracting LLC')).toBe(1);
    expect(nameSimilarity('J A R S TECHNICAL WORKS L.L.C', 'DULSCO (L.L.C)')).toBe(0);
  });
});
