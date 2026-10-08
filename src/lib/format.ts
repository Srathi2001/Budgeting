// How numbers and dates show across the tool (and its Excel files):
// amounts 1,234,567.89 with negatives in brackets and zero as a dash; percentages 12.35%; counts as whole
// numbers (a fraction keeps up to 2 decimals: 2.7 watchmen); short amounts in charts and tiles 259.36M;
// dates 08-Oct-2026.

const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfCount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const nfDec = (d: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Amounts: thousands separators, 2 decimals, negatives in brackets, zero as a dash. */
export function fmt(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  if (Math.abs(n) < 0.5 * 10 ** -decimals) return '-';
  const s = (decimals === 2 ? nf2 : nfDec(decimals)).format(Math.abs(n));
  return n < 0 ? `(${s})` : s;
}

/** Counts (units, months, people): whole numbers with separators; a fraction keeps up to 2 decimals. */
export function count(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return nfCount.format(n);
}

/** Percentages of a fraction (0.1235 → 12.35%). */
export function pct(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const s = (n * 100).toFixed(decimals);
  return `${Number(s) === 0 ? (0).toFixed(decimals) : s}%`;
}

/** A change in percent with its sign (+3.25% / −1.10%). */
export const pctSigned = (n: number | null | undefined, decimals = 2) => (n === null || n === undefined || !Number.isFinite(n) ? '' : `${n < 0 ? '−' : '+'}${pct(Math.abs(n), decimals)}`);

/** Short amounts for charts and tiles: 1.25B, 259.36M, 450.50K, 950.00 (negatives with a minus). */
export function short(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${nf2.format(a / 1e9)}B` : a >= 1e6 ? `${nf2.format(a / 1e6)}M` : a >= 1e3 ? `${nf2.format(a / 1e3)}K` : nf2.format(a);
  return n < 0 ? `−${s}` : s;
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Dates: 08-Oct-2026 (from yyyy-mm-dd, a Date or a timestamp). */
export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return '';
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (!m) return v;
    return `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}`;
  }
  const d = new Date(v.toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

/** Date and time in Dubai: 08-Oct-2026 14:05. */
export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return '';
  const d = new Date(new Date(v).toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Reads a typed date: 08-Oct-2026, 8/10/2026, 8-10-26 or 2026-10-08 → yyyy-mm-dd (null when not a date). */
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[\s/.-]([A-Za-z]{3})[A-Za-z]*[\s/.-](\d{2,4})$/.exec(s);
  if (m) {
    const mo = MONTHS.findIndex((x) => x.toLowerCase() === m![2].toLowerCase());
    if (mo < 0) return null;
    return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** Excel number formats with the same rules (amounts, counts, percentages, dates). */
export const XL = {
  amount: '#,##0.00;(#,##0.00);"-"',
  count: '#,##0',
  pct: '0.00%',
  date: 'dd-mmm-yyyy',
} as const;

export function sum(a: number[]) {
  return a.reduce((x, y) => x + y, 0);
}
