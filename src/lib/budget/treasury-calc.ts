// Shareholder loans, fixed deposits and contingencies over the budget year (pure: the Finance tabs, the
// statements and the tests share it). Interest accrues day by day on the balance (ACT/365, or 30/360);
// the expense or income is the month's accrual, the cash is what falls due in the month.

const DAY_MS = 86_400_000;
const dayOf = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
const parse = (s: string) => dayOf(Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10)));
const monthIdx = (d: number) => new Date(d * DAY_MS).getUTCMonth();
const yearOf = (d: number) => new Date(d * DAY_MS).getUTCFullYear();
const addMonths = (d: number, n: number) => {
  const x = new Date(d * DAY_MS);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n + 1, 0)).getUTCDate();
  return Math.round(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, Math.min(x.getUTCDate(), last)) / DAY_MS);
};
const z12 = () => Array.from({ length: 12 }, () => 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

export const FREQUENCIES = ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
const STEP: Record<Frequency, number> = { Monthly: 1, Quarterly: 3, 'Half-yearly': 6, Yearly: 12 };
export const REPAYMENT_TYPES = ['EQUAL_PRINCIPAL', 'ANNUITY', 'BULLET', 'CUSTOM'] as const;
export type RepaymentType = (typeof REPAYMENT_TYPES)[number];
export const REPAYMENT_LABEL: Record<RepaymentType, string> = { EQUAL_PRINCIPAL: 'Equal principal', ANNUITY: 'Equal instalments', BULLET: 'At maturity', CUSTOM: 'Custom schedule' };
export const DAY_BASES = ['ACT/365', '30/360'] as const;

/** interest of one day on a balance */
const dayRate = (rate: number, basis: string) => rate / (basis === '30/360' ? 360 : 365);

// ---- shareholder loans ----------------------------------------------------------------------------------

export interface LoanInput {
  openingBalance: number;
  rate: number;
  dayBasis: string;
  interestFrequency: string;
  firstInterestDate: string | null;
  repaymentType: string;
  repaymentFrequency: string;
  firstRepaymentDate: string | null;
  maturityDate: string | null;
  capitalisePct: number;
  contributionLagMonths: number | null;
}
export interface LoanEvent {
  date: string;
  kind: string; // DRAWDOWN / REPAYMENT
  amount: number;
}

export interface LoanYear {
  /** interest charged to the P&L (after the capitalised share) */
  interestExpense: number[];
  /** interest added to the project (work in progress) */
  interestCapitalised: number[];
  interestPaid: number[];
  principalRepaid: number[];
  drawdowns: number[];
  /** repayments coming back as a shareholder contribution */
  contributions: number[];
  /** balance at each month end */
  closing: number[];
  opening: number;
}

const freq = (s: string): Frequency => ((FREQUENCIES as readonly string[]).includes(s) ? (s as Frequency) : 'Quarterly');

/** the dates of a schedule from its first date, every `step` months, up to `until` */
function dates(first: number, step: number, until: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 600; k++) {
    const d = addMonths(first, k * step);
    if (d > until) break;
    out.push(d);
  }
  return out;
}

/**
 * A shareholder loan in the budget year: from the balance at 1 January, the drawdowns and repayments of the
 * year (by its repayment type, or the custom events), interest accrued daily, paid on its interest dates.
 */
export function loanYear(loan: LoanInput, events: LoanEvent[], year: number): LoanYear {
  const ys = dayOf(year, 1, 1);
  const ye = dayOf(year, 12, 31);
  const maturity = loan.maturityDate ? parse(loan.maturityDate) : null;
  const out: LoanYear = { interestExpense: z12(), interestCapitalised: z12(), interestPaid: z12(), principalRepaid: z12(), drawdowns: z12(), contributions: z12(), closing: z12(), opening: loan.openingBalance };

  // drawdowns of the year (any loan); repayments by type
  const draws = events.filter((e) => e.kind === 'DRAWDOWN').map((e) => ({ d: parse(e.date), amount: e.amount }));
  let repay: { d: number; amount: number | null }[] = [];
  const type = (REPAYMENT_TYPES as readonly string[]).includes(loan.repaymentType) ? (loan.repaymentType as RepaymentType) : 'EQUAL_PRINCIPAL';
  if (type === 'CUSTOM') repay = events.filter((e) => e.kind === 'REPAYMENT').map((e) => ({ d: parse(e.date), amount: e.amount }));
  else if (type === 'BULLET') repay = maturity ? [{ d: maturity, amount: null }] : [];
  else if (loan.firstRepaymentDate && maturity) repay = dates(parse(loan.firstRepaymentDate), STEP[freq(loan.repaymentFrequency)], maturity).map((d) => ({ d, amount: null }));
  const interestDates = loan.firstInterestDate ? new Set(dates(parse(loan.firstInterestDate), STEP[freq(loan.interestFrequency)], maturity ?? ye + 3650)) : new Set<number>();

  // walk day by day through the year (the instalments still to come decide equal-principal amounts)
  let balance = loan.openingBalance;
  // drawdowns before the year are in the opening balance; repayments before the year too
  const pendingRepay = repay.filter((r) => r.d >= ys).sort((a, b) => a.d - b.d);
  const perRate = loan.rate * (STEP[freq(loan.repaymentFrequency)] / 12);
  let accrued = 0;
  for (let d = ys; d <= ye; d++) {
    for (const w of draws) if (w.d === d) {
      balance += w.amount;
      out.drawdowns[monthIdx(d)] += w.amount;
    }
    // interest of the day on the balance before any repayment that day
    const i = balance > 0 ? balance * dayRate(loan.rate, loan.dayBasis) : 0;
    accrued += i;
    out.interestExpense[monthIdx(d)] += i * (1 - loan.capitalisePct);
    out.interestCapitalised[monthIdx(d)] += i * loan.capitalisePct;
    if (interestDates.has(d) || (maturity !== null && d === maturity)) {
      out.interestPaid[monthIdx(d)] += accrued;
      accrued = 0;
    }
    const due = pendingRepay.filter((r) => r.d === d);
    for (const r of due) {
      const left = pendingRepay.filter((x) => x.d >= d).length;
      let amount = r.amount ?? 0;
      if (r.amount === null) {
        if (type === 'BULLET') amount = balance;
        else if (type === 'EQUAL_PRINCIPAL') amount = balance / Math.max(left, 1);
        else {
          // equal instalments: payment = balance × r / (1 − (1 + r)^−n); principal = payment − the period's interest
          const pay = perRate > 0 ? (balance * perRate) / (1 - (1 + perRate) ** -left) : balance / Math.max(left, 1);
          amount = Math.max(0, pay - balance * perRate);
        }
      }
      amount = Math.min(amount, balance);
      balance -= amount;
      out.principalRepaid[monthIdx(d)] += amount;
      // repaid, then given back as a contribution some months later (the 2026 file: a month)
      if (loan.contributionLagMonths !== null && loan.contributionLagMonths >= 0) {
        const back = addMonths(d, loan.contributionLagMonths);
        if (yearOf(back) === year) out.contributions[monthIdx(back)] += amount;
      }
    }
    pendingRepay.splice(0, pendingRepay.length, ...pendingRepay.filter((r) => r.d > d));
    if (d === dayOf(year, monthIdx(d) + 2, 1) - 1) out.closing[monthIdx(d)] = r2(balance);
  }
  for (const k of ['interestExpense', 'interestCapitalised', 'interestPaid', 'principalRepaid', 'drawdowns', 'contributions'] as const) out[k] = out[k].map(r2);
  return out;
}

// ---- fixed deposits -------------------------------------------------------------------------------------

export interface DepositInput {
  amount: number;
  placementDate: string | null;
  maturityDate: string | null;
  rate: number;
  dayBasis: string;
  interestPayout: string; // MATURITY / MONTHLY / QUARTERLY
  rollover: boolean;
  rolloverRate: number | null;
}
export interface DepositYear {
  /** interest income by month (accrued) */
  interest: number[];
  interestReceived: number[];
  /** cash out when placed in the year, cash in when it matures (not rolled over) */
  placed: number[];
  matured: number[];
  /** balance at each month end */
  closing: number[];
}

/**
 * A fixed deposit in the budget year: interest accrues daily while it is placed; paid monthly, quarterly
 * or at maturity; at maturity it is placed again for the same term (at the rollover rate) when it rolls over.
 */
export function depositYear(fd: DepositInput, year: number): DepositYear {
  const ys = dayOf(year, 1, 1);
  const ye = dayOf(year, 12, 31);
  const out: DepositYear = { interest: z12(), interestReceived: z12(), placed: z12(), matured: z12(), closing: z12() };
  if (!fd.amount || !fd.placementDate) return out;
  const placedOn = parse(fd.placementDate);
  if (placedOn >= ys && placedOn <= ye) out.placed[monthIdx(placedOn)] += fd.amount;
  let start = placedOn;
  let end = fd.maturityDate ? parse(fd.maturityDate) : ye + 3650;
  const termMonths = fd.maturityDate ? Math.max(1, Math.round((end - start) / 30.4375)) : 0;
  let rate = fd.rate;
  const step = fd.interestPayout === 'MONTHLY' ? 1 : fd.interestPayout === 'QUARTERLY' ? 3 : 0;
  const payouts = () => new Set(step ? dates(addMonths(start, step), step, end - 1) : []);
  let pay = payouts();
  let accrued = 0;
  let live = placedOn < ys;
  // a term that started before the year: interest owed from the last payout before 1 January
  for (let d = Math.min(ys, placedOn); d <= ye; d++) {
    if (d === start) live = true;
    if (live && pay.has(d)) {
      if (d >= ys) out.interestReceived[monthIdx(d)] += accrued;
      accrued = 0;
    }
    if (live && d === end) {
      if (d >= ys) out.interestReceived[monthIdx(d)] += accrued;
      accrued = 0;
      if (fd.rollover && termMonths) {
        start = end;
        end = addMonths(start, termMonths);
        rate = fd.rolloverRate ?? rate;
        pay = payouts();
      } else {
        if (d >= ys) out.matured[monthIdx(d)] += fd.amount;
        live = false;
      }
    }
    if (live && d >= start && d < end) {
      const i = fd.amount * dayRate(rate, fd.dayBasis);
      accrued += i;
      if (d >= ys) out.interest[monthIdx(d)] += i;
    }
    if (d >= ys && d === dayOf(year, monthIdx(d) + 2, 1) - 1) out.closing[monthIdx(d)] = live ? fd.amount : 0;
  }
  for (const k of ['interest', 'interestReceived', 'placed', 'matured'] as const) out[k] = out[k].map(r2);
  return out;
}
// ---- contingencies --------------------------------------------------------------------------------------

export function contingencyMonths(c: { amount: number; phasing: string; month: number | null }): number[] {
  const out = z12();
  if (!c.amount) return out;
  if (c.phasing === 'MONTH' && c.month && c.month >= 1 && c.month <= 12) out[c.month - 1] = c.amount;
  else {
    // evenly, the cents left over in December so the months add up to the amount
    const each = r2(c.amount / 12);
    return out.map((_, i) => (i < 11 ? each : r2(c.amount - each * 11)));
  }
  return out;
}
