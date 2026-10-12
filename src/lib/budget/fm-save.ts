// FM budget writes, for the FM Budget page (fm/actions.ts) and the workflow checks.
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { canEditFm, entersData, isAdmin, type Actor } from '@/lib/auth/permissions';
import { changedFields, pick } from '@/lib/audit-diff';
import { fmtDateTime } from '@/lib/format';
import { writeGuard } from '@/lib/write-guard';
import { BUSINESS_NEEDS, ELEMENTS, FM_KINDS, WORK_TYPE, isWorkType, type StaffTeam, type WorkType } from './fm-types';

export type FmResult = { error?: string; ok?: string };

const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((s) => (s && s.trim() ? s.trim() : null));

const Line = z.object({
  id: z.number().int().nullable(),
  workType: z.string().refine(isWorkType, 'Unknown work type'),
  element: z.string().refine((e) => ELEMENTS.some((x) => x.code === e), 'Unknown building element'),
  subElement: text(200),
  description: text(1000),
  businessNeed: z.enum(BUSINESS_NEEDS).nullable(),
  kind: z.enum(FM_KINDS.map((k) => k.code) as [string, ...string[]]),
  amount: z.number().finite().min(0, 'Amounts cannot be negative').max(1e9),
  month: z.number().int().min(1).max(12).nullable(),
  remarks: text(1000),
});
const Save = z.object({ lines: z.array(Line).max(2000), deleted: z.array(z.number().int()).max(2000) });

const spreads = (workType: string) => WORK_TYPE.get(workType as WorkType)?.spread ?? true;

/** Saves a facility's lines: new lines are added, changed ones updated, removed ones deleted. Lines from the tool keep what the work is. */
export async function saveFmLinesAs(user: Actor, versionId: number, propertyId: number, input: unknown): Promise<FmResult> {
  const check = await canEditFm(user, versionId, propertyId);
  if (!check.ok) return { error: check.reason };
  const parsed = Save.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { lines, deleted } = parsed.data;

  const where = and(eq(schema.fmLines.versionId, versionId), eq(schema.fmLines.propertyId, propertyId));
  let added = 0;
  let changed = 0;
  // one audit row per line, with its fields before and after
  const FIELDS = ['workType', 'element', 'subElement', 'description', 'businessNeed', 'kind', 'amount', 'month', 'remarks'] as const;
  const trail: (typeof schema.auditLog.$inferInsert)[] = [];
  const log = (id: number, action: string, changes: unknown) => trail.push({ userId: user.id, versionId, propertyId, entity: 'fm_line', entityId: String(id), action, changes });
  const refused = await db.transaction(async (tx): Promise<string | null> => {
    // the facility's status and lines as they are now, held until this commits (a submission waits)
    await writeGuard(tx, versionId, { facilities: [propertyId] });
    const held = await canEditFm(user, versionId, propertyId, tx);
    if (!held.ok) return held.reason;
    const existing = new Map((await tx.select().from(schema.fmLines).where(where)).map((l) => [l.id, l]));
    for (const id of deleted) {
      const l = existing.get(id);
      if (!l) return 'A removed line is not on this facility';
      if (l.source !== 'FM') return 'Lines carried from last year cannot be removed; set the amount to 0';
    }
    for (const l of lines) if (l.id !== null && !existing.has(l.id)) return 'A line is not on this facility';
    if (deleted.length) await tx.delete(schema.fmLines).where(and(where, inArray(schema.fmLines.id, deleted)));
    for (const id of deleted) log(id, 'delete', { from: pick(existing.get(id)!, FIELDS), to: null });
    for (const l of lines) {
      if (l.id === null) {
        // recurring work is spread over the year; projects go in the month planned
        const v = { ...l, id: undefined, month: spreads(l.workType) ? null : l.month };
        const [row] = await tx.insert(schema.fmLines).values({ ...v, versionId, propertyId, source: 'FM', updatedBy: user.id }).returning({ id: schema.fmLines.id });
        log(row.id, 'create', { from: null, to: pick(v, FIELDS) });
        added++;
        continue;
      }
      const before = existing.get(l.id)!;
      // what came from the tool stays as it is: only the budget fields of such a line change
      const set =
        before.source === 'FM'
          ? {
              workType: l.workType,
              element: l.element,
              subElement: l.subElement,
              description: l.description,
              businessNeed: l.businessNeed,
              kind: l.kind,
              amount: l.amount,
              month: spreads(l.workType) ? null : l.month,
              remarks: l.remarks,
            }
          : { businessNeed: l.businessNeed, kind: l.kind, amount: l.amount, month: spreads(before.workType) ? null : l.month, remarks: l.remarks };
      if (Object.entries(set).every(([k, v]) => (before as Record<string, unknown>)[k] === v)) continue;
      await tx
        .update(schema.fmLines)
        .set({ ...set, updatedAt: new Date(), updatedBy: user.id })
        .where(and(where, eq(schema.fmLines.id, l.id)));
      log(l.id, 'update', { fields: changedFields(before as unknown as Record<string, unknown>, set) });
      changed++;
    }
    for (let i = 0; i < trail.length; i += 500) await tx.insert(schema.auditLog).values(trail.slice(i, i + 500));
    return null;
  });
  if (refused) return { error: refused };
  return { ok: added || changed || deleted.length ? `Saved: ${added} added, ${changed} changed, ${deleted.length} removed` : 'No changes' };
}

const Staff = z
  .array(
    z.object({
      team: z.enum(['SUPERVISORY', 'ZONE_1', 'ZONE_2', 'ZONE_3', 'PPM', 'VACANT', 'GA']),
      ctc: z.number().finite().min(0).max(1e9),
      overtime: z.number().finite().min(0).max(1e9),
    }),
  )
  .max(7);

/**
 * The staff budget is spread over every facility, so a change moves cost inside facilities already
 * submitted or approved. Facilities management (or Admin) may change it only while no facility is
 * submitted or approved; Finance does not enter it.
 */
export function staffEditBlocked(user: Pick<Actor, 'role'>, statuses: string[]): string | null {
  if (user.role !== 'ADMIN' && user.role !== 'FM') return 'The FM staff budget is entered by facilities management';
  const n = statuses.filter((s) => s === 'SUBMITTED' || s === 'APPROVED').length;
  return n ? `${n} ${n === 1 ? 'facility is' : 'facilities are'} submitted or approved: the staff budget is fixed; Admin returns them for changes` : null;
}

export async function saveFmStaffAs(user: Actor, versionId: number, input: unknown): Promise<FmResult> {
  if (!entersData(user, 'FM')) return { error: 'The FM staff budget is entered by facilities management' };
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version || version.status === 'LOCKED') return { error: 'This budget version is locked' };
  const subs = await db.select({ status: schema.fmSubmissions.status }).from(schema.fmSubmissions).where(eq(schema.fmSubmissions.versionId, versionId));
  const blocked = staffEditBlocked(user, subs.map((s) => s.status));
  if (blocked) return { error: blocked };
  const parsed = Staff.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const refused = await db.transaction(async (tx): Promise<string | null> => {
    // one staff save at a time, and no facility submitted until this commits; the checks read it as it is now
    const cur = await writeGuard(tx, versionId, { fmStaff: 'exclusive' });
    if (!cur || cur.status === 'LOCKED') return 'This budget version is locked';
    const subs = await tx.select({ status: schema.fmSubmissions.status }).from(schema.fmSubmissions).where(eq(schema.fmSubmissions.versionId, versionId));
    const blocked = staffEditBlocked(user, subs.map((s) => s.status));
    if (blocked) return blocked;
    const before = await tx.select({ team: schema.fmStaff.team, ctc: schema.fmStaff.ctc, overtime: schema.fmStaff.overtime }).from(schema.fmStaff).where(eq(schema.fmStaff.versionId, versionId));
    for (const s of parsed.data) {
      const row = { versionId, team: s.team as StaffTeam, ctc: s.ctc, overtime: s.team === 'GA' ? 0 : s.overtime, updatedBy: user.id };
      await tx
        .insert(schema.fmStaff)
        .values(row)
        .onConflictDoUpdate({ target: [schema.fmStaff.versionId, schema.fmStaff.team], set: { ctc: row.ctc, overtime: row.overtime, updatedAt: new Date(), updatedBy: user.id } });
    }
    await tx.insert(schema.auditLog).values({ userId: user.id, versionId, entity: 'fm_staff', action: 'save', changes: { before, after: parsed.data, facilitiesSubmittedOrApproved: subs.filter((x) => x.status === 'SUBMITTED' || x.status === 'APPROVED').length } });
    return null;
  });
  if (refused) return { error: refused };
  return { ok: 'Staff budget saved' };
}

type Status = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED';
const TRANSITIONS: Record<'submit' | 'approve' | 'return', { from: Status[]; to: Status; admin: boolean }> = {
  submit: { from: ['DRAFT', 'RETURNED'], to: 'SUBMITTED', admin: false },
  approve: { from: ['SUBMITTED'], to: 'APPROVED', admin: true },
  return: { from: ['SUBMITTED', 'APPROVED'], to: 'RETURNED', admin: true },
};

/** FM submits a facility; Admin approves or returns it. */
export async function fmTransitionAs(user: Actor, versionId: number, propertyId: number, action: keyof typeof TRANSITIONS, note: string | null): Promise<FmResult> {
  const t = TRANSITIONS[action];
  if (!t) return { error: 'Unknown action' };
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version || version.status === 'LOCKED') return { error: 'This budget version is locked' };
  if (t.admin ? !isAdmin(user) : !entersData(user, 'FM')) return { error: t.admin ? 'Only Admin approves or returns' : 'Only facilities management can submit' };
  if (action === 'return' && !note?.trim()) return { error: 'Give a reason for returning it' };
  const where = and(eq(schema.fmSubmissions.versionId, versionId), eq(schema.fmSubmissions.propertyId, propertyId));
  const n = note?.trim().slice(0, 2000) || null;
  // the status and its audit row change together or not at all; the transition waits for the facility's
  // saves running now (and a staff save) and reads the status as it is at that moment
  const refused = await db.transaction(async (tx): Promise<string | null> => {
    const cur = await writeGuard(tx, versionId, { fmStaff: 'shared', facilities: [propertyId], facilityMode: 'exclusive' });
    if (!cur || cur.status === 'LOCKED') return 'This budget version is locked';
    const [sub] = await tx.select({ s: schema.fmSubmissions, who: schema.users.name }).from(schema.fmSubmissions).leftJoin(schema.users, eq(schema.users.id, schema.fmSubmissions.updatedBy)).where(where);
    const current: Status = sub?.s.status ?? 'DRAFT';
    if (!t.from.includes(current)) {
      const by = sub?.who && sub.s.updatedBy !== user.id ? ` (${current.toLowerCase()} by ${sub.who} on ${fmtDateTime(sub.s.updatedAt)})` : '';
      return `Cannot ${action} a facility that is ${current.toLowerCase()}${by}`;
    }
    await tx
      .insert(schema.fmSubmissions)
      .values({ versionId, propertyId, status: t.to, note: n, updatedBy: user.id })
      .onConflictDoUpdate({ target: [schema.fmSubmissions.versionId, schema.fmSubmissions.propertyId], set: { status: t.to, note: n, updatedAt: new Date(), updatedBy: user.id } });
    await tx.insert(schema.auditLog).values({ userId: user.id, versionId, propertyId, entity: 'fm_submission', action, changes: { from: current, to: t.to, note: n } });
    return null;
  });
  if (refused) return { error: refused };
  return { ok: action === 'submit' ? 'Submitted to Admin' : action === 'approve' ? 'Approved' : 'Returned to facilities management' };
}
