// Lease revenue / cash / fee engine.
//
// Re-implements the PM budget template logic:
//   Main sheet    -> renewal derivation (dates, rent via RERA index, MF flag)
//   Revenue sheet -> daily rate x days of each contract falling in each month
//   Cash sheet    -> equal cheques spaced chequeSpanDays / cheques apart, unless the contract has an
//                    actual cheque schedule (current lease from Fusion, or one edited for a renewal)
//   Admin/EF/MF/AF sheets -> fees booked in the month a contract starts

import { type Assumptions } from './assumptions';
import { type Day, monthsOfYear, overlapDays, dayFromYMD } from './dates';

export type RC = 'R' | 'C' | 'L';
export type StaffOwner = 'STAFF' | 'OWNER' | null;

export interface Cheque {
  date: Day;
  amount: number;
}

export type ScheduleSource = 'ACTUAL' | 'CUSTOM' | 'EQUAL';

export interface LeaseInput {
  rc: RC;
  isCamp: boolean;
  area: number | null;
  capacity: number | null;
  staffOwner: StaffOwner;
  mfCurrent: boolean | null;

  currentRent: number | null;
  currentStart: Day | null;
  currentEnd: Day | null;
  /** Actual cheque schedule of the current lease (Fusion lease schedules, or entered manually). */
  currentSchedule: Cheque[] | null;
  /** Security deposit held for the current lease; null = assumption % of rent. */
  securityDeposit: number | null;

  /** Will the current tenant renew? (Main!R "Renew (Y/N)") */
  renew1: boolean;
  /** Unit is not re-let after the current contract (e.g. plot handed back, unit withdrawn). */
  noRenewal: boolean;

  // 1st renewal: null = derive per template logic, value = PM override
  r1Rent: number | null;
  r1Start: Day | null;
  r1End: Day | null;
  r1Mf: boolean | null;
  /** Edited cheque schedule for the 1st renewal; null = equal cheques. */
  r1Schedule: Cheque[] | null;

  // 2nd renewal: derived automatically when the 1st renewal ends inside the budget year
  r2Renew: boolean | null;
  r2Rent: number | null;
  r2Start: Day | null;
  r2End: Day | null;
  r2Mf: boolean | null;
  r2Schedule: Cheque[] | null;

  /** Budget rate for a new tenant. R: annual rent; C/L: per sq.ft per year; camps: per bed per month. */
  budgetRate: number | null;
  /** Overrides the RERA / labour / camp renewal increase (fraction). */
  increasePctOverride: number | null;
  /** Cheques per contract when no schedule is given (renewals); null = assumption default (4). */
  cheques: number | null;
}

export interface ReraRange {
  min: number;
  max: number;
}

export type ContractKind = 'CURRENT' | 'RENEWAL1' | 'RENEWAL2';

export interface Contract {
  kind: ContractKind;
  rent: number;
  start: Day;
  end: Day;
  mf: boolean;
  /** true when the contract is with a new tenant (drives agency commission). */
  newTenant: boolean;
  /** true when this contract's values were derived rather than entered. */
  derived: { rent: boolean; start: boolean; end: boolean; mf: boolean };
  /** Cheques for this contract (all of them, not only those inside the budget year). */
  schedule: Cheque[];
  scheduleSource: ScheduleSource;
}

export interface MonthlySeries {
  revenue: number[];
  cash: number[];
  adminFee: number[];
  ejariFee: number[];
  mfFee: number[];
  agencyFee: number[];
  /** Output VAT collected with rent cheques (commercial / labour) and fees. */
  vat: number[];
  depositIn: number[];
  depositOut: number[];
}

export interface LeaseResult extends MonthlySeries {
  contracts: Contract[];
  /** Renewal increase actually used for the 1st renewal (fraction), when it was a renewal. */
  increasePct: number | null;
  /** How far the current rent sits below the RERA average (fraction), when an index exists. */
  reraGap: number | null;
  reraAverage: number | null;
  /** Revenue lost to the vacancy gap between a non-renewed lease and the next tenant, within the year. */
  vacancyLoss: number;
  /** cash = rent cheques (ex VAT); cashFlow = rent + fees + VAT + deposits in - deposits out */
  totals: { revenue: number; cash: number; otherIncome: number; cashFlow: number };
  warnings: string[];
}

const zeros = (): number[] => Array.from({ length: 12 }, () => 0);

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function reraIncrease(
  input: LeaseInput,
  a: Assumptions,
  rera: ReraRange | null,
): { increase: number; gap: number | null; avg: number | null; warning?: string } {
  if (input.isCamp) return { increase: a.campIncrease, gap: null, avg: null };
  if (input.rc === 'L') return { increase: a.labourIncrease, gap: null, avg: null };
  if (!rera || !(rera.min > 0 || rera.max > 0)) {
    return { increase: 0, gap: null, avg: null, warning: 'No RERA index for this property/bedroom: renewal increase set to 0%' };
  }
  const avg = (rera.min + rera.max) / 2;
  const discount = input.staffOwner === 'STAFF' ? a.staffDiscount : 0;
  const rent = (input.currentRent ?? 0) / (1 - discount);
  let gap: number;
  if (input.rc === 'R') {
    gap = (avg - rent) / avg;
  } else {
    if (!input.area) return { increase: 0, gap: null, avg, warning: 'Commercial unit has no area: cannot compare with RERA rate' };
    gap = (avg - rent / input.area) / avg;
  }
  const band = [...a.reraBands].sort((x, y) => y.gapAbove - x.gapAbove).find((b) => gap > b.gapAbove);
  return { increase: band ? band.increase : 0, gap, avg };
}

function newTenantRent(input: LeaseInput): number | null {
  if (input.budgetRate === null) return null;
  if (input.isCamp) return input.capacity ? input.budgetRate * input.capacity * 12 : null;
  if (input.rc === 'R') return input.budgetRate;
  return input.area ? input.budgetRate * input.area : null;
}

/** Equal cheques, the first on the start date, then every span / n days (Cash sheet: 370 / 4). */
export function equalSchedule(start: Day, rent: number, cheques: number, spanDays: number): Cheque[] {
  const n = Math.max(1, Math.round(cheques));
  const interval = spanDays / n;
  const amount = rent / n;
  return Array.from({ length: n }, (_, k) => ({ date: start + Math.floor(k * interval), amount }));
}

type ContractTerms = Omit<Contract, 'schedule' | 'scheduleSource'>;

/** Build the contract chain (current, 1st renewal, 2nd renewal) for a unit. */
export function buildContracts(
  input: LeaseInput,
  year: number,
  a: Assumptions,
  rera: ReraRange | null,
): Pick<LeaseResult, 'contracts' | 'increasePct' | 'reraGap' | 'reraAverage' | 'warnings'> {
  const warnings: string[] = [];
  const contracts: Contract[] = [];
  const cheques = input.cheques ?? a.defaultCheques;
  const add = (t: ContractTerms, given: Cheque[] | null, source: ScheduleSource) => {
    const c: Contract = given?.length
      ? { ...t, schedule: [...given].sort((x, y) => x.date - y.date), scheduleSource: source }
      : { ...t, schedule: equalSchedule(t.start, t.rent, cheques, a.chequeSpanDays), scheduleSource: 'EQUAL' };
    if (given?.length) {
      const total = given.reduce((s, q) => s + q.amount, 0);
      if (t.rent > 0 && Math.abs(total - t.rent) / t.rent > 0.01) {
        const label = { CURRENT: 'Current', RENEWAL1: '1st renewal', RENEWAL2: '2nd renewal' }[t.kind];
        warnings.push(`${label} cheque schedule totals ${Math.round(total).toLocaleString('en-US')}, rent is ${Math.round(t.rent).toLocaleString('en-US')}`);
      }
    }
    contracts.push(c);
    return c;
  };
  const yearEnd = dayFromYMD(year, 12, 31);
  let increasePct: number | null = null;
  let reraGap: number | null = null;
  let reraAverage: number | null = null;

  const hasCurrent = input.currentStart !== null && input.currentEnd !== null;
  if (hasCurrent) {
    if (input.currentEnd! < input.currentStart!) warnings.push('Current contract ends before it starts');
    add(
      {
        kind: 'CURRENT',
        rent: input.currentRent ?? 0,
        start: input.currentStart!,
        end: input.currentEnd!,
        mf: input.rc !== 'C' && input.mfCurrent === true,
        newTenant: false,
        derived: { rent: false, start: false, end: false, mf: false },
      },
      input.currentSchedule,
      'ACTUAL',
    );
  }

  if (input.staffOwner === 'OWNER' || input.noRenewal) return { contracts, increasePct, reraGap, reraAverage, warnings };

  // ---- 1st renewal -------------------------------------------------------
  let r1Start = input.r1Start;
  const r1StartDerived = r1Start === null;
  if (r1Start === null && hasCurrent) {
    r1Start = input.renew1 ? input.currentEnd! + 1 : input.currentEnd! + a.vacancyGapDays;
  }
  if (r1Start === null) return { contracts, increasePct, reraGap, reraAverage, warnings };

  let r1End = input.r1End;
  const r1EndDerived = r1End === null;
  if (r1End === null) r1End = r1Start + a.renewalTermDays - 1;

  let r1Rent = input.r1Rent;
  const r1RentDerived = r1Rent === null;
  const inc = reraIncrease(input, a, rera);
  reraGap = inc.gap;
  reraAverage = inc.avg;
  if (input.renew1) {
    increasePct = input.increasePctOverride ?? inc.increase;
    if (r1Rent === null) {
      // zero-rent units (e.g. bulk leases billed on one unit) have nothing to compare with RERA
      if (inc.warning && input.increasePctOverride === null && (input.currentRent ?? 0) > 0) warnings.push(inc.warning);
      r1Rent = (input.currentRent ?? 0) * (1 + increasePct);
    }
  } else if (r1Rent === null) {
    r1Rent = newTenantRent(input);
    if (r1Rent === null) {
      r1Rent = input.currentRent ?? 0;
      warnings.push('New-tenant lease has no budget rate: using current rent');
    }
  }

  // Main!S: MF on renewal. Commercial never; residential keeps MF, or gets MF when a new tenant comes in.
  let r1Mf = input.r1Mf;
  const r1MfDerived = r1Mf === null;
  if (r1Mf === null) {
    if (input.rc === 'C') r1Mf = false;
    else if (input.mfCurrent === true) r1Mf = true;
    else r1Mf = !input.renew1;
  }

  if (hasCurrent && r1Start <= input.currentEnd!) warnings.push('1st renewal starts before the current contract ends');

  const r1 = add(
    {
      kind: 'RENEWAL1',
      rent: r1Rent,
      start: r1Start,
      end: r1End,
      mf: r1Mf,
      newTenant: !input.renew1,
      derived: { rent: r1RentDerived, start: r1StartDerived, end: r1EndDerived, mf: r1MfDerived },
    },
    input.r1Schedule,
    'CUSTOM',
  );

  // ---- 2nd renewal (Main!W..AA: only when the 1st renewal ends inside the budget year) ----
  const r2Wanted = input.r2Start !== null || r1.end < yearEnd;
  if (r2Wanted && input.r2Renew !== false) {
    const r2Start = input.r2Start ?? r1.end + 1;
    const r2End = input.r2End ?? r2Start + a.renewalTermDays - 1;
    add(
      {
        kind: 'RENEWAL2',
        rent: input.r2Rent ?? r1.rent,
        start: r2Start,
        end: r2End,
        mf: input.r2Mf ?? r1.mf,
        newTenant: false,
        derived: {
          rent: input.r2Rent === null,
          start: input.r2Start === null,
          end: input.r2End === null,
          mf: input.r2Mf === null,
        },
      },
      input.r2Schedule,
      'CUSTOM',
    );
  }

  return { contracts, increasePct, reraGap, reraAverage, warnings };
}

export function computeLease(
  input: LeaseInput,
  year: number,
  a: Assumptions,
  rera: ReraRange | null = null,
): LeaseResult {
  const chain = buildContracts(input, year, a, rera);
  const months = monthsOfYear(year);
  const s: MonthlySeries = {
    revenue: zeros(),
    cash: zeros(),
    adminFee: zeros(),
    ejariFee: zeros(),
    mfFee: zeros(),
    agencyFee: zeros(),
    vat: zeros(),
    depositIn: zeros(),
    depositOut: zeros(),
  };
  const monthIndexOf = (d: Day) => months.findIndex((m) => d >= m.start && d <= m.end);
  const adminFee = input.rc === 'R' ? a.adminFeeResidential : a.adminFeeCommercial;
  // Residential rent is VAT exempt; commercial and labour accommodation rent is standard rated
  const rentVat = input.rc === 'R' ? 0 : a.vatRate;

  for (const c of chain.contracts) {
    const length = c.end - c.start + 1;
    if (length <= 0) continue;
    const daily = c.rent / length;

    // Revenue: straight-line by day
    for (const m of months) {
      const d = overlapDays(c.start, c.end, m.start, m.end);
      if (d) s.revenue[m.month - 1] += d * daily;
    }

    // Cash: the contract's cheque schedule (actual, edited, or equal cheques), plus VAT on rent
    for (const q of c.schedule) {
      const mi = monthIndexOf(q.date);
      if (mi < 0) continue;
      s.cash[mi] += q.amount;
      s.vat[mi] += q.amount * rentVat;
    }

    // Fees: booked and collected in the month the contract starts; all fees carry VAT
    const si = monthIndexOf(c.start);
    if (si < 0) continue;
    // Admin sheet: charged on every contract start except a 1st renewal that goes to a new tenant
    const fees = {
      admin: !(c.kind === 'RENEWAL1' && c.newTenant) ? adminFee : 0,
      ejari: a.ejariFee,
      mf: c.mf ? c.rent * a.mfPct : 0,
      agency: c.newTenant ? c.rent * a.agencyPct : 0,
    };
    s.adminFee[si] += fees.admin;
    s.ejariFee[si] += fees.ejari;
    s.mfFee[si] += fees.mf;
    s.agencyFee[si] += fees.agency;
    s.vat[si] += (fees.admin + fees.ejari + fees.mf + fees.agency) * a.vatRate;

    // Security deposit received from a new tenant
    if (c.newTenant) s.depositIn[si] += c.rent * a.depositPct;
  }

  const cur = chain.contracts.find((c) => c.kind === 'CURRENT');
  const r1 = chain.contracts.find((c) => c.kind === 'RENEWAL1');

  // Security deposit refunded when the current tenant leaves (the month after the lease ends)
  const leaves = cur && (!r1 || r1.newTenant) && input.staffOwner !== 'OWNER';
  if (cur && leaves) {
    const mi = monthIndexOf(cur.end + 1);
    if (mi >= 0) s.depositOut[mi] += input.securityDeposit ?? cur.rent * a.depositPct;
  }

  // Vacancy loss: days between a non-renewed lease ending and the new tenant starting,
  // valued at the new tenant's daily rate, limited to the budget year.
  let vacancyLoss = 0;
  if (cur && r1 && r1.newTenant && r1.start > cur.end + 1) {
    const gap = overlapDays(cur.end + 1, r1.start - 1, months[0].start, months[11].end);
    vacancyLoss = gap * (r1.rent / (r1.end - r1.start + 1));
  }

  const round = (arr: number[]) => arr.map(round2);
  const out: MonthlySeries = {
    revenue: round(s.revenue),
    cash: round(s.cash),
    adminFee: round(s.adminFee),
    ejariFee: round(s.ejariFee),
    mfFee: round(s.mfFee),
    agencyFee: round(s.agencyFee),
    vat: round(s.vat),
    depositIn: round(s.depositIn),
    depositOut: round(s.depositOut),
  };
  const sum = (arr: number[]) => round2(arr.reduce((x, y) => x + y, 0));
  const otherIncome = round2(sum(out.adminFee) + sum(out.ejariFee) + sum(out.mfFee) + sum(out.agencyFee));
  return {
    ...chain,
    ...out,
    vacancyLoss: round2(vacancyLoss),
    totals: {
      revenue: sum(out.revenue),
      cash: sum(out.cash),
      otherIncome,
      cashFlow: round2(sum(out.cash) + otherIncome + sum(out.vat) + sum(out.depositIn) - sum(out.depositOut)),
    },
  };
}

/** Total cash inflow for one month of a series: rent + fees + VAT + deposits received - deposits refunded. */
export function cashFlowOf(s: MonthlySeries, i: number) {
  return s.cash[i] + s.adminFee[i] + s.ejariFee[i] + s.mfFee[i] + s.agencyFee[i] + s.vat[i] + s.depositIn[i] - s.depositOut[i];
}
