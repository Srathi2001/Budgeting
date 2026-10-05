const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Accounting style: thousands separators, negatives in brackets, zero as a dash. */
export function fmt(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  if (Math.abs(n) < (decimals ? 0.005 : 0.5)) return '-';
  const s = (decimals ? nf2 : nf0).format(Math.abs(n));
  return n < 0 ? `(${s})` : s;
}

export function pct(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const s = (n * 100).toFixed(decimals);
  return `${Number(s) === 0 ? (0).toFixed(decimals) : s}%`;
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function sum(a: number[]) {
  return a.reduce((x, y) => x + y, 0);
}
