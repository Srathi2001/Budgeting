'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { requireUser, canEditProperty, editablePropertyIds, visibleProperties } from '@/lib/auth/dal';
import { recalcLines } from '@/lib/budget/calc';
import { writeGuard } from '@/lib/write-guard';
import { loadMasterRows } from '@/lib/budget/master';
import { applyLineChanges, applyLineChangesIn } from '@/lib/budget/save';
import { saveReraRange, saveReraRangeIn } from '@/lib/budget/rera';
import { diffUpload, readTemplate, type UploadChange, type UploadConflict, type UploadKept } from '@/lib/budget/excel-template';
import { lastChange } from '@/lib/conflict';
import type { RowPatch, SaveResult, MasterRow } from '@/lib/budget/master-types';

export async function saveLines(versionId: number, changes: { lineId: number; patch: RowPatch; seen?: Record<string, unknown> }[]): Promise<SaveResult> {
  const user = await requireUser();
  return applyLineChanges(user, versionId, changes);
}
const NewUnitSchema = z.object({
  propertyId: z.number().int(),
  unitCode: z.string().trim().min(1).max(80),
  rc: z.enum(['R', 'C', 'L']),
  bedroom: z.string().max(40).nullable(),
  area: z.number().min(0).nullable(),
  unitType: z.string().max(80).nullable(),
});

export async function addUnit(
  versionId: number,
  input: z.infer<typeof NewUnitSchema>,
): Promise<{ row?: MasterRow; error?: string }> {
  const user = await requireUser();
  const parsed = NewUnitSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const check = await canEditProperty(user, versionId, parsed.data.propertyId);
  if (!check.ok) return { error: check.reason };

  const lineId = await db.transaction(async (tx) => {
    // one lease save of the version at a time; the permission check holds until this commits
    await writeGuard(tx, versionId, { leases: true });
    const held = await canEditProperty(user, versionId, parsed.data.propertyId, 'PM', tx);
    if (!held.ok) throw new Error(held.reason);
    let [unit] = await tx.select().from(schema.units).where(eq(schema.units.unitCode, parsed.data.unitCode));
    if (unit && unit.propertyId !== parsed.data.propertyId) throw new Error('That unit code belongs to another property');
    if (!unit) {
      [unit] = await tx
        .insert(schema.units)
        .values({
          propertyId: parsed.data.propertyId,
          unitCode: parsed.data.unitCode,
          rc: parsed.data.rc,
          bedroom: parsed.data.bedroom,
          area: parsed.data.area,
          unitType: parsed.data.unitType,
        })
        .returning();
    }
    const [exists] = await tx
      .select()
      .from(schema.leaseLines)
      .where(and(eq(schema.leaseLines.versionId, versionId), eq(schema.leaseLines.unitId, unit.id)));
    if (exists) throw new Error('Unit is already in this budget');
    const [line] = await tx
      .insert(schema.leaseLines)
      .values({ versionId, unitId: unit.id, propertyId: unit.propertyId, vacant: true, renew1: false, tenant: 'VACANT', updatedBy: user.id })
      .returning();
    await tx.insert(schema.auditLog).values({
      userId: user.id,
      versionId,
      propertyId: unit.propertyId,
      entity: 'lease_line',
      entityId: String(line.id),
      action: 'create',
      changes: { unit: unit.unitCode },
    });
    await recalcLines(tx, versionId, [line.id]);
    return line.id;
  }).catch((e: Error) => e);
  if (lineId instanceof Error) return { error: lineId.message };
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  const [row] = await loadMasterRows(versionId, { lineIds: [lineId], editableProperties: await editablePropertyIds(user, version, 'PM') });
  return { row };
}

const ReraSchema = z.object({
  propertyId: z.number().int(),
  bedroom: z.string().trim().min(1, 'The unit has no bedroom / RERA code').max(40),
  min: z.number().min(0).max(1e9).nullable(),
  max: z.number().min(0).max(1e9).nullable(),
});

/**
 * RERA rent range for one property and bedroom code, entered by the property's PM (or Finance).
 * Both blank removes the row. Every line of the property with that code is recalculated.
 */
export async function saveRera(versionId: number, input: z.infer<typeof ReraSchema>): Promise<{ rows?: MasterRow[]; error?: string }> {
  const user = await requireUser();
  const parsed = ReraSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { propertyId, bedroom, min, max } = parsed.data;
  const check = await canEditProperty(user, versionId, propertyId);
  if (!check.ok) return { error: check.reason };
  const saved = await saveReraRange(user, versionId, propertyId, bedroom, min, max);
  if (saved.error) return { error: saved.error };
  const lineIds = saved.lineIds!;
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  return { rows: await loadMasterRows(versionId, { lineIds, editableProperties: await editablePropertyIds(user, version, 'PM') }) };
}

export interface TemplateUploadResult {
  error?: string;
  changes: UploadChange[];
  errors: { excelRow: number; unit: string; message: string }[];
  /** fields changed both in the file and in the tool since the download: the uploader chooses */
  conflicts?: UploadConflict[];
  /** fields left as downloaded that someone else changed meanwhile: their value stays */
  kept?: UploadKept[];
  /** apply only: fields changed again since the preview; nothing was saved, the preview is shown again */
  again?: boolean;
  /** lines and RERA ranges saved (apply only) */
  saved?: { lines: number; rera: number };
}

/**
 * Lease Budget input template upload. Without `apply` it only reports what would change; with
 * `apply` the changes go through the same save path as the grid, in one transaction (RERA ranges and
 * lines land together). `useMine`: the conflicts the uploader takes from the file; `previewed`: the
 * conflicts the preview showed (a new one at apply time sends the preview back).
 */
export async function uploadTemplate(versionId: number, form: FormData, apply: boolean, useMine: string[] = [], previewed: string[] = []): Promise<TemplateUploadResult> {
  const user = await requireUser();
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return { error: 'Choose the filled-in template (.xlsx)', changes: [], errors: [] };
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version) return { error: 'Version not found', changes: [], errors: [] };
  const { rows: uploaded, original, error } = await readTemplate(await file.arrayBuffer(), version.year);
  if (error) return { error, changes: [], errors: [] };
  if (!uploaded.length) return { error: 'No lines found in the “Lease Budget” sheet', changes: [], errors: [] };

  const editable = await editablePropertyIds(user, version, 'PM');
  const visible = new Set((await visibleProperties(user)).map((p) => p.id));
  const current = (await loadMasterRows(versionId, { lineIds: uploaded.map((u) => u.lineId), editableProperties: editable })).filter((r) => visible.has(r.propertyId));
  const byLine = new Map(current.map((r) => [r.lineId, r]));
  const diff = diffUpload(uploaded, byLine, version.year, original, new Set(useMine));
  // who changed the conflicting fields in the tool, and when
  const conflicts = await Promise.all(
    diff.conflicts.map(async (c) => {
      const key = c.id.split('|')[1];
      const field = key === 'outcome' ? 'renew1' : key === 'reraMin' || key === 'reraMax' ? undefined : key;
      const who = field ? await lastChange(db, 'lease_line', String(c.lineId), field) : null;
      return { ...c, by: who?.who ?? null, at: who?.at.toISOString() ?? null };
    }),
  );
  const result = { changes: diff.changes, errors: diff.errors, conflicts, kept: diff.kept };
  if (!apply) return result;
  // changed again since the preview: show it again, save nothing
  const known = new Set([...previewed, ...useMine]);
  if (conflicts.some((c) => !known.has(c.id))) return { ...result, again: true };

  const errors = [...diff.errors];
  const rowOf = new Map(uploaded.map((u) => [u.lineId, u.excelRow]));
  let reraSaved = 0;
  // with the values the tool has now (read for this comparison): a field changed in the moment before the
  // save is reported, not overwritten
  const changes = [...diff.patches].map(([lineId, patch]) => {
    const r = byLine.get(lineId) as unknown as Record<string, unknown>;
    return { lineId, patch, seen: Object.fromEntries(Object.keys(patch).map((k) => [k, r[k] ?? null])) };
  });
  const lineErrors = await db.transaction(async (tx) => {
    await writeGuard(tx, versionId, { leases: true });
    for (const r of diff.rera) {
      const res = await saveReraRangeIn(tx, user, versionId, r.propertyId, r.bedroom, r.min, r.max);
      if (res.error) errors.push({ excelRow: r.excelRow, unit: r.unit, message: `RERA: ${res.error}` });
      else reraSaved++;
    }
    const res = await applyLineChangesIn(tx, user, versionId, changes);
    await tx.insert(schema.auditLog).values({
      userId: user.id,
      versionId,
      entity: 'template_upload',
      action: 'apply',
      changes: { file: file.name, lines: diff.patches.size - res.length, rera: reraSaved, rejected: errors.length + res.length },
    });
    return res;
  });
  for (const e of lineErrors) errors.push({ excelRow: rowOf.get(e.lineId) ?? 0, unit: byLine.get(e.lineId)?.unitCode ?? String(e.lineId), message: e.message });
  return { ...result, errors, saved: { lines: diff.patches.size - lineErrors.length, rera: reraSaved } };
}

export async function removeLine(versionId: number, lineId: number): Promise<{ error?: string }> {
  const user = await requireUser();
  const [line] = await db
    .select({ l: schema.leaseLines, u: schema.units })
    .from(schema.leaseLines)
    .innerJoin(schema.units, eq(schema.units.id, schema.leaseLines.unitId))
    .where(and(eq(schema.leaseLines.id, lineId), eq(schema.leaseLines.versionId, versionId)));
  if (!line) return { error: 'Row not found' };
  const check = await canEditProperty(user, versionId, line.l.propertyId);
  if (!check.ok) return { error: check.reason };
  const gone = await db.transaction(async (tx) => {
    // one lease save of the version at a time; the checks hold until this commits
    await writeGuard(tx, versionId, { leases: true });
    const held = await canEditProperty(user, versionId, line.l.propertyId, 'PM', tx);
    if (!held.ok) return held.reason;
    const [deleted] = await tx.delete(schema.leaseLines).where(eq(schema.leaseLines.id, lineId)).returning();
    if (!deleted) return 'Row not found';
    await tx.insert(schema.auditLog).values({
      userId: user.id,
      versionId,
      propertyId: line.l.propertyId,
      entity: 'lease_line',
      entityId: String(lineId),
      action: 'delete',
      // the whole line as it was (its inputs included), without the cached calculation
      changes: { unit: line.u.unitCode, from: { ...deleted, calc: undefined }, to: null },
    });
    return null;
  });
  return gone ? { error: gone } : {};
}
