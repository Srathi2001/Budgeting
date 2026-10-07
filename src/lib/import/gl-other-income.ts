// Other income actuals from the GL (Account Analysis Report) into the Other Income tab.
//
// Natural accounts 52xxx in the other income list, from two Oracle ledgers: MJN HOLDING (the property
// companies) and MJN PRIVATE OFFICE. In MJN HOLDING the property segment of the account code picks the
// budget property; company-level lines (property 000000) and properties not in the budget go to the
// General row of the company's business unit. MJN PRIVATE OFFICE has no budget properties: all of it
// goes to General rows. Periods for budget year Y: Y-3 → A2, Y-2 → A1, Y-1 Jan–Sep → YTD.
// Income is credit − debit. An import replaces that ledger's GL actuals; typed inputs are untouched.

import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { OI_ACCOUNT } from '@/lib/budget/other-income-types';
import { glSegments, scanAccountAnalysis, type GlScan } from './gl-analysis';
import { propertyKey } from './tenant-lease';

interface LedgerSetup {
  /** GL company → business unit whose General row takes its company-level lines */
  companies: Record<string, string>;
  /** business units that exist for General rows only (no properties in the budget) */
  bus: { code: string; name: string }[];
  /** lines with a property segment go to that budget property */
  properties: boolean;
}

/** The Oracle ledgers read into Other Income. Their business units do not overlap. */
export const GL_LEDGERS = {
  'MJN HOLDING': {
    companies: { '501': '501', '502': '502', '503': '522', '521': '521', '522': '522' },
    bus: [{ code: '521', name: 'ANPM' }],
    properties: true,
  },
  'MJN PRIVATE OFFICE': {
    companies: { '703': '703', '751': '751' },
    bus: [
      { code: '703', name: 'MJN Private Office' },
      { code: '751', name: 'MJNH' },
    ],
    properties: false,
  },
} satisfies Record<string, LedgerSetup>;
export type GlLedger = keyof typeof GL_LEDGERS;
export const GL_LEDGER_NAMES = Object.keys(GL_LEDGERS) as GlLedger[];
export const isGlLedger = (s: string | null | undefined): s is GlLedger => !!s && s in GL_LEDGERS;

/** Business units whose GL actuals an import of `ledger` replaces. */
export const ledgerBus = (ledger: GlLedger) => [...new Set(Object.values(GL_LEDGERS[ledger].companies as Record<string, string>))];

export const GL_PERIODS = ['A2', 'A1', 'YTD'] as const;
type GlPeriod = (typeof GL_PERIODS)[number];

export interface GlValue {
  scope: string;
  buCode: string;
  propertyId: number | null;
  account: string;
  period: GlPeriod;
  amount: number;
}

export interface GlPreview {
  ledger: GlLedger;
  periodFrom: string | null;
  periodTo: string | null;
  accounts: number;
  lines: number;
  mismatches: number;
  year: number;
  totals: Record<GlPeriod, number>;
  byBu: { bu: string; A2: number; A1: number; YTD: number }[];
  /** lines put on a General row: company level, or a property segment not in the budget */
  general: { bu: string; company: string; segment: string; name: string; A2: number; A1: number; YTD: number }[];
  properties: number;
  skipped: { what: string; detail: string }[];
}

export const isOtherIncome = (account: string) => /^52\d{3}$/.test(glSegments(account).natural);

/** Reads the report keeping only other-income accounts. */
export const scanOtherIncome = (source: AsyncIterable<Uint8Array | string>) => scanAccountAnalysis(source, isOtherIncome);

/** `expected`: the ledger the upload was made for (the report's own ledger must match it). */
export async function planGlImport(versionId: number, scan: GlScan, expected?: GlLedger): Promise<{ values: GlValue[]; preview: GlPreview }> {
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version) throw new Error('Version not found');
  if (version.status === 'LOCKED') throw new Error('Version is locked');
  const ledger = scan.ledger?.trim().toUpperCase();
  if (!isGlLedger(ledger)) throw new Error(`Ledger ${scan.ledger ?? '(none)'}: expected ${GL_LEDGER_NAMES.join(' or ')}`);
  if (expected && ledger !== expected) throw new Error(`This is the ${ledger} report, not ${expected}: upload it under ${ledger}`);
  const setup: LedgerSetup = GL_LEDGERS[ledger];
  if (scan.mismatches.length) throw new Error(`The report does not add up for ${scan.mismatches.length} account(s), e.g. ${scan.mismatches[0].account}: not imported`);
  const Y = version.year;
  const periodOf = (month: string): GlPeriod | null => {
    const [y, m] = month.split('-').map(Number);
    if (y === Y - 3) return 'A2';
    if (y === Y - 2) return 'A1';
    if (y === Y - 1 && m <= 9) return 'YTD';
    return null;
  };

  const props = await db.select().from(schema.properties);
  const propByKey = new Map(props.map((p) => [propertyKey(p.code), p]));
  const buNames = new Map([...(await db.select().from(schema.businessUnits)), ...setup.bus].map((b) => [b.code, b.name]));

  const values = new Map<string, GlValue>();
  const general = new Map<string, GlPreview['general'][number]>();
  const skipped = new Map<string, { what: string; detail: string }>();
  const outside = new Set<string>();
  for (const m of scan.months) {
    const seg = glSegments(m.account);
    const period = periodOf(m.month);
    if (!period) {
      outside.add(m.month);
      continue;
    }
    if (!OI_ACCOUNT.has(seg.natural)) {
      skipped.set(`acct ${seg.natural}`, { what: `Account ${seg.natural}`, detail: `${scan.descriptions.get(m.account)?.split('-')[4] ?? ''}: not in the other income list` });
      continue;
    }
    const prop = setup.properties && seg.property && seg.property !== '000000' ? propByKey.get(propertyKey(seg.property)) : undefined;
    let scope: string;
    let buCode: string;
    if (prop) {
      scope = `P:${prop.id}`;
      buCode = prop.buCode;
    } else {
      const bu = setup.companies[seg.company];
      if (!bu) {
        skipped.set(`co ${seg.company}`, { what: `Company ${seg.company}`, detail: 'not mapped to a business unit' });
        continue;
      }
      scope = `G:${bu}`;
      buCode = bu;
      const gk = `${bu}|${seg.company}|${seg.property}`;
      const g = general.get(gk) ?? {
        bu: `${bu} ${buNames.get(bu) ?? ''}`.trim(),
        company: seg.company,
        segment: seg.property || '—',
        name: seg.property === '000000' ? 'Company level' : 'Property not in the budget',
        A2: 0,
        A1: 0,
        YTD: 0,
      };
      g[period] += m.credit - m.debit;
      general.set(gk, g);
    }
    const k = `${scope}|${seg.natural}|${period}`;
    const v = values.get(k) ?? { scope, buCode, propertyId: prop?.id ?? null, account: seg.natural, period, amount: 0 };
    v.amount += m.credit - m.debit;
    values.set(k, v);
  }
  if (outside.size) skipped.set('months', { what: `${outside.size} month(s)`, detail: `${[...outside].sort().join(', ')}: outside ${Y - 3}–${Y - 1} Sep` });

  const list = [...values.values()].map((v) => ({ ...v, amount: Math.round(v.amount * 100) / 100 })).filter((v) => v.amount !== 0);
  const r = (n: number) => Math.round(n);
  const byBu = new Map<string, { bu: string; A2: number; A1: number; YTD: number }>();
  for (const v of list) {
    const e = byBu.get(v.buCode) ?? { bu: `${v.buCode} ${buNames.get(v.buCode) ?? ''}`.trim(), A2: 0, A1: 0, YTD: 0 };
    e[v.period] += v.amount;
    byBu.set(v.buCode, e);
  }
  const tot = (p: GlPeriod) => r(list.filter((v) => v.period === p).reduce((s, v) => s + v.amount, 0));
  return {
    values: list,
    preview: {
      ledger,
      periodFrom: scan.periodFrom,
      periodTo: scan.periodTo,
      accounts: scan.accounts,
      lines: scan.lines,
      mismatches: scan.mismatches.length,
      year: Y,
      totals: { A2: tot('A2'), A1: tot('A1'), YTD: tot('YTD') },
      byBu: [...byBu.values()].map((e) => ({ ...e, A2: r(e.A2), A1: r(e.A1), YTD: r(e.YTD) })).sort((a, b) => a.bu.localeCompare(b.bu)),
      general: [...general.values()]
        .map((g) => ({ ...g, A2: r(g.A2), A1: r(g.A1), YTD: r(g.YTD) }))
        .filter((g) => g.A2 || g.A1 || g.YTD)
        .sort((a, b) => a.bu.localeCompare(b.bu) || a.segment.localeCompare(b.segment)),
      properties: new Set(list.filter((v) => v.propertyId).map((v) => v.propertyId)).size,
      skipped: [...skipped.values()],
    },
  };
}

/** Replaces the GL actuals (A2, A1, YTD) of the preview's ledger with `values`; other ledgers are kept. */
export async function applyGlImport(versionId: number, values: GlValue[], userId: number | null, info: { file: string | null; preview: GlPreview }) {
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version || version.status === 'LOCKED') throw new Error('Version is locked');
  const ledger = info.preview.ledger;
  if (!isGlLedger(ledger)) throw new Error(`Unknown ledger ${ledger}`);
  const bus = ledgerBus(ledger);
  const outside = values.find((v) => !bus.includes(v.buCode));
  if (outside) throw new Error(`Business unit ${outside.buCode} is not in ledger ${ledger}`);
  await db.transaction(async (tx) => {
    for (const b of GL_LEDGERS[ledger].bus) await tx.insert(schema.businessUnits).values(b).onConflictDoNothing();
    await tx
      .delete(schema.otherIncome)
      .where(and(eq(schema.otherIncome.versionId, versionId), inArray(schema.otherIncome.period, [...GL_PERIODS]), inArray(schema.otherIncome.buCode, bus)));
    for (let i = 0; i < values.length; i += 500) {
      await tx.insert(schema.otherIncome).values(
        values.slice(i, i + 500).map((v) => ({ versionId, buCode: v.buCode, propertyId: v.propertyId, scope: v.scope, account: v.account, period: v.period, amount: v.amount, updatedBy: userId })),
      );
    }
    await tx.insert(schema.auditLog).values({
      userId,
      versionId,
      entity: 'gl_import',
      action: 'other_income_actuals',
      changes: { file: info.file, ledger: info.preview.ledger, period: `${info.preview.periodFrom} – ${info.preview.periodTo}`, values: values.length, totals: info.preview.totals },
    });
  });
}
