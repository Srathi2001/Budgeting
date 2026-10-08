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
