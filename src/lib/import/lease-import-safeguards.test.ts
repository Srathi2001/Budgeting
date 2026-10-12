import { describe, expect, it } from 'vitest';
import { changedFields, oracleChanges } from './tenant-lease';

type Facts = Parameters<typeof oracleChanges>[1];
const facts = (over: Partial<NonNullable<Facts>> = {}): NonNullable<Facts> => ({
  leaseNumber: 'L-2',
  tenantCode: 'T-1',
  tenant: 'ACME LLC',
  customerClass: null,
  rentStart: '2027-01-01',
  currentStart: '2027-01-01',
  currentEnd: '2027-12-31',
  currentRent: 110000,
  securityDeposit: null,
  leaseRemarks: null,
  renewals: [],
  fees: { maintenance: 0, utility: 0, carPark: 0 },
  ...over,
});
const line = { leaseNumber: 'L-1', tenant: 'ACME LLC', currentStart: '2026-01-01', currentEnd: '2026-12-31', currentRent: 100000, vacant: false, contracted: 0 };

describe('Oracle changes listed for a submitted or approved property', () => {
  it('lists each difference between the line as submitted and Oracle', () => {
    const out = oracleChanges(line, facts());
    expect(out).toContain('Lease L-1 → L-2');
    expect(out).toContain('Contract 2026-01-01 to 2026-12-31 → 2027-01-01 to 2027-12-31');
    expect(out).toContain('Rent 100,000.00 → 110,000.00');
    expect(out.some((x) => x.startsWith('Tenant'))).toBe(false);
  });
  it('lists nothing when Oracle agrees', () => {
    expect(oracleChanges({ ...line, leaseNumber: 'L-2', currentStart: '2027-01-01', currentEnd: '2027-12-31', currentRent: 110000 }, facts())).toEqual([]);
  });
  it('says when a leased unit shows available, and when Oracle has a new unit', () => {
    expect(oracleChanges(line, null)[0]).toMatch(/no longer current/);
    expect(oracleChanges({ ...line, vacant: true }, null)).toEqual([]);
    expect(oracleChanges(null, facts())[0]).toMatch(/^New in Oracle: lease L-2/);
    expect(oracleChanges(null, null)).toEqual(['New available unit in Oracle']);
  });
});

describe('per-line audit of an import', () => {
  it('records only the fields that changed, with before and after', () => {
    const before = { currentRent: 100000, tenant: 'A', r1Schedule: [{ date: '2027-01-01', amount: 1 }], notes: null, leaseSyncedAt: new Date(1) };
    const after = { currentRent: 110000, tenant: 'A', r1Schedule: [{ date: '2027-01-01', amount: 1 }], notes: null, leaseSyncedAt: new Date(2) };
    expect(changedFields(before, after, ['leaseSyncedAt'])).toEqual({ currentRent: { from: 100000, to: 110000 } });
  });
  it('treats null and missing alike, and numbers stored as text as numbers', () => {
    expect(changedFields({ a: null, b: '5.00' }, { a: undefined, b: 5 })).toEqual({});
    expect(changedFields({ a: 1 }, { a: null })).toEqual({ a: { from: 1, to: null } });
  });
});
