// Oracle "Account Analysis Report" (Analytics Publisher, saved as .xls): a MIME web page with one
// table per GL account and its journal lines. The full ledger export is hundreds of MB, so it is
// read as a stream and only monthly debit / credit totals per account are kept. Customer names and
// line descriptions are never kept.
//
// Account code: company-??-cost centre-property-natural account-…  e.g. 501-00-206-30B101-52401-00000-000-000

export interface GlMonth {
  account: string;
  month: string; // YYYY-MM
  debit: number;
  credit: number;
  lines: number;
}

export interface GlScan {
  /** the report's title row: "Account Analysis Report" (or "Account Wise Analysis Report", a different layout) */
  title: string | null;
  ledger: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  /** account → description (the segment names joined with "-") */
  descriptions: Map<string, string>;
  months: GlMonth[];
  /** accounts where opening balance + lines ≠ the report's account total (should be none) */
  mismatches: { account: string; opening: number; activity: number; total: number }[];
  accounts: number;
  lines: number;
}

const MON: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

const text = (h: string) =>
  h
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ')
    .trim();
const amount = (s: string | undefined) => {
  const n = Number((s ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const utf8 = (s: string) => Buffer.from(s, 'latin1').toString('utf8');

function cellsOf(row: string): string[] {
  const cells: string[] = [];
  for (const m of row.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/g)) {
    const span = Number(/colspan="?(\d+)/.exec(m[1])?.[1] ?? 1);
    cells.push(text(m[2]));
    for (let i = 1; i < span; i++) cells.push('');
  }
  return cells;
}

/**
 * Reads the report from a stream of bytes (a file stream or an upload). `keep` limits the accounts
 * whose monthly totals are returned (by full account code); all accounts are still reconciled.
 */
export async function scanAccountAnalysis(source: AsyncIterable<Uint8Array | string>, keep: (account: string) => boolean = () => true): Promise<GlScan> {
  const scan: GlScan = { title: null, ledger: null, periodFrom: null, periodTo: null, descriptions: new Map(), months: [], mismatches: [], accounts: 0, lines: 0 };
  const agg = new Map<string, GlMonth>();
  let header: string[] = [];
  let account: string | null = null;
  let opening = 0;
  let activity = 0;
  let sawOpening = false;
  let isMime = false;
  let qp = false;
  let started = false;
  let complete = false;

  const col = (name: string) => header.indexOf(name);
  const onRow = (row: string) => {
    const c = cellsOf(row);
    if (!c.length) return;
    scan.title ??= c.find((x) => /Analysis Report$/.test(x)) ?? null;
    if (c[0] === 'Period From') {
      scan.periodFrom = c[1] || null;
      scan.periodTo = c[c.indexOf('Period To') + 1] || null;
      return;
    }
    if (c[0] === 'Ledger Name' || c[0] === 'Ledger or Ledger Set') {
      scan.ledger ??= c.slice(1).find(Boolean) ?? null;
      return;
    }
    if (c.includes('Total for Ledger')) {
      complete = true;
      return;
    }
    if (c[0] === 'Account' && c.includes('Description')) {
      account = c[1];
      scan.accounts++;
      scan.descriptions.set(account, utf8(c[c.indexOf('Description') + 1] ?? ''));
      opening = 0;
      activity = 0;
      sawOpening = false;
      return;
    }
    if (c[0] === 'Source') {
      header = c;
      return;
    }
    if (!account || !header.length) return;
    const dr = amount(c[col('Debit')]);
    const cr = amount(c[col('Credit')]);
    if (c.includes('Total for Account')) {
      const total = dr - cr;
      if (Math.abs(opening + activity - total) > 0.05) scan.mismatches.push({ account, opening, activity, total });
      account = null;
      return;
    }
    const d = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(c[col('GL Date')] ?? '');
    if (!d) {
      // the first line under the column names is the opening balance; later undated lines are period totals
      if (!sawOpening && !c[0] && !c.some((x) => /Ending Balance|Beginning Balance/.test(x))) opening = dr - cr;
      sawOpening = true;
      return;
    }
    sawOpening = true;
    scan.lines++;
    activity += dr - cr;
    if (!keep(account)) return;
    const month = `${d[3]}-${MON[d[2].toUpperCase()]}`;
    const k = `${account}|${month}`;
    const e = agg.get(k) ?? { account, month, debit: 0, credit: 0, lines: 0 };
    e.debit += dr;
    e.credit += cr;
    e.lines++;
    agg.set(k, e);
  };

  let raw = ''; // not yet quoted-printable decoded (an escape cut by the chunk edge)
  let html = ''; // decoded, not yet a whole row
  const feed = (decoded: string) => {
    html += decoded;
    const last = html.lastIndexOf('</tr>');
    if (last < 0) return;
    const done = html.slice(0, last + 5);
    html = html.slice(last + 5);
    for (const part of done.split('</tr>')) {
      const i = part.lastIndexOf('<tr');
      if (i >= 0) onRow(part.slice(i));
    }
  };

  for await (const chunk of source) {
    let s = raw + (typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('latin1'));
    raw = '';
    if (!started) {
      if (s.length < 4096) {
        raw = s;
        continue;
      }
      started = true;
      const head = s.slice(0, 8192);
      isMime = /^(Date:|MIME-Version:|From:|Content-Type:)/im.test(head) && /boundary=/i.test(head);
      qp = isMime && /Content-Transfer-Encoding:\s*quoted-printable/i.test(head);
      if (!isMime && !/<html|<table/i.test(head)) throw new Error('This does not look like the Account Analysis Report (an Oracle Analytics Publisher web page)');
    }
    if (qp) {
      // hold back a possibly cut escape ("=", "=X", "=\r")
      const m = /=[0-9A-Fa-f\r]?$/.exec(s);
      if (m) {
        raw = s.slice(m.index);
        s = s.slice(0, m.index);
      }
      s = s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }
    feed(s);
  }
  if (!started && raw) {
    started = true;
    feed(raw);
  }
  if (!scan.accounts) throw new Error('No accounts found: this does not look like the Account Analysis Report');
  if (!complete) throw new Error('The file is incomplete: the ledger total at the end of the report is missing. Export or upload it again.');
  scan.months = [...agg.values()].map((m) => ({ ...m, debit: Math.round(m.debit * 100) / 100, credit: Math.round(m.credit * 100) / 100 }));
  return scan;
}

/** Segments of an account code. */
export function glSegments(account: string) {
  const s = account.split('-');
  return { company: s[0], costCentre: s[2] ?? '', property: s[3] ?? '', natural: s[4] ?? '' };
}
