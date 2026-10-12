// Finance's treasury inputs (Finance → Shareholder loans, Fixed deposits, Contingencies): reading,
// saving with a full audit trail, and what they give the statements. Entered by Finance (and Admin).
import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { entersData, type Actor } from '@/lib/auth/permissions';
import { changedFields } from '@/lib/audit-diff';
import { writeGuard } from '@/lib/write-guard';
import { clash, sameValue } from '@/lib/conflict';
import { contingencyMonths, depositYear, loanYear, DAY_BASES, FREQUENCIES, REPAYMENT_TYPES } from './treasury-calc';
import type { EntityCost } from './admin';
import type { EntityKey } from './group';

export type Loan = typeof schema.shareholderLoans.$inferSelect & { events: (typeof schema.loanEvents.$inferSelect)[] };
export type Deposit = typeof schema.fixedDeposits.$inferSelect;
export type Contingency = typeof schema.contingencies.$inferSelect;

/** the account deposit interest is booked to (other income, as the 2026 budget) */
export const FD_INTEREST_ACCOUNT = '52201';

export async function loadTreasury(versionId: number) {
  const [loans, deposits, contingencies] = await Promise.all([
    db.select().from(schema.shareholderLoans).where(eq(schema.shareholderLoans.versionId, versionId)).orderBy(schema.shareholderLoans.id),
    db.select().from(schema.fixedDeposits).where(eq(schema.fixedDeposits.versionId, versionId)).orderBy(schema.fixedDeposits.id),
    db.select().from(schema.contingencies).where(eq(schema.contingencies.versionId, versionId)).orderBy(schema.contingencies.id),
  ]);
  const events = loans.length ? await db.select().from(schema.loanEvents).where(inArray(schema.loanEvents.loanId, loans.map((l) => l.id))).orderBy(schema.loanEvents.date) : [];
  return { loans: loans.map((l) => ({ ...l, events: events.filter((e) => e.loanId === l.id) })) as Loan[], deposits, contingencies };
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((s) => (s && s.trim() ? s.trim() : null));
const entity = z.string().regex(/^\w{2,6}$/);

const LoanSchema = z.object({
  id: z.number().int().nullable(),
  name: z.string().trim().min(1).max(120),
  lender: text(120),
  entity,
  principal: z.number().min(0).max(1e12).nullable(),
  openingBalance: z.number().min(0).max(1e12),
  rate: z.number().min(0).max(1),
  dayBasis: z.enum(DAY_BASES),
  interestFrequency: z.enum(FREQUENCIES),
  firstInterestDate: day,
  repaymentType: z.enum(REPAYMENT_TYPES),
  repaymentFrequency: z.enum(FREQUENCIES),
  firstRepaymentDate: day,
  maturityDate: day,
  capitalisePct: z.number().min(0).max(1),
  capitaliseProject: text(120),
  contributionLagMonths: z.number().int().min(0).max(24).nullable(),
  notes: text(2000),
  events: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), kind: z.enum(['DRAWDOWN', 'REPAYMENT']), amount: z.number().min(0).max(1e12) })).max(500),
});
const DepositSchema = z.object({
  id: z.number().int().nullable(),
  bank: z.string().trim().min(1).max(120),
  reference: text(120),
  entity,
  amount: z.number().min(0).max(1e12),
  placementDate: day,
  maturityDate: day,
  rate: z.number().min(0).max(1),
  dayBasis: z.enum(DAY_BASES),
  interestPayout: z.enum(['MATURITY', 'MONTHLY', 'QUARTERLY']),
  rollover: z.boolean(),
  rolloverRate: z.number().min(0).max(1).nullable(),
  notes: text(2000),
});
const ContingencySchema = z.object({
  id: z.number().int().nullable(),
  entity,
  description: z.string().trim().min(1).max(300),
  category: text(120),
  amount: z.number().min(-1e11).max(1e11),
  phasing: z.enum(['EVEN', 'MONTH']),
  month: z.number().int().min(1).max(12).nullable(),
  cash: z.boolean(),
  notes: text(2000),
});

type Kind = 'loan' | 'deposit' | 'contingency';
const TABLE = { loan: schema.shareholderLoans, deposit: schema.fixedDeposits, contingency: schema.contingencies } as const;
const SCHEMA = { loan: LoanSchema, deposit: DepositSchema, contingency: ContingencySchema } as const;

async function openFor(user: Actor, versionId: number): Promise<string | null> {
  if (!entersData(user, 'FIN')) return 'Entered by Finance';
  const [v] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!v || v.status === 'LOCKED') return 'This budget version is locked';
  return null;
}

/** Saves one record of a Finance tab (new or changed), its audit row with every field before and after. */
export async function saveTreasury(user: Actor, versionId: number, kind: Kind, input: unknown): Promise<{ id?: number; error?: string }> {
  const blocked = await openFor(user, versionId);
  if (blocked) return { error: blocked };
  const parsed = SCHEMA[kind].safeParse(input);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { error: i ? `${i.path.join('.')}: ${i.message}` : 'Invalid input' };
  }
  const { id, ...sent } = parsed.data as { id: number | null } & Record<string, unknown>;
  let data = sent;
  let events = kind === 'loan' ? ((data.events as { date: string; kind: string; amount: number }[]) ?? []) : [];
  if (kind === 'loan') delete data.events;
  // the record as the user saw it (lib/conflict.ts): only what the user changed is written, and a field
  // someone else changed meanwhile is not overwritten
  const seenIn = (input as { seen?: unknown } | null)?.seen;
  const seen = seenIn && typeof seenIn === 'object' ? (seenIn as Record<string, unknown>) : null;
  const table = TABLE[kind];
  const entity = kind === 'loan' ? 'shareholder_loan' : kind === 'deposit' ? 'fixed_deposit' : 'contingency';
  let newId = id;
  await db.transaction(async (tx) => {
    // the version stays open until this commits (a lock waits for it)
    const cur = await writeGuard(tx, versionId);
    if (!cur || cur.status === 'LOCKED') throw new Error('This budget version is locked');
    let before: Record<string, unknown> | null = null;
    if (id) {
      [before] = (await tx.select().from(table).where(and(eq(table.id, id), eq(table.versionId, versionId)))) as Record<string, unknown>[];
      if (!before) throw new Error('Record not found');
      if (seen) {
        const kept = { ...data };
        for (const [k, v] of Object.entries(data)) {
          const saw = seen[k] ?? null;
          if (sameValue(v, saw)) {
            kept[k] = before[k] ?? null; // not changed by the user: stays as stored
            continue;
          }
          const message = await clash(tx, user.id, `${String(before.name ?? before.bank ?? before.description ?? '')} ${k}`.trim(), { entity, entityId: String(id), field: k }, saw, before[k], v);
          if (message) throw new Error(message);
        }
        data = kept;
        if (kind === 'loan') {
          const old = (await tx.select().from(schema.loanEvents).where(eq(schema.loanEvents.loanId, id))).map((e) => ({ date: e.date, kind: e.kind, amount: e.amount }));
          const saw = (seen.events as unknown[] | undefined) ?? [];
          const shown = saw.map((e) => {
            const x = e as { date: string; kind: string; amount: number };
            return { date: x.date, kind: x.kind, amount: x.amount };
          });
          if (sameValue(events, shown)) events = old;
          else {
            const message = await clash(tx, user.id, `${String(before.name ?? '')} drawdowns and repayments`.trim(), { entity, entityId: String(id), field: 'events' }, shown, old, events, { show: [`${old.length} entries`, `${events.length} entries`] });
            if (message) throw new Error(message);
          }
        }
      }
      await tx.update(table).set({ ...data, updatedAt: new Date(), updatedBy: user.id }).where(eq(table.id, id));
    } else {
      const [row] = await tx.insert(table).values({ ...data, versionId, updatedBy: user.id } as never).returning({ id: table.id });
      newId = row.id;
    }
    let eventsChange: unknown = undefined;
    if (kind === 'loan') {
      const old = id ? await tx.select().from(schema.loanEvents).where(eq(schema.loanEvents.loanId, id)) : [];
      const was = old.map((e) => ({ date: e.date, kind: e.kind, amount: e.amount }));
      if (JSON.stringify(was) !== JSON.stringify(events)) {
        await tx.delete(schema.loanEvents).where(eq(schema.loanEvents.loanId, newId!));
        if (events.length) await tx.insert(schema.loanEvents).values(events.map((e) => ({ ...e, loanId: newId! })));
        eventsChange = { from: was, to: events };
      }
    }
    await tx.insert(schema.auditLog).values({
      userId: user.id,
      versionId,
      entity,
      entityId: String(newId),
      action: id ? 'update' : 'create',
      changes: { ...(before ? changedFields(before, data) : { from: null, to: data }), ...(eventsChange ? { events: eventsChange } : {}) },
    });
  });
  return { id: newId! };
}

export async function deleteTreasury(user: Actor, versionId: number, kind: Kind, id: number): Promise<{ error?: string }> {
  const blocked = await openFor(user, versionId);
  if (blocked) return { error: blocked };
  const table = TABLE[kind];
  const locked = await db.transaction(async (tx) => {
    // the version stays open until this commits (a lock waits for it)
    const cur = await writeGuard(tx, versionId);
    if (!cur || cur.status === 'LOCKED') return true;
    const [row] = (await tx.delete(table).where(and(eq(table.id, id), eq(table.versionId, versionId))).returning()) as Record<string, unknown>[];
    if (row) await tx.insert(schema.auditLog).values({ userId: user.id, versionId, entity: kind === 'loan' ? 'shareholder_loan' : kind === 'deposit' ? 'fixed_deposit' : 'contingency', entityId: String(id), action: 'delete', changes: { from: row, to: null } });
    return false;
  });
  return locked ? { error: 'This budget version is locked' } : {};
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** the loan as the calculation takes it */
export const loanInput = (l: Loan) => ({
  openingBalance: Number(l.openingBalance) || 0,
  rate: Number(l.rate) || 0,
  dayBasis: l.dayBasis,
  interestFrequency: l.interestFrequency,
  firstInterestDate: l.firstInterestDate,
  repaymentType: l.repaymentType,
  repaymentFrequency: l.repaymentFrequency,
  firstRepaymentDate: l.firstRepaymentDate,
  maturityDate: l.maturityDate,
  capitalisePct: Number(l.capitalisePct) || 0,
  contributionLagMonths: l.contributionLagMonths,
});
export const depositInput = (d: Deposit) => ({
  amount: Number(d.amount) || 0,
  placementDate: d.placementDate,
  maturityDate: d.maturityDate,
  rate: Number(d.rate) || 0,
  dayBasis: d.dayBasis,
  interestPayout: d.interestPayout,
  rollover: d.rollover,
  rolloverRate: n(d.rolloverRate),
});

/**
 * What the Finance tabs give the statements, by entity: loan interest and contingencies (below EBITDA), the
 * deposit interest (other income 52201, received as paid out).
 */
export async function treasuryForStatements(version: schema.BudgetVersion): Promise<{ costs: EntityCost[]; lines: Set<string>; fdInterest: { entity: string; months: number[]; cash: number[] }[] }> {
  const t = await loadTreasury(version.id);
  const costs: EntityCost[] = [];
  const lines = new Set<string>();
  for (const l of t.loans) {
    const y = loanYear(loanInput(l), l.events.map((e) => ({ date: e.date, kind: e.kind, amount: Number(e.amount) })), version.year);
    if (y.interestExpense.some((v) => v) || y.interestPaid.some((v) => v)) {
      lines.add('loanInterest');
      costs.push({ entity: l.entity as EntityKey, line: 'loanInterest', months: y.interestExpense, cash: y.interestPaid });
    }
  }
  for (const c of t.contingencies) {
    const months = contingencyMonths({ amount: Number(c.amount) || 0, phasing: c.phasing, month: c.month });
    if (!months.some((v) => v)) continue;
    lines.add('contingencies');
    costs.push({ entity: c.entity as EntityKey, line: 'contingencies', months, cash: c.cash ? months : Array.from({ length: 12 }, () => 0) });
  }
  const fd = new Map<string, { months: number[]; cash: number[] }>();
  for (const d of t.deposits) {
    const y = depositYear(depositInput(d), version.year);
    const acc = fd.get(d.entity) ?? { months: Array.from({ length: 12 }, () => 0), cash: Array.from({ length: 12 }, () => 0) };
    y.interest.forEach((v, i) => (acc.months[i] += v));
    y.interestReceived.forEach((v, i) => (acc.cash[i] += v));
    fd.set(d.entity, acc);
  }
  return { costs, lines, fdInterest: [...fd].map(([entity, v]) => ({ entity, ...v })) };
}
