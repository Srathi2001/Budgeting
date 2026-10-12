// Dates inside the engine are integer day numbers (days since 1970-01-01, UTC).
// Using whole days avoids the fractional-date issues the Excel model has
// (e.g. cheques at start + 92.5 days that fall on the last day of a month at noon
// and get dropped by every month bucket).

export type Day = number;

const MS_PER_DAY = 86_400_000;

export function dayFromYMD(y: number, m: number, d: number): Day {
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** Parse 'YYYY-MM-DD' (or a full ISO string) into a Day. Returns null for empty input. */
export function parseDay(iso: string | null | undefined): Day | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return dayFromYMD(+m[1], +m[2], +m[3]);
}

export function formatDay(day: Day | null | undefined): string | null {
  if (day === null || day === undefined || Number.isNaN(day)) return null;
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Excel serial date (1900 date system) to Day. */
export function dayFromExcelSerial(serial: number): Day {
  // Excel serial 25569 = 1970-01-01. Drop any time-of-day fraction.
  return Math.floor(serial) - 25569;
}

export interface MonthBucket {
  month: number; // 1..12
  start: Day;
  end: Day; // inclusive
  days: number;
}

export function monthsOfYear(year: number): MonthBucket[] {
  const out: MonthBucket[] = [];
  for (let m = 1; m <= 12; m++) {
    const start = dayFromYMD(year, m, 1);
    const end = dayFromYMD(year, m + 1, 1) - 1;
    out.push({ month: m, start, end, days: end - start + 1 });
  }
  return out;
}

/** The same calendar date `years` later (29 February → 1 March of a non-leap year). */
export function addYears(day: Day, years: number): Day {
  const d = new Date(day * MS_PER_DAY);
  return dayFromYMD(d.getUTCFullYear() + years, d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Last day of a contract term that starts on `start`. A term of whole years (365 days a year, give or take
 * a day) runs in calendar years, to the day before the same date: 1-Jan-2028 → 31-Dec-2028, a leap year
 * included. Any other term is counted in days.
 */
export function termEnd(start: Day, termDays: number): Day {
  const years = Math.round(termDays / 365);
  if (years >= 1 && Math.abs(termDays - years * 365) <= years) return addYears(start, years) - 1;
  return start + termDays - 1;
}

export function overlapDays(aStart: Day, aEnd: Day, bStart: Day, bEnd: Day): number {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return e >= s ? e - s + 1 : 0;
}
