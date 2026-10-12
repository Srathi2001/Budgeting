// Building overheads: the last year's forecast and the calculated budgets (pure, shared by the page,
// the statements and the tests).
import type { BohPhasing, ContractTerms } from './boh-types';

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

/**
 * Y-1 forecast of a building's account from its actuals (`ytd`: Y-1 by month, `last`: Y-2 by month):
 * - water & electricity (seasonal): paid so far + last year's remaining months × (1 + uplift);
 * - paid once a year (due): this year's payment, or last year's if more (not paid yet, or paid in parts);
 * - paid in every month so far: the run-rate (so far ÷ months × 12), which also covers contracts new this year;
 * - otherwise (paid now and then): paid so far + what was paid in the remaining months last year.
 */
export function forecastY1(phasing: BohPhasing, ytd: number[] | undefined, last: number[] | undefined, cutoff: number, uplift = 0): number | null {
  if (!cutoff || (!ytd && !last)) return null;
  const done = ytd ? sum(ytd.slice(0, cutoff)) : 0;
  const rest = last ? sum(last.slice(cutoff)) : null;
  if (phasing === 'seasonal') return r2(done + (rest !== null ? rest : (done / cutoff) * (12 - cutoff)) * (1 + uplift));
  if (phasing === 'due') return r2(last ? Math.max(done, sum(last)) : done);
  const everyMonth = !!ytd && ytd.slice(0, cutoff).every((v) => Math.abs(v) >= 0.5);
  if (everyMonth) return r2((done / cutoff) * 12);
  return r2(done + (rest ?? 0));
}

/** water & electricity budget: the forecast × (1 + %) */
export const waterBudget = (forecast: number | null, pct: number) => (forecast === null ? null : r2(forecast * (1 + pct)));
/** PAR premium: insured value × last year's rate × (1 + %) */
export const parBudget = (insuredValue: number | null, rate: number | null, pct: number) => (insuredValue && rate ? r2(insuredValue * rate * (1 + pct)) : null);
/** public liability premium: last year's × (1 + %) */
export const plBudget = (premium: number | null, pct: number) => (premium ? r2(premium * (1 + pct)) : null);
/** watchmen: share of a watchman × cost per watchman */
export const watchmenBudget = (share: number | null, cost: number) => (share ? r2(share * cost) : null);

/** a contract's amount for the year */
export const contractAmount = (c: { quantity: number; rate: number }) => r2((c.quantity || 0) * (c.rate || 0));

/**
 * When a contract is paid: monthly from its start month (for its months when quantity is a number of
 * months, else to December); quarterly and half-yearly in equal parts from the start month (default March
 * / June); yearly and one-off in full in the start month (default January).
 */
export function contractMonths(c: { terms: ContractTerms; quantity: number; rate: number; startMonth: number | null }): number[] {
  const out = Array.from({ length: 12 }, () => 0);
  const amount = contractAmount(c);
  if (!amount) return out;
  const at = (m: number) => ((((m - 1) % 12) + 12) % 12);
  if (c.terms === 'Monthly') {
    const start = Math.min(Math.max(c.startMonth ?? 1, 1), 12);
    const q = Math.round(c.quantity);
    const months = Number.isInteger(c.quantity) && q >= 1 && q <= 12 ? Math.min(q, 13 - start) : 13 - start;
    for (let i = 0; i < months; i++) out[start - 1 + i] += amount / months;
    return out;
  }
  const parts = c.terms === 'Quarterly' ? 4 : c.terms === 'Half-yearly' ? 2 : 1;
  const start = c.startMonth ?? (c.terms === 'Quarterly' ? 3 : c.terms === 'Half-yearly' ? 6 : 1);
  const step = 12 / parts;
  for (let i = 0; i < parts; i++) out[at(start + i * step)] += amount / parts;
  return out;
}

// ---- contracts over their own period (audit FIN-008, user decision 12-Oct-2026) ----------------------

const DAY_MS = 86_400_000;
const dayOf = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
const parseIso = (s: string) => dayOf(Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10)));
export const isoDay = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);
const addMonths = (d: number, n: number) => {
  const x = new Date(d * DAY_MS);
  // the same day n months on (31st → the month's last day)
  const y = x.getUTCFullYear();
  const m = x.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Math.round(Date.UTC(y, m, Math.min(x.getUTCDate(), last)) / DAY_MS);
};

export interface ContractInput {
  terms: ContractTerms;
  quantity: number;
  rate: number;
  startMonth: number | null;
  startDate?: string | null;
  endDate?: string | null;
  renewal?: string | null;
  renewalRate?: number | null;
  renewalTerms?: string | null;
}

/** months a payment covers, by terms */
const STEP: Record<ContractTerms, number> = { Monthly: 1, Quarterly: 3, 'Half-yearly': 6, Yearly: 12, 'One-off': 0 };

/**
 * The contract's period: the dates entered; else it starts on the 1st of its start month of the budget
 * year (January when blank) and runs a year, or, paid monthly with a number of months, that many months.
 */
export function contractPeriod(c: ContractInput, year: number): { start: number; end: number } {
  const start = c.startDate ? parseIso(c.startDate) : dayOf(year, Math.min(Math.max(c.startMonth ?? 1, 1), 12), 1);
  if (c.endDate) return { start, end: parseIso(c.endDate) };
  const q = Math.round(c.quantity);
  const months = c.terms === 'Monthly' && Number.isInteger(c.quantity) && q >= 1 && q <= 36 ? q : 12;
  return { start, end: addMonths(start, months) - 1 };
}

/** one period of a contract in the budget year: the expense by the months it covers, the payments by its terms */
function periodYear(value: number, start: number, end: number, terms: ContractTerms, year: number) {
  const expense = Array.from({ length: 12 }, () => 0);
  const cash = Array.from({ length: 12 }, () => 0);
  const days = end - start + 1;
  if (!value || days <= 0) return { expense, cash };
  // the expense by month: each calendar month of the period weighs the share of it covered (a full month 1,
  // half of it 0.5), so 300 a month books 300 in every full month and a part month only its days
  const first = new Date(start * DAY_MS);
  const weights: { y: number; m: number; w: number }[] = [];
  for (let y = first.getUTCFullYear(), m = first.getUTCMonth() + 1; dayOf(y, m, 1) <= end; m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    const from = dayOf(y, m, 1);
    const to = dayOf(y, m + 1, 1) - 1;
    const covered = Math.min(end, to) - Math.max(start, from) + 1;
    if (covered > 0) weights.push({ y, m, w: covered / (to - from + 1) });
  }
  const totalWeight = weights.reduce((s, x) => s + x.w, 0);
  for (const x of weights) if (x.y === year) expense[x.m - 1] += (value * x.w) / totalWeight;
  // payments: monthly in advance each month; quarterly and half-yearly at the end of each part (as the
  // 2026 schedules: March / June …); yearly at the start of each year; one-off at the start
  const months = Math.max(1, Math.round(days / 30.4375));
  const step = STEP[terms];
  const due: number[] = [];
  if (!step) due.push(start);
  else if (terms === 'Monthly' || terms === 'Yearly') for (let k = 0; k * step < months; k++) due.push(addMonths(start, k * step));
  else for (let k = 0; k * step < months; k++) due.push(Math.min(addMonths(start, (k + 1) * step) - 1, end));
  const each = value / due.length;
  for (const d of due) {
    const x = new Date(d * DAY_MS);
    if (x.getUTCFullYear() === year) cash[x.getUTCMonth()] += each;
  }
  return { expense, cash };
}

export interface ContractYear {
  /** expense of the budget year by month */
  expense: number[];
  /** paid in the budget year by month */
  cash: number[];
  total: number;
  start: string;
  end: string;
  /** ends before 31 December of the budget year (or ended before it): renew or end? */
  endsBeforeYearEnd: boolean;
  /** ends before 31 December and nobody said whether it is renewed: flagged to the property manager */
  needsDecision: boolean;
}

/**
 * A contract in the budget year: its value (quantity × rate) spread over its own months (a part
 * month for its days), only the months inside the year booked; paid by its terms. Ending before 31 December: renewed (at the new rate and
 * terms, for the same length, again until the year is covered) or ended, as the property manager says.
 */
export function contractYear(c: ContractInput, year: number): ContractYear {
  const { start, end } = contractPeriod(c, year);
  const expense = Array.from({ length: 12 }, () => 0);
  const cash = Array.from({ length: 12 }, () => 0);
  const add = (p: { expense: number[]; cash: number[] }) => p.expense.forEach((v, i) => ((expense[i] += v), (cash[i] += p.cash[i])));
  add(periodYear(r2((c.quantity || 0) * (c.rate || 0)), start, end, c.terms, year));
  const yearEnd = dayOf(year, 12, 31);
  const endsBeforeYearEnd = end < yearEnd;
  if (endsBeforeYearEnd && c.renewal === 'RENEW') {
    const months = Math.max(1, Math.round((end - start + 1) / 30.4375));
    const value = r2((c.quantity || 0) * (c.renewalRate ?? c.rate ?? 0));
    const terms = (CONTRACT_TERMS_LIST as readonly string[]).includes(c.renewalTerms ?? '') ? (c.renewalTerms as ContractTerms) : c.terms;
    let from = end + 1;
    for (let i = 0; i < 12 && from <= yearEnd; i++) {
      const to = addMonths(from, months) - 1;
      add(periodYear(value, from, to, terms, year));
      from = to + 1;
    }
  }
  const total = r2(expense.reduce((s, v) => s + v, 0));
  return { expense, cash, total, start: isoDay(start), end: isoDay(end), endsBeforeYearEnd, needsDecision: endsBeforeYearEnd && !c.renewal };
}
const CONTRACT_TERMS_LIST = ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly', 'One-off'] as const;

/** terms read from a purchase order line: its wording, else 12 = monthly, 1 = one-off */
export function termsOf(description: string, quantity: number | null): ContractTerms {
  const d = description.toLowerCase();
  if (/half[\s-]*year/.test(d)) return 'Half-yearly';
  if (/quarter/.test(d)) return 'Quarterly';
  if (/\byearly\b|\bannual(ly)?\b|per annum/.test(d) && !/monthly/.test(d)) return 'Yearly';
  if (/month/.test(d) || quantity === 12) return 'Monthly';
  if (!quantity || quantity === 1) return 'One-off';
  return 'Monthly';
}
