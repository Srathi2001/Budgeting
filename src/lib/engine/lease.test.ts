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
    currentSchedule: null,
    securityDeposit: null,
    r1Schedule: null,
    r2Schedule: null,
    r3Renew: null,
    r3Rent: null,
    r3Start: null,
    r3End: null,
    r3Mf: null,
    r3Schedule: null,
    renew1: true,
    noRenewal: false,
    vacancyDays: null,
    mfRenewal: null,
    currentMfAmount: null,
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
    // one calendar year: to the day before 1-Mar-2028, which is 29-Feb (2028 is a leap year)
    expect(formatDay(r1.end)).toBe('2028-02-29');
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

  it('new tenant: starts after the vacancy days entered; budget rate, MF and vacancy loss', () => {
    const res = computeLease(input({ ...base, renew1: false, budgetRate: 65000, vacancyDays: 59 }), 2027, A);
    const r1 = res.contracts.find((c) => c.kind === 'RENEWAL1')!;
    expect(formatDay(r1.start)).toBe('2027-04-29'); // ends 28 Feb, 59 empty days (1 Mar – 28 Apr)
    expect(r1.rent).toBe(65000);
    expect(r1.mf).toBe(true);
    expect(r1.newTenant).toBe(true);
    // vacancy loss: the 59 empty days at the new tenant's daily rate (29-Apr-2027 to 28-Apr-2028 is 366 days)
    expect(res.vacancyLoss).toBeCloseTo((59 * 65000) / 366, 0);
  });

  it('new tenant without vacancy days: the default 60 days apply (audit FIN-020)', () => {
    const res = computeLease(input({ ...base, renew1: false, budgetRate: 65000 }), 2027, A);
    // ends 28-Feb-2027; 60 empty days (1 Mar – 29 Apr); the new tenant from 30-Apr
    expect(formatDay(res.contracts.find((c) => c.kind === 'RENEWAL1')!.start)).toBe('2027-04-30');
    expect(res.warnings.join()).not.toMatch(/vacancy days/);
  });

  it('new tenant: the vacancy days win over a start date typed earlier', () => {
    const res = computeLease(input({ ...base, renew1: false, budgetRate: 65000, vacancyDays: 30, r1Start: d('2027-03-01') }), 2027, A);
    expect(formatDay(res.contracts.find((c) => c.kind === 'RENEWAL1')!.start)).toBe('2027-03-31');
  });

  it('new tenant with 0 vacancy days starts the day after', () => {
    const res = computeLease(input({ ...base, renew1: false, budgetRate: 65000, vacancyDays: 0 }), 2027, A);
    expect(formatDay(res.contracts.find((c) => c.kind === 'RENEWAL1')!.start)).toBe('2027-03-01');
    expect(res.vacancyLoss).toBe(0);
  });

  it('commercial new tenant: budget rate is per sq.ft', () => {
    const res = computeLease(input({ ...base, rc: 'C', area: 1000, renew1: false, budgetRate: 80, vacancyDays: 30 }), 2027, A);
    expect(res.contracts.find((c) => c.kind === 'RENEWAL1')!.rent).toBe(80000);
  });

  it('3rd renewal is added when the 2nd also ends inside the year', () => {
    const res = computeLease(
      input({
        currentRent: 6000,
        currentStart: d('2026-11-01'),
        currentEnd: d('2027-01-31'),
        r1End: d('2027-04-30'),
        r2End: d('2027-07-31'),
      }),
      2027,
      A,
      { min: 6000, max: 6000 },
    );
    const r3 = res.contracts.find((c) => c.kind === 'RENEWAL3');
    expect(r3 && formatDay(r3.start)).toBe('2027-08-01');
    expect(res.revenue.every((v) => v > 0)).toBe(true);
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

describe('cheque schedules, VAT and deposits', () => {
  const base = { currentRent: 100000, currentStart: d('2026-07-01'), currentEnd: d('2027-06-30') };

  it('uses the actual schedule of the current lease', () => {
    const res = computeLease(
      input({ ...base, currentSchedule: [{ date: d('2027-01-15'), amount: 50000 }, { date: d('2026-07-01'), amount: 50000 }], r2Renew: false }),
      2027,
      A,
    );
    expect(res.contracts[0].scheduleSource).toBe('ACTUAL');
    expect(res.cash[0]).toBe(50000); // January cheque of the current lease
    expect(res.warnings.filter((w) => /schedule/.test(w))).toHaveLength(0);
  });

  it('renewals default to 4 equal cheques, an edited schedule replaces them', () => {
    const eq4 = computeLease(input({ ...base }), 2027, A, { min: 100000, max: 100000 });
    const r1 = eq4.contracts.find((c) => c.kind === 'RENEWAL1')!;
    expect(r1.scheduleSource).toBe('EQUAL');
    expect(r1.schedule).toHaveLength(4);
    const edited = computeLease(input({ ...base, r1Schedule: [{ date: d('2027-07-01'), amount: 100000 }] }), 2027, A, { min: 100000, max: 100000 });
    expect(edited.contracts.find((c) => c.kind === 'RENEWAL1')!.scheduleSource).toBe('CUSTOM');
    expect(edited.cash[6]).toBe(100000);
  });

  it('warns when a schedule does not add up to the rent', () => {
    const res = computeLease(input({ ...base, currentSchedule: [{ date: d('2026-07-01'), amount: 60000 }] }), 2027, A);
    expect(res.warnings.join()).toMatch(/cheque schedule totals 60,000/);
  });

  it('VAT on commercial rent, none on residential rent', () => {
    const c = computeLease(input({ ...base, rc: 'C', area: 1000, r1Rent: 100000 }), 2027, A);
    const r = computeLease(input({ ...base, r1Rent: 100000 }), 2027, A);
    expect(c.vat[6]).toBeCloseTo(25000 * 0.05); // July renewal cheque
    expect(r.vat.every((v) => v === 0)).toBe(true);
    // VAT is worked out but not in the cash flow: it passes through to the FTA (2026 budget)
    expect(c.totals.cashFlow).toBeCloseTo(c.totals.cash);
  });

  it('deposit refunded when the tenant leaves, new deposit taken from the new tenant', () => {
    const res = computeLease(input({ ...base, renew1: false, budgetRate: 120000, securityDeposit: 5000, vacancyDays: 59 }), 2027, A);
    expect(res.depositOut[6]).toBe(5000); // lease ends 30 Jun -> refund in July
    const r1 = res.contracts.find((c) => c.kind === 'RENEWAL1')!;
    const mi = new Date(r1.start * 86400000).getUTCMonth();
    expect(res.depositIn[mi]).toBeCloseTo(120000 * 0.05);
    expect(res.totals.cashFlow).toBeGreaterThan(res.totals.cash);
  });

  it('a renewing tenant moves no deposit', () => {
    const res = computeLease(input({ ...base }), 2027, A, { min: 100000, max: 100000 });
    expect(res.depositIn.every((v) => v === 0) && res.depositOut.every((v) => v === 0)).toBe(true);
  });
});

describe('multi-year leases', () => {
  it('get the per-year cheque count for every year of the term', () => {
    const res = computeLease(
      input({ currentRent: 300000, currentStart: d('2025-01-01'), currentEnd: d('2027-12-31'), noRenewal: true }),
      2027,
      A,
    );
    expect(res.contracts[0].schedule).toHaveLength(12);
    expect(res.totals.cash).toBeCloseTo(100000, 0);
    expect(res.totals.revenue).toBeCloseTo(100000, -2);
  });
});

describe('maintenance service fee (other income)', () => {
  const base = { currentRent: 60000, currentStart: d('2026-05-01'), currentEnd: d('2027-04-30') };
  const rera = { min: 60000, max: 60000 };

  it('renewal keeps the current lease MF: 5% of the renewal rent, in the month it starts', () => {
    const res = computeLease(input({ ...base, mfCurrent: true }), 2027, A, rera);
    expect(res.maintenance[4]).toBeCloseTo(3000); // May
    expect(res.totals.maintenance).toBeCloseTo(3000);
    expect(res.totals.revenue).toBeLessThan(61000); // not in rent revenue
  });

  it('renewal without MF on the current lease: none', () => {
    expect(computeLease(input({ ...base, mfCurrent: false }), 2027, A, rera).totals.maintenance).toBe(0);
  });

  it('new tenant: MF by default', () => {
    const res = computeLease(input({ ...base, renew1: false, budgetRate: 70000, vacancyDays: 30 }), 2027, A);
    expect(res.totals.maintenance).toBeCloseTo(3500);
    expect(res.maintenance[4]).toBeCloseTo(3500); // starts 31 May
  });

  it('waived off or No: none; commercial: none by default', () => {
    expect(computeLease(input({ ...base, renew1: false, budgetRate: 70000, vacancyDays: 30, mfRenewal: 'WAIVED' }), 2027, A).totals.maintenance).toBe(0);
    expect(computeLease(input({ ...base, mfCurrent: true, mfRenewal: 'NO' }), 2027, A, rera).totals.maintenance).toBe(0);
    expect(computeLease(input({ ...base, rc: 'C', area: 1000, renew1: false, budgetRate: 80, vacancyDays: 0 }), 2027, A).totals.maintenance).toBe(0);
  });

  it('current lease starting inside the year: its billed MF in its first month', () => {
    const res = computeLease(input({ currentRent: 60000, currentStart: d('2027-02-01'), currentEnd: d('2028-01-31'), mfCurrent: true, currentMfAmount: 2900 }), 2027, A, rera);
    expect(res.maintenance[1]).toBe(2900);
  });
});

describe('renewal term: one calendar year, leap years included (audit FIN-001)', () => {
  // a lease ending 31-Dec-2027 renews from 1-Jan-2028; 2028 has 366 days
  const lease = input({ rc: 'R', mfCurrent: true, currentRent: 120000, currentStart: d('2027-01-01'), currentEnd: d('2027-12-31'), increasePctOverride: 0, cheques: 4 });
  it('ends the renewal on 31-Dec-2028, with no extra one-day renewal on 31-Dec', () => {
    const res = computeLease(lease, 2028, A, null);
    const r1 = res.contracts.find((c) => c.kind === 'RENEWAL1')!;
    expect(formatDay(r1.start)).toBe('2028-01-01');
    expect(formatDay(r1.end)).toBe('2028-12-31');
    expect(res.contracts.some((c) => c.kind === 'RENEWAL2')).toBe(false);
  });
  it('books one year of rent, four cheques and one maintenance fee in 2028', () => {
    const res = computeLease(lease, 2028, A, null);
    expect(res.totals.revenue).toBeCloseTo(120000, 0);
    expect(res.totals.cash).toBeCloseTo(120000, 0);
    expect(res.maintenance.filter((m) => m > 0)).toHaveLength(1);
  });
  it('runs a renewal from 29 February to 28 February of the next year', () => {
    const res = computeLease(input({ ...lease, currentStart: d('2027-03-01'), currentEnd: d('2028-02-28'), r1Start: d('2028-02-29') }), 2028, A, null);
    expect(formatDay(res.contracts.find((c) => c.kind === 'RENEWAL1')!.end)).toBe('2029-02-28');
  });
  it('keeps a renewal from 1-Jan in an ordinary year to 31-Dec', () => {
    const res = computeLease(input({ ...lease, currentStart: d('2026-01-01'), currentEnd: d('2026-12-31') }), 2027, A, null);
    expect(formatDay(res.contracts.find((c) => c.kind === 'RENEWAL1')!.end)).toBe('2027-12-31');
  });
});

describe('2nd and 3rd renewals are increased like the 1st (audit FIN-006)', () => {
  it('labour unit: each renewal adds the labour increase to the rent it renews', () => {
    const res = computeLease(
      input({ rc: 'L', currentRent: 10000, currentStart: d('2027-01-01'), currentEnd: d('2027-03-31'), r1End: d('2027-06-30') }),
      2027,
      A,
      null,
    );
    const r = (k: string) => res.contracts.find((c) => c.kind === k)!;
    // 10,000 for 90 days is 40,555.56 a year; the 1st renewal runs 91 days, the 2nd a calendar year
    const annual = (10000 * 365) / 90;
    expect(r('RENEWAL1').rent).toBeCloseTo(((annual * (1 + A.labourIncrease)) * 91) / 365);
    expect(r('RENEWAL2').rent).toBeCloseTo(annual * (1 + A.labourIncrease) ** 2);
  });
  it('residential: the RERA band is read again on the renewed rent', () => {
    // avg 70,000: 50,000 is 28.6% below (10%); 55,000 is 21.4% below (10%); typed short 1st renewal
    const res = computeLease(input({ currentRent: 50000, currentStart: d('2026-03-01'), currentEnd: d('2027-02-28'), r1End: d('2027-08-31') }), 2027, A, { min: 60000, max: 80000 });
    expect(res.contracts.find((c) => c.kind === 'RENEWAL2')!.rent).toBeCloseTo(60500);
  });
  it('an increase entered for the unit applies to every renewal; a typed rent stays', () => {
    const base = { rc: 'L' as const, currentRent: 10000, currentStart: d('2027-01-01'), currentEnd: d('2027-03-31'), r1End: d('2027-06-30') };
    expect(computeLease(input({ ...base, increasePctOverride: 0.05 }), 2027, A, null).contracts.find((c) => c.kind === 'RENEWAL2')!.rent).toBeCloseTo(((10000 * 365) / 90) * 1.05 ** 2);
    expect(computeLease(input({ ...base, r2Rent: 12000 }), 2027, A, null).contracts.find((c) => c.kind === 'RENEWAL2')!.rent).toBe(12000);
  });
});

describe('the increase is on a year of rent, not on the contract amount (audit FIN-005)', () => {
  it('a 15-month contract: renewal = the annual rent plus the increase', () => {
    // 150,000 for 1-Oct-2026 to 31-Dec-2027 (457 days) is 119,803.06 a year
    const res = computeLease(input({ rc: 'R', currentRent: 150000, currentStart: d('2026-10-01'), currentEnd: d('2027-12-31'), increasePctOverride: 0.1 }), 2028, A, null);
    const r1 = res.contracts.find((c) => c.kind === 'RENEWAL1')!;
    expect(r1.rent).toBeCloseTo(((150000 * 365) / 457) * 1.1, 2);
    expect(res.totals.revenue).toBeCloseTo(((150000 * 365) / 457) * 1.1, 0);
  });
  it('the RERA band is read on the annual rent', () => {
    // 6 months at 30,000 is 60,000 a year: 14.3% below the 70,000 average → 5% band (not 57% below → 20%)
    const res = computeLease(input({ rc: 'R', currentRent: 30000, currentStart: d('2027-01-01'), currentEnd: d('2027-06-30') }), 2027, A, { min: 60000, max: 80000 });
    expect(res.increasePct).toBe(0.05);
    expect(res.contracts.find((c) => c.kind === 'RENEWAL1')!.rent).toBeCloseTo(((30000 * 365) / 181) * 1.05, 2);
  });
  it('a one-year contract is unchanged', () => {
    const res = computeLease(input({ rc: 'L', currentRent: 100000, currentStart: d('2027-03-01'), currentEnd: d('2028-02-29') }), 2028, A, null);
    expect(res.contracts.find((c) => c.kind === 'RENEWAL1')!.rent).toBeCloseTo(110000);
  });
});
