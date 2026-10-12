// Building overheads' supporting tabs: the assumptions (percentages, cost per watchman), the insurance
// base per building, the security allocation (watchmen per building) and the contract schedules (AMC
// tabs). Loaders for the page and the saves (Finance for the first three; contracts: whoever may edit
// the building, as the overview).
import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { canEditProperty, entersData, isAdmin, type Actor, type EditCheck } from '@/lib/auth/permissions';
import { writeGuard, type Exec } from '@/lib/write-guard';
import { changedFields, pick } from '@/lib/audit-diff';
import { withDefaults, type BohAssumptionKey } from '@/lib/engine/assumptions';
import { CONTRACT_KIND, CONTRACT_TERMS, type ContractKind, type ContractRow, type ContractTerms } from './boh-types';

export type Result = { error?: string; ok?: string };

async function openVersion(versionId: number) {
  const [v] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!v) return { error: 'Version not found' };
  if (v.status === 'LOCKED') return { error: 'This budget version is locked' };
  return { v };
}

/** inside a save, after writeGuard: why the version can't take it (null: it can) */
const held = (v: schema.BudgetVersion | undefined) => (!v ? 'Version not found' : v.status === 'LOCKED' ? 'This budget version is locked' : null);

// ---- assumptions ---------------------------------------------------------------------------------

const AssumptionInput = z.object({
  bohUtilitiesPct: z.number().min(-0.5).max(2),
  insParPct: z.number().min(-0.5).max(2),
  insPlPct: z.number().min(-0.5).max(2),
  watchmanCost: z.number().min(0).max(1e7),
}) satisfies z.ZodType<Record<BohAssumptionKey, number>>;

export async function saveBohAssumptionsAs(user: Actor, versionId: number, input: unknown): Promise<Result> {
  if (!isAdmin(user)) return { error: 'The assumptions are set by Admin' };
  const o = await openVersion(versionId);
  if (o.error) return { error: o.error };
  const parsed = AssumptionInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  // the change and its audit row land together; the version row is read in here and held, so another
  // Admin's change of other assumptions (Admin → Assumptions, yearly rules) is kept, not overwritten
  const refused = await db.transaction(async (tx) => {
    const v = await writeGuard(tx, versionId, { versionUpdate: true });
    const open = held(v);
    if (open) return open;
    const before = withDefaults(v!.assumptions);
    await tx
      .update(schema.budgetVersions)
      .set({ assumptions: { ...v!.assumptions, ...parsed.data } })
      .where(eq(schema.budgetVersions.id, versionId));
    await tx.insert(schema.auditLog).values({
      userId: user.id,
      versionId,
      entity: 'boh_assumptions',
      action: 'update',
      changes: { from: Object.fromEntries(Object.keys(parsed.data).map((k) => [k, before[k as BohAssumptionKey]])), to: parsed.data },
    });
    return null;
  });
  if (refused) return { error: refused };
  return { ok: 'Assumptions saved' };
}

// ---- insurance base -------------------------------------------------------------------------------

export interface InsuranceRow {
  propertyId: number;
  insuredValue: number | null;
  parRate: number | null;
  plPremium: number | null;
}
const InsuranceInput = z
  .array(
    z.object({
      propertyId: z.number().int().positive(),
      insuredValue: z.number().min(0).max(1e11).nullable(),
      parRate: z.number().min(0).max(0.1).nullable(),
      plPremium: z.number().min(0).max(1e8).nullable(),
    }),
  )
  .max(500);

export async function loadInsurance(versionId: number, propertyIds: number[]): Promise<InsuranceRow[]> {
  if (!propertyIds.length) return [];
  return (await db.select().from(schema.bohInsurance).where(and(eq(schema.bohInsurance.versionId, versionId), inArray(schema.bohInsurance.propertyId, propertyIds)))).map((r) => ({
    propertyId: r.propertyId,
    insuredValue: r.insuredValue,
    parRate: r.parRate,
    plPremium: r.plPremium,
  }));
}

export async function saveInsuranceAs(user: Actor, versionId: number, input: unknown): Promise<Result> {
  if (!entersData(user, 'FIN')) return { error: 'Insurance is entered by Finance' };
  const o = await openVersion(versionId);
  if (o.error) return { error: o.error };
  const parsed = InsuranceInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const refused = await db.transaction(async (tx) => {
    // the version stays open until this commits (a lock waits for it)
    const open = held(await writeGuard(tx, versionId));
    if (open) return open;
    const ids = parsed.data.map((r) => r.propertyId);
    const before = ids.length ? await tx.select().from(schema.bohInsurance).where(and(eq(schema.bohInsurance.versionId, versionId), inArray(schema.bohInsurance.propertyId, ids))) : [];
    for (const r of parsed.data) {
      const where = and(eq(schema.bohInsurance.versionId, versionId), eq(schema.bohInsurance.propertyId, r.propertyId));
      if (r.insuredValue === null && r.parRate === null && r.plPremium === null) await tx.delete(schema.bohInsurance).where(where);
      else
        await tx
          .insert(schema.bohInsurance)
          .values({ versionId, ...r, updatedBy: user.id })
          .onConflictDoUpdate({ target: [schema.bohInsurance.versionId, schema.bohInsurance.propertyId], set: { ...r, updatedAt: new Date(), updatedBy: user.id } });
    }
    // each building with its figures before and after
    const was = (id: number) => {
      const b = before.find((x) => x.propertyId === id);
      return b ? { insuredValue: b.insuredValue, parRate: b.parRate, plPremium: b.plPremium } : null;
    };
    await tx.insert(schema.auditLog).values({ userId: user.id, versionId, entity: 'boh_insurance', action: 'update', changes: parsed.data.map((r) => ({ propertyId: r.propertyId, from: was(r.propertyId), to: { insuredValue: r.insuredValue, parRate: r.parRate, plPremium: r.plPremium } })) });
    return null;
  });
  if (refused) return { error: refused };
  return { ok: `Saved ${parsed.data.length} building${parsed.data.length === 1 ? '' : 's'}` };
}

// ---- security allocation ----------------------------------------------------------------------------

const WatchmenInput = z.array(z.object({ propertyId: z.number().int().positive(), share: z.number().min(0).max(100).nullable() })).max(500);

export async function loadWatchmen(versionId: number, propertyIds: number[]): Promise<Map<number, number>> {
  if (!propertyIds.length) return new Map();
  const rows = await db.select().from(schema.bohWatchmen).where(and(eq(schema.bohWatchmen.versionId, versionId), inArray(schema.bohWatchmen.propertyId, propertyIds)));
  return new Map(rows.map((r) => [r.propertyId, r.share]));
}

export async function saveWatchmenAs(user: Actor, versionId: number, input: unknown): Promise<Result> {
  if (!entersData(user, 'FIN')) return { error: 'The security allocation is entered by Finance' };
  const o = await openVersion(versionId);
  if (o.error) return { error: o.error };
  const parsed = WatchmenInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const refused = await db.transaction(async (tx) => {
    // the version stays open until this commits (a lock waits for it)
    const open = held(await writeGuard(tx, versionId));
    if (open) return open;
    const ids = parsed.data.map((r) => r.propertyId);
    const before = new Map((ids.length ? await tx.select().from(schema.bohWatchmen).where(and(eq(schema.bohWatchmen.versionId, versionId), inArray(schema.bohWatchmen.propertyId, ids))) : []).map((w) => [w.propertyId, w.share]));
    for (const r of parsed.data) {
      const where = and(eq(schema.bohWatchmen.versionId, versionId), eq(schema.bohWatchmen.propertyId, r.propertyId));
      if (!r.share) await tx.delete(schema.bohWatchmen).where(where);
      else
        await tx
          .insert(schema.bohWatchmen)
          .values({ versionId, propertyId: r.propertyId, share: r.share, updatedBy: user.id })
          .onConflictDoUpdate({ target: [schema.bohWatchmen.versionId, schema.bohWatchmen.propertyId], set: { share: r.share, updatedAt: new Date(), updatedBy: user.id } });
    }
    await tx.insert(schema.auditLog).values({ userId: user.id, versionId, entity: 'boh_watchmen', action: 'update', changes: parsed.data.map((r) => ({ propertyId: r.propertyId, from: before.get(r.propertyId) ?? null, to: r.share || null })) });
    return null;
  });
  if (refused) return { error: refused };
  return { ok: `Saved ${parsed.data.length} building${parsed.data.length === 1 ? '' : 's'}` };
}

// ---- contract schedules -----------------------------------------------------------------------------

export async function loadContracts(versionId: number, propertyIds: number[], kind?: ContractKind): Promise<ContractRow[]> {
  if (!propertyIds.length) return [];
  const rows = await db
    .select()
    .from(schema.bohContracts)
    .where(and(eq(schema.bohContracts.versionId, versionId), inArray(schema.bohContracts.propertyId, propertyIds), ...(kind ? [eq(schema.bohContracts.kind, kind)] : [])))
    .orderBy(schema.bohContracts.propertyId, schema.bohContracts.account, schema.bohContracts.id);
  return rows.map((r) => ({
    id: r.id,
    propertyId: r.propertyId,
    kind: r.kind as ContractKind,
    account: r.account,
    supplier: r.supplier,
    description: r.description,
    terms: r.terms as ContractTerms,
    quantity: r.quantity,
    rate: r.rate,
    startMonth: r.startMonth,
    startDate: r.startDate,
    endDate: r.endDate,
    renewal: r.renewal === 'RENEW' || r.renewal === 'END' ? r.renewal : null,
    renewalRate: r.renewalRate,
    renewalTerms: (CONTRACT_TERMS as readonly string[]).includes(r.renewalTerms ?? '') ? (r.renewalTerms as ContractTerms) : null,
    remarks: r.remarks,
    source: r.source === 'PO' ? 'PO' : 'PM',
    poNumber: r.poNumber,
    poCategory: r.poCategory,
    poStatus: r.poStatus,
    poQuantity: r.poQuantity,
    poRate: r.poRate,
    poAmount: r.poAmount,
  }));
}

const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((s) => (s && s.trim() ? s.trim() : null));
const ContractInput = z.object({
  id: z.number().int().nullable(),
  propertyId: z.number().int().positive(),
  account: z.string().regex(/^\d{5}$/),
  supplier: text(200),
  description: text(1000),
  terms: z.enum(CONTRACT_TERMS),
  quantity: z.number().min(0).max(100000),
  rate: z.number().min(0).max(1e9),
  startMonth: z.number().int().min(1).max(12).nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  renewal: z.enum(['RENEW', 'END']).nullable().default(null),
  renewalRate: z.number().min(0).max(1e9).nullable().default(null),
  renewalTerms: z.enum(CONTRACT_TERMS).nullable().default(null),
  remarks: text(1000),
});
const ContractSave = z.object({ lines: z.array(ContractInput).max(2000), deleted: z.array(z.number().int()).max(2000) });

/** Saves a schedule's changed and new rows, and removes rows (entered ones only: a PO row is set to 0 instead). */
export async function saveContractsAs(user: Actor, versionId: number, kind: ContractKind, input: unknown): Promise<{ saved: number; errors: string[] }> {
  const info = CONTRACT_KIND.get(kind);
  if (!info) return { saved: 0, errors: ['Unknown schedule'] };
  const o = await openVersion(versionId);
  if (o.error) return { saved: 0, errors: [o.error] };
  const parsed = ContractSave.safeParse(input);
  if (!parsed.success) return { saved: 0, errors: [parsed.error.issues[0]?.message ?? 'Invalid input'] };
  const { lines, deleted } = parsed.data;
  const ids = [...lines.map((l) => l.id), ...deleted].filter((x): x is number => x !== null);
  const rowsOf = async (on: Exec) =>
    new Map(ids.length ? (await on.select().from(schema.bohContracts).where(and(eq(schema.bohContracts.versionId, versionId), inArray(schema.bohContracts.id, ids)))).map((r) => [r.id, r]) : []);
  const buildings = (rows: Map<number, typeof schema.bohContracts.$inferSelect>) => new Set<number>([...lines.map((l) => l.propertyId), ...[...rows.values()].map((r) => r.propertyId)]);
  const props = new Map((await db.select({ id: schema.properties.id, code: schema.properties.code }).from(schema.properties)).map((p) => [p.id, p.code]));
  const errors: string[] = [];
  let saved = 0;
  // one audit row per contract row, with its fields before and after
  const FIELDS = ['propertyId', 'account', 'supplier', 'description', 'terms', 'quantity', 'rate', 'startMonth', 'startDate', 'endDate', 'renewal', 'renewalRate', 'renewalTerms', 'remarks'] as const;
  const trail: (typeof schema.auditLog.$inferInsert)[] = [];
  const log = (id: number, propertyId: number, action: string, changes: unknown) => trail.push({ userId: user.id, versionId, propertyId, entity: 'boh_contracts', entityId: String(id), action, changes: { kind, ...(changes as object) } });
  // read before the transaction (never the global db inside it): which buildings to hold
  const hold = [...buildings(await rowsOf(db))];
  // deletes, inserts, updates and their audit rows land together or not at all
  await db.transaction(async (tx) => {
    // every building touched (where a row is now and where it goes) is held until this commits, and the
    // rows and checks are read in here: a submission waits for the save, and the save sees the status
    const cur = await writeGuard(tx, versionId, { properties: hold });
    const open = held(cur);
    if (open) {
      errors.push(open);
      return;
    }
    const existing = await rowsOf(tx);
    const checks = new Map<number, EditCheck>();
    for (const id of buildings(existing)) checks.set(id, await canEditProperty(user, versionId, id, 'PM', tx));
    const may = (propertyId: number): EditCheck => checks.get(propertyId) ?? { ok: false, reason: 'Unknown building' };
    for (const id of deleted) {
      const r = existing.get(id);
      if (!r || r.kind !== kind) {
        errors.push('A removed row is not in this schedule');
        continue;
      }
      if (r.source === 'PO') {
        errors.push(`${props.get(r.propertyId)} PO ${r.poNumber}: rows from Oracle purchase orders can’t be removed; set the quantity or rate to 0`);
        continue;
      }
      const c = may(r.propertyId);
      if (!c.ok) {
        errors.push(`${props.get(r.propertyId)}: ${c.reason}`);
        continue;
      }
      await tx.delete(schema.bohContracts).where(eq(schema.bohContracts.id, id));
      log(id, r.propertyId, 'delete', { from: pick(r, FIELDS), to: null });
      saved++;
    }
    for (const l of lines) {
      const code = props.get(l.propertyId);
      if (!code) {
        errors.push('Unknown building');
        continue;
      }
      if (!info.accounts.includes(l.account)) {
        errors.push(`${code}: account ${l.account} is not in the ${info.label} schedule`);
        continue;
      }
      const before = l.id === null ? null : existing.get(l.id);
      if (l.id !== null && (!before || before.kind !== kind)) {
        errors.push(`${code}: a row is not in this schedule`);
        continue;
      }
      // a moved row leaves one building and joins another: the user must be able to change both
      const from = may(before?.propertyId ?? l.propertyId);
      const to = may(before?.source === 'PO' ? before.propertyId : l.propertyId);
      const c = !from.ok ? from : to;
      if (!c.ok) {
        errors.push(`${code}: ${c.reason}`);
        continue;
      }
      const values = {
        account: l.account,
        supplier: l.supplier,
        description: l.description,
        terms: l.terms,
        quantity: l.quantity,
        rate: l.rate,
        startMonth: l.startMonth,
        startDate: l.startDate,
        endDate: l.endDate,
        renewal: l.renewal,
        renewalRate: l.renewalRate,
        renewalTerms: l.renewalTerms,
        remarks: l.remarks,
      };
      if (!before) {
        const [row] = await tx.insert(schema.bohContracts).values({ versionId, propertyId: l.propertyId, kind, source: 'PM', ...values, updatedBy: user.id }).returning({ id: schema.bohContracts.id });
        log(row.id, l.propertyId, 'create', { from: null, to: { propertyId: l.propertyId, ...values } });
        saved++;
        continue;
      }
      // a PO row stays on its building; an entered row can move
      const set = before.source === 'PO' ? values : { ...values, propertyId: l.propertyId };
      if (Object.entries(set).every(([k, v]) => (before as Record<string, unknown>)[k] === v)) continue;
      await tx
        .update(schema.bohContracts)
        .set({ ...set, updatedAt: new Date(), updatedBy: user.id })
        .where(eq(schema.bohContracts.id, before.id));
      log(before.id, before.propertyId, 'update', { fields: changedFields(before as unknown as Record<string, unknown>, set) });
      saved++;
    }
    for (let i = 0; i < trail.length; i += 500) await tx.insert(schema.auditLog).values(trail.slice(i, i + 500));
  });
  return { saved, errors };
}
