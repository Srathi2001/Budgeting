'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db';
import { requireUser } from '@/lib/auth/dal';
import { lastChange } from '@/lib/conflict';
import { diffTemplate, type TemplateChange, type TemplateConflict, type TemplateError, type TemplateKept } from '@/lib/excel/cell-template';
import { applyInputTemplate, buildInputTemplate, isTemplateKind, templateAccess } from '@/lib/excel/input-templates';

export interface TemplateUploadResult {
  error?: string;
  changes: TemplateChange[];
  errors: TemplateError[];
  /** cells changed both in the file and in the tool since the download: the uploader chooses */
  conflicts?: TemplateConflict[];
  /** cells left as downloaded that someone else changed meanwhile: their value stays */
  kept?: TemplateKept[];
  /** apply only: figures changed again since the preview; nothing was saved, the preview is shown again */
  again?: boolean;
  saved?: number;
  /** what the save path refused */
  refused?: string[];
}

const PAGE: Record<string, string> = { 'other-income': '/other-income', 'building-overheads': '/building-overheads', 'admin-overheads': '/admin-overheads', 'fm-labour': '/fm' };

/** where a template cell's changes are in the change history (who changed it in the tool, and when) */
function historyOf(kind: string, c: TemplateChange): { entity: string; entityId: string | null; field?: string } | null {
  if (kind === 'other-income') return { entity: 'other_income', entityId: `${c.key}|${c.column}` };
  if (kind === 'building-overheads') return { entity: 'boh_budget', entityId: c.key };
  if (kind === 'fm-labour') return { entity: 'fm_staff', entityId: null };
  if (kind === 'admin-overheads') {
    // the keys the admin overheads save records (admin.ts saveAdminOverheads)
    const [k, a, b] = c.key.split('|');
    if (k === 'pay') return { entity: 'admin_overheads', entityId: JSON.stringify({ kind: 'payroll', dept: a, field: c.column }) };
    if (k === 'adm') return { entity: 'admin_overheads', entityId: JSON.stringify({ kind: 'admin', dept: a, account: b, entity: c.column.slice(1) }) };
    if (k === 'fee') return { entity: 'admin_overheads', entityId: JSON.stringify({ kind: 'fee', fee: a, entity: b, field: c.column }) };
  }
  return null;
}

/**
 * Upload of a page's input template: `apply` false = preview of the changes, true = save them. `useMine`:
 * the conflicts (cells changed both in the file and in the tool) the uploader takes from the file;
 * `previewed`: the conflicts the preview showed (a new one at apply time sends the preview back).
 */
export async function uploadInputTemplate(kind: string, versionId: number, form: FormData, apply: boolean, useMine: string[] = [], previewed: string[] = []): Promise<TemplateUploadResult> {
  const user = await requireUser();
  const none = { changes: [], errors: [] };
  if (!isTemplateKind(kind)) return { ...none, error: 'Unknown template' };
  const denied = templateAccess(kind, user);
  if (denied) return { ...none, error: denied };
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return { ...none, error: 'Choose the template (.xlsx)' };
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version) return { ...none, error: 'Version not found' };
  if (version.status === 'LOCKED') return { ...none, error: 'This budget version is locked' };
  // compared with everything the user can see, not only the current filters
  const current = await buildInputTemplate(kind, user, version, false);
  const diff = await diffTemplate(await file.arrayBuffer(), current);
  if (diff.error) return { ...none, error: diff.error };
  // who changed the conflicting cells in the tool, and when
  const conflicts = await Promise.all(
    diff.conflicts.map(async (c) => {
      const h = historyOf(kind, c);
      const who = h ? await lastChange(db, h.entity, h.entityId, h.field) : null;
      return { ...c, by: who?.who ?? null, at: who?.at.toISOString() ?? null };
    }),
  );
  const result = { changes: diff.changes, errors: diff.errors, conflicts, kept: diff.kept };
  if (!apply) return result;
  // changed again since the preview: show it again, save nothing
  const known = new Set(previewed);
  if (conflicts.some((c) => !known.has(c.id))) return { ...result, again: true };
  const mine = new Set(useMine);
  const plain = (c: TemplateConflict): TemplateChange => ({ excelRow: c.excelRow, sheet: c.sheet, key: c.key, row: c.row, column: c.column, header: c.header, from: c.from, to: c.to });
  const take = [...diff.changes, ...conflicts.filter((c) => mine.has(c.id)).map(plain)];
  if (!take.length) return { ...result, saved: 0 };
  const r = await applyInputTemplate(kind, user, version, current, take);
  revalidatePath(PAGE[kind] ?? '/building-overheads');
  return { ...result, saved: r.saved, refused: r.errors };
}
