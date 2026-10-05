import { describe, expect, it } from 'vitest';
import { currentLeases, type FusionLease } from './fusion';

const lease = (unitCode: string, leaseStatus: string, leaseStart: string, leaseEnd: string): FusionLease => ({
  businessUnit: 'REHL', leaseNumber: `${unitCode}/${leaseStart}`, unitCode, unitType: null, grossArea: null, propertyCode: null,
  propertyName: null, leaseVersion: null, tenantCode: null, tenantName: null, customerClass: null, leaseStart, rentStart: leaseStart,
  leaseEnd, actualLeaseAmount: 1, taxAmount: 0, rentPerAnnum: 1, securityDeposit: null, leaseStatus, leaseRemarks: null,
});

describe('currentLeases', () => {
  it('keeps the approved lease and drops the history', () => {
    const r = currentLeases(
      [lease('A', 'Terminated', '2018-01-01', '2018-12-31'), lease('A', 'Approved', '2026-06-15', '2027-06-14'), lease('B', 'Pre-Terminated', '2025-01-01', '2026-12-31'), lease('C', 'Suspended', '2024-11-15', '2025-11-14')],
      '2026-09-30',
    );
    expect(r.leases.map((l) => l.unitCode)).toEqual(['A']);
    expect(r.skipped).toEqual({ Terminated: 1, 'Pre-Terminated': 1, Suspended: 1 });
  });

  it('keeps a lease signed to start after the as-of date', () => {
    expect(currentLeases([lease('A', 'Approved', '2026-10-05', '2027-10-04')], '2026-09-30').leases).toHaveLength(1);
  });

  it('keeps an approved lease past its end date (renewal pending)', () => {
    expect(currentLeases([lease('A', 'Approved', '2025-10-01', '2026-09-30')], '2026-10-05').leases).toHaveLength(1);
  });

  it('with a renewal signed in advance, the running lease is current', () => {
    const r = currentLeases([lease('A', 'Approved', '2027-06-15', '2028-06-14'), lease('A', 'approved', '2026-06-15', '2027-06-14')], '2026-09-30');
    expect(r.leases[0].leaseStart).toBe('2026-06-15');
    expect(r.skipped).toEqual({ 'Approved, superseded': 1 });
  });

  it('a signed lease starting soon beats one that has ended', () => {
    const r = currentLeases([lease('A', 'Approved', '2025-10-01', '2026-09-30'), lease('A', 'Approved', '2026-10-10', '2027-10-09')], '2026-10-05');
    expect(r.leases[0].leaseStart).toBe('2026-10-10');
  });
});
