import { describe, expect, it } from 'vitest';
import { computeLease, type LeaseInput } from './lease';
import { DEFAULT_ASSUMPTIONS as A } from './assumptions';
import { parseDay, formatDay } from './dates';

const d = (s: string) => parseDay(s)!;

function input(over: Partial<LeaseInput>): LeaseInput {
  return {
    rc: 'R',
    isCamp: false,
    area: null,
    capacity: null,
    staffOwner: null,
    mfCurrent: false,
    currentRent: null,
    currentStart: null,
    currentEnd: null,
    renew1: true,
    noRenewal: false,
    r1Rent: null,
    r1Start: null,
    r1End: null,
    r1Mf: null,
    r2Renew: null,
    r2Rent: null,
    r2Start: null,
    r2End: null,
    r2Mf: null,
    budgetRate: null,
    increasePctOverride: null,
    cheques: null,
    ...over,
  };
}

describe('revenue and cash (workbook row 3: 30B107-L1-A101)', () => {
  const res = computeLease(
    input({
      currentRent: 60000,
      currentStart: d('2025-02-02'),
      currentEnd: d('2026-02-01'),
      r1Rent: 60000,
      r1Start: d('2026-02-02'),
      r1End: d('2027-02-01'),
      r1Mf: false,
      r2Renew: false,
    }),
    2026,
    A,
  );
  it('pro-rates rent by day', () => {
    expect(Math.round(res.revenue[0])).toBe(5096); // Jan
    expect(Math.round(res.revenue[1])).toBe(4603); // Feb: 1 day old + 27 days new
    expect(Math.round(res.totals.revenue)).toBe(60000);
  });
  it('collects four quarterly cheques from the renewal start', () => {
    expect(res.cash.map(Math.round)).toEqual([0, 15000, 0, 0, 15000, 0, 0, 15000, 0, 0, 15000, 0]);
  });
});

describe('cheque falling on the last day of a month (Excel drops it)', () => {
  it('keeps the May cheque for a 27 Aug contract', () => {
    const res = computeLease(
      input({
        currentRent: 65100,
        currentStart: d('2025-08-27'),
        currentEnd: d('2026-08-26'),
        r1Rent: 65100,
        r1Start: d('2026-08-27'),
        r1End: d('2027-08-26'),
        r2Renew: false,
      }),
      2026,
      A,
    );
    expect(res.cash[4]).toBeCloseTo(16275, 0); // May
    expect(res.totals.cash).toBeCloseTo(65100, 0);
  });
});

describe('renewal derivation', () => {
  const base = { currentRent: 50000, currentStart: d('2026-03-01'), currentEnd: d('2027-02-28') };

  it('renewing tenant: increase from RERA bands, starts the next day', () => {
    // avg 70,000; rent 28.6% below -> 10% band
    const res = computeLease(input({ ...base }), 2027, A, { min: 60000, max: 80000 });
    const r1 = res.contracts.find((c) => c.kind === 'RENEWAL1')!;
    expect(res.increasePct).toBe(0.1);
    expect(r1.rent).toBeCloseTo(55000);
    expect(formatDay(r1.start)).toBe('2027-03-01');
    expect(formatDay(r1.end)).toBe('2028-02-28');
    expect(r1.derived.rent).toBe(true);
  });

  it('staff rents are grossed up before comparing with RERA', () => {
    // 50,000 / 0.8 = 62,500 -> 10.7% below 70,000 -> no increase
    const res = computeLease(input({ ...base, staffOwner: 'STAFF' }), 2027, A, { min: 60000, max: 80000 });
    expect(res.increasePct).toBe(0);
  });

  it('no RERA index: 0% with a warning', () => {
    const res = computeLease(input({ ...base }), 2027, A, null);
    expect(res.increasePct).toBe(0);
    expect(res.warnings.join()).toMatch(/RERA/);
  });

  it('new tenant: vacancy gap, budget rate, agency fee, MF and no admin fee on that lease', () => {
    const res = computeLease(input({ ...base, renew1: false, budgetRate: 65000 }), 2027, A);
    const r1 = res.contracts.find((c) => c.kind === 'RENEWAL1')!;
    expect(formatDay(r1.start)).toBe('2027-04-29'); // 28 Feb + 60 days
    expect(r1.rent).toBe(65000);
    expect(r1.mf).toBe(true);
    expect(res.agencyFee[3]).toBeCloseTo(65000 * 0.025);
    expect(res.mfFee[3]).toBeCloseTo(65000 * 0.05);
    expect(res.ejariFee[3]).toBe(200);
    expect(res.adminFee[3]).toBe(0);
    expect(res.vacancyLoss).toBeGreaterThan(0);
  });

  it('commercial new tenant: budget rate is per sq.ft', () => {
    const res = computeLease(input({ ...base, rc: 'C', area: 1000, renew1: false, budgetRate: 80 }), 2027, A);
    expect(res.contracts.find((c) => c.kind === 'RENEWAL1')!.rent).toBe(80000);
    expect(res.adminFee[3]).toBe(0);
  });

  it('camps renew at the camp increase', () => {
    const res = computeLease(input({ ...base, rc: 'L', isCamp: true, capacity: 100 }), 2027, A);
    expect(res.contracts.find((c) => c.kind === 'RENEWAL1')!.rent).toBeCloseTo(60000);
  });

  it('2nd renewal is added when the 1st ends inside the year', () => {
    const res = computeLease(
      input({ currentRent: 12000, currentStart: d('2026-06-01'), currentEnd: d('2026-12-31'), r1End: d('2027-06-30') }),
      2027,
      A,
      { min: 12000, max: 12000 },
    );
    const r2 = res.contracts.find((c) => c.kind === 'RENEWAL2');
    expect(r2 && formatDay(r2.start)).toBe('2027-07-01');
  });

  it('not re-let: no renewal after the current contract', () => {
    const res = computeLease(input({ ...base, noRenewal: true }), 2027, A);
    expect(res.contracts).toHaveLength(1);
    expect(res.revenue.slice(2).every((v) => v === 0)).toBe(true);
  });

  it('owner-occupied units never renew', () => {
    const res = computeLease(input({ ...base, staffOwner: 'OWNER' }), 2027, A);
    expect(res.contracts).toHaveLength(1);
  });

  it('PM overrides win over derived values', () => {
    const res = computeLease(input({ ...base, r1Rent: 52000, r1Start: d('2027-03-15') }), 2027, A);
    const r1 = res.contracts.find((c) => c.kind === 'RENEWAL1')!;
    expect(r1.rent).toBe(52000);
    expect(formatDay(r1.start)).toBe('2027-03-15');
    expect(r1.derived.rent).toBe(false);
  });
});
