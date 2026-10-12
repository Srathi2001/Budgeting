// ASRE's budget (entity_budget): one amount a year per line, phased evenly, entered in Admin → ASRE once
// its finance team sends it (blank until then). In the statements it is an entity of the group: its mall
// lease cost and REHL-MJN's mall rent are eliminated when both are in view (audit REG-004).
import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Actor } from '@/lib/auth/permissions';
import { writeGuard, type Exec } from '@/lib/write-guard';
import { ASRE, ASRE_LINE, ASRE_LINES } from './asre-types';
import type { Atom } from './group-report';

const z12 = () => Array.from({ length: 12 }, () => 0);
const even = (amount: number) => Array.from({ length: 12 }, () => Math.round((amount / 12) * 100) / 100);

export async function loadAsreBudget(versionId: number, on: Exec = db): Promise<Record<string, number | null>> {
  const rows = await on.select().from(schema.entityBudget).where(and(eq(schema.entityBudget.versionId, versionId), eq(schema.entityBudget.entity, ASRE)));
  return Object.fromEntries(ASRE_LINES.map((l) => [l.key, rows.find((r) => r.line === l.key)?.amount ?? null]));
}

/** expense lines ASRE has amounts on (the statements show a line only once it is budgeted) */
export async function asreExpenseLines(versionId: number): Promise<string[]> {
  const b = await loadAsreBudget(versionId);
  return ASRE_LINES.filter((l) => l.kind === 'cost' && b[l.key]).map((l) => l.atom.slice(4));
}

/**
 * ASRE's atoms for the statements, and the elimination of the mall lease: with the Mall in view, the part
 * of the Mall's rent that ASRE's lease cost matches is intergroup on both sides, month by month.
 */
export async function asreAtoms(versionId: number, atoms: Atom[], mallInView: boolean): Promise<Atom[]> {
  const b = await loadAsreBudget(versionId);
  const out: Atom[] = [];
  const lease = even(b.mallLease ?? 0);
  // how much of the Mall's rent (group class) the lease matches
  const mallRent = z12();
  for (const a of atoms) if (a.line === 'rent' && a.entity === 'MALL' && a.cls === 'group') a.months.forEach((v, i) => (mallRent[i] += v));
  const matched = mallInView ? lease.map((v, i) => Math.min(v, mallRent[i])) : z12();
  for (const l of ASRE_LINES) {
    const amount = b[l.key];
    if (!amount) continue;
    const months = even(amount);
    if (l.key === 'mallLease') {
      out.push({ line: l.atom, entity: ASRE, cls: 'intergroup', months: matched }, { line: `cash:${l.atom}`, entity: ASRE, cls: 'intergroup', months: matched });
      const rest = months.map((v, i) => v - matched[i]);
      out.push({ line: l.atom, entity: ASRE, cls: 'group', months: rest }, { line: `cash:${l.atom}`, entity: ASRE, cls: 'group', months: rest });
      continue;
    }
    const cashLine = l.atom === 'rent' ? 'cash:rent' : l.atom.startsWith('oi:') ? 'cash:oi' : `cash:${l.atom}`;
    out.push({ line: l.atom, entity: ASRE, cls: 'group', months }, { line: cashLine, entity: ASRE, cls: 'group', months });
  }
  // the Mall's side of the elimination: that part of its rent (and its cash) is intergroup
  if (matched.some((v) => v)) {
    for (const line of ['rent', 'cash:rent']) {
      let left = [...matched];
      for (const a of atoms) {
        if (a.line !== line || a.entity !== 'MALL' || a.cls !== 'group') continue;
        const take = a.months.map((v, i) => Math.min(v, left[i]));
        a.months = a.months.map((v, i) => v - take[i]);
        left = left.map((v, i) => v - take[i]);
        out.push({ line, entity: 'MALL', cls: 'intergroup', months: take });
      }
    }
  }
  return out;
}

/** Saves ASRE's budget lines (Admin only; the caller checks). */
export async function saveAsreBudget(user: Actor, versionId: number, values: Record<string, number | null>): Promise<{ error?: string }> {
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version || version.status === 'LOCKED') return { error: 'This budget version is locked' };
  for (const [k, v] of Object.entries(values)) {
    if (!ASRE_LINE.has(k)) return { error: `Unknown line ${k}` };
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1e10)) return { error: `${ASRE_LINE.get(k)!.label}: not a valid amount` };
  }
  const locked = await db.transaction(async (tx) => {
    // the version stays open until this commits; "before" is read in here, as it is now
    const cur = await writeGuard(tx, versionId);
    if (!cur || cur.status === 'LOCKED') return true;
    const before = await loadAsreBudget(versionId, tx);
    for (const [line, amount] of Object.entries(values)) {
      if ((before[line] ?? null) === amount) continue;
      const where = and(eq(schema.entityBudget.versionId, versionId), eq(schema.entityBudget.entity, ASRE), eq(schema.entityBudget.line, line));
      if (amount === null) await tx.delete(schema.entityBudget).where(where);
      else
        await tx
          .insert(schema.entityBudget)
          .values({ versionId, entity: ASRE, line, amount, updatedBy: user.id })
          .onConflictDoUpdate({ target: [schema.entityBudget.versionId, schema.entityBudget.entity, schema.entityBudget.line], set: { amount, updatedAt: new Date(), updatedBy: user.id } });
      await tx.insert(schema.auditLog).values({ userId: user.id, versionId, entity: 'asre_budget', entityId: line, action: 'update', changes: { from: before[line] ?? null, to: amount } });
    }
    return false;
  });
  return locked ? { error: 'This budget version is locked' } : {};
}
