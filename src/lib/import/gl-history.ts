// What a GL import replaces in each table, the rows it replaced (kept in import_history so the import can be
// undone), and the undo. One place defines the scope of each table, so the apply, the preview counts and the
// undo always work on the same rows.
import { and, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { db, schema, type DB } from '@/db';

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0] | DB;

export type GlTable = 'other_income' | 'fm_actuals' | 'boh_actuals' | 'admin_actuals';
export interface GlScope {
  from?: string;
  to?: string;
  /** natural accounts replaced (building overheads, G&A): only those in the file */
  accounts?: string[];
  /** other income: the version, the ledger's business units and the GL periods */
  versionId?: number;
  bus?: string[];
  periods?: string[];
}

const TABLE = {
  other_income: schema.otherIncome,
  fm_actuals: schema.fmActuals,
  boh_actuals: schema.bohActuals,
  admin_actuals: schema.adminActuals,
} as const;

/** the rows of `table` an import with this scope replaces */
export function scopeWhere(table: GlTable, s: GlScope): SQL {
  if (table === 'other_income') {
    const t = schema.otherIncome;
    return and(eq(t.versionId, s.versionId!), inArray(t.period, s.periods!), inArray(t.buCode, s.bus!))!;
  }
  if (table === 'fm_actuals') return and(gte(schema.fmActuals.month, s.from!), lte(schema.fmActuals.month, s.to!))!;
  const t = table === 'boh_actuals' ? schema.bohActuals : schema.adminActuals;
  return and(gte(t.month, s.from!), lte(t.month, s.to!), inArray(t.account, s.accounts?.length ? s.accounts : ['-']))!;
}

/** how many rows an import with this scope would replace */
export async function countInScope(table: GlTable, s: GlScope, on: Tx = db): Promise<number> {
  const [r] = await on.select({ n: sql<number>`count(*)::int` }).from(TABLE[table]).where(scopeWhere(table, s));
  return r?.n ?? 0;
}

/** an import that would replace this many rows with that many is held for a confirmation (a partial file) */
export const dropsTooMuch = (existing: number, incoming: number) => existing > 0 && incoming < existing / 2;

/** Keeps the rows an import is about to replace (call inside the import's transaction, before the delete). */
export async function keepReplaced(tx: Tx, info: { planId: number; ledger: string | null; versionId: number | null; userId: number | null }, table: GlTable, s: GlScope, inserted: number) {
  const rows = (await tx.select().from(TABLE[table]).where(scopeWhere(table, s))) as Record<string, unknown>[];
  await tx.insert(schema.importHistory).values({
    planId: info.planId,
    kind: 'gl',
    ledger: info.ledger,
    versionId: info.versionId,
    tableName: table,
    scope: s as Record<string, unknown>,
    // ids are left out: the rows go back in as new rows
    rows: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id'))),
    removed: rows.length,
    inserted,
    userId: info.userId,
  });
}

/** the latest import of a ledger that can still be undone */
export async function undoableImport(ledger: string): Promise<{ planId: number; at: string } | null> {
  const [h] = await db
    .select({ planId: schema.importHistory.planId, at: schema.importHistory.createdAt })
    .from(schema.importHistory)
    .where(and(eq(schema.importHistory.kind, 'gl'), eq(schema.importHistory.ledger, ledger), isNull(schema.importHistory.undoneAt)))
    .orderBy(desc(schema.importHistory.planId))
    .limit(1);
  return h ? { planId: h.planId, at: h.at.toISOString() } : null;
}

/** Puts back what an import replaced. Only the latest import of each table can be undone. */
export async function undoGlImport(planId: number, userId: number): Promise<string> {
  const entries = await db.select().from(schema.importHistory).where(and(eq(schema.importHistory.planId, planId), isNull(schema.importHistory.undoneAt)));
  if (!entries.length) throw new Error('Nothing to undo for this import');
  for (const e of entries) {
    const later = await db
      .select({ id: schema.importHistory.id })
      .from(schema.importHistory)
      .where(
        and(
          eq(schema.importHistory.tableName, e.tableName),
          e.ledger ? eq(schema.importHistory.ledger, e.ledger) : undefined,
          isNull(schema.importHistory.undoneAt),
          sql`${schema.importHistory.planId} > ${planId}`,
        ),
      )
      .limit(1);
    if (later.length) throw new Error('A later import replaced the same data: undo that one first');
  }
  await db.transaction(async (tx) => {
    for (const e of entries) {
      const table = e.tableName as GlTable;
      await tx.delete(TABLE[table]).where(scopeWhere(table, e.scope as GlScope));
      const rows = e.rows as Record<string, unknown>[];
      for (let i = 0; i < rows.length; i += 500) await tx.insert(TABLE[table]).values(rows.slice(i, i + 500) as never);
      await tx.update(schema.importHistory).set({ undoneAt: new Date(), undoneBy: userId }).where(eq(schema.importHistory.id, e.id));
    }
    await tx.insert(schema.auditLog).values({
      userId,
      versionId: entries[0].versionId,
      entity: 'gl_import',
      action: 'undo',
      changes: { planId, ledger: entries[0].ledger, restored: Object.fromEntries(entries.map((e) => [e.tableName, e.removed])) },
    });
  });
  return `Import undone: ${entries.map((e) => `${e.removed.toLocaleString('en-US')} ${e.tableName.replace('_', ' ')} rows put back`).join(', ')}`;
}
