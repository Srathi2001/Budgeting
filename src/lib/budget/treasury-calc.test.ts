import { describe, expect, it } from 'vitest';
import { contingencyMonths, depositYear, loanYear, type LoanInput } from './treasury-calc';

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const loan = (over: Partial<LoanInput> = {}): LoanInput => ({
  openingBalance: 1_000_000,
  rate: 0.07,
  dayBasis: 'ACT/365',
  interestFrequency: 'Quarterly',
  firstInterestDate: '2027-03-31',
  repaymentType: 'BULLET',
  repaymentFrequency: 'Quarterly',
  firstRepaymentDate: null,
  maturityDate: '2030-12-31',
  capitalisePct: 0,
  contributionLagMonths: null,
  ...over,
});

describe('shareholder loans', () => {
  it('interest accrues daily on the balance and is paid on its quarter dates', () => {
    const y = loanYear(loan(), [], 2027);
    expect(sum(y.interestExpense)).toBeCloseTo(70000, 0);
    expect(sum(y.interestPaid)).toBeCloseTo(70000, 0);
    expect(y.interestPaid.filter((v) => v > 0)).toHaveLength(4);
    expect(y.closing[11]).toBe(1_000_000);
  });
  it('equal principal: four quarterly repayments clear the loan in the year', () => {
    const y = loanYear(loan({ openingBalance: 1_200_000, repaymentType: 'EQUAL_PRINCIPAL', firstRepaymentDate: '2027-03-31', maturityDate: '2027-12-31' }), [], 2027);
    expect(y.principalRepaid.filter((v) => v > 0).map((v) => Math.round(v))).toEqual([300000, 300000, 300000, 300000]);
    expect(y.closing[11]).toBe(0);
    expect(sum(y.interestExpense)).toBeLessThan(1_200_000 * 0.07);
  });
  it('a capitalised share of the interest goes to the project, not the P&L', () => {
    const y = loanYear(loan({ capitalisePct: 0.25 }), [], 2027);
    expect(sum(y.interestCapitalised)).toBeCloseTo(17500, 0);
    expect(sum(y.interestExpense)).toBeCloseTo(52500, 0);
  });
  it('repayments that come back as a shareholder contribution a month later', () => {
    const y = loanYear(loan({ repaymentType: 'CUSTOM', contributionLagMonths: 1 }), [{ date: '2027-03-31', kind: 'REPAYMENT', amount: 100000 }], 2027);
    expect(y.principalRepaid[2]).toBe(100000);
    expect(y.contributions[3]).toBe(100000);
    expect(y.closing[11]).toBe(900000);
  });
  it('a drawdown in the year raises the balance from its date', () => {
    const y = loanYear(loan({ openingBalance: 0 }), [{ date: '2027-07-01', kind: 'DRAWDOWN', amount: 500000 }], 2027);
    expect(y.drawdowns[6]).toBe(500000);
    expect(sum(y.interestExpense)).toBeCloseTo((500000 * 0.07 * 184) / 365, 0);
  });
});

describe('fixed deposits', () => {
  it('a deposit placed on 1 January for a year: a year of interest, received at maturity', () => {
    const y = depositYear({ amount: 1_000_000, placementDate: '2027-01-01', maturityDate: '2028-01-01', rate: 0.04, dayBasis: 'ACT/365', interestPayout: 'MATURITY', rollover: false, rolloverRate: null }, 2027);
    expect(sum(y.interest)).toBeCloseTo(40000, 0);
    expect(y.placed[0]).toBe(1_000_000);
    expect(sum(y.interestReceived)).toBe(0); // matures on 1-Jan-2028
    expect(y.closing[11]).toBe(1_000_000);
  });
  it('placed before the year, maturing in June and rolled over at a new rate', () => {
    const y = depositYear({ amount: 1_000_000, placementDate: '2026-06-30', maturityDate: '2027-06-30', rate: 0.04, dayBasis: 'ACT/365', interestPayout: 'MATURITY', rollover: true, rolloverRate: 0.035 }, 2027);
    expect(y.placed.every((v) => v === 0)).toBe(true);
    expect(sum(y.matured)).toBe(0);
    expect(y.interestReceived[5]).toBeCloseTo(40000, 0);
    expect(sum(y.interest)).toBeCloseTo((1_000_000 * 0.04 * 180) / 365 + (1_000_000 * 0.035 * 185) / 365, 0);
  });
  it('monthly interest payout', () => {
    const y = depositYear({ amount: 1_200_000, placementDate: '2027-01-01', maturityDate: '2028-01-01', rate: 0.05, dayBasis: 'ACT/365', interestPayout: 'MONTHLY', rollover: false, rolloverRate: null }, 2027);
    expect(y.interestReceived.filter((v) => v > 0)).toHaveLength(11);
    expect(y.interestReceived[1]).toBeCloseTo((1_200_000 * 0.05 * 31) / 365, 0);
  });
});

describe('contingencies', () => {
  it('evenly, or in one month', () => {
    expect(sum(contingencyMonths({ amount: 120000, phasing: 'EVEN', month: null }))).toBeCloseTo(120000, 2);
    expect(contingencyMonths({ amount: 50000, phasing: 'MONTH', month: 9 })[8]).toBe(50000);
  });
});
