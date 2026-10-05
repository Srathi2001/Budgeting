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

export function overlapDays(aStart: Day, aEnd: Day, bStart: Day, bEnd: Day): number {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return e >= s ? e - s + 1 : 0;
}
