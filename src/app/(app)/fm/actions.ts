'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db';
import { requireUser, visibleProperties } from '@/lib/auth/dal';
import { fmTransitionAs, saveFmLinesAs, saveFmStaffAs, type FmResult } from '@/lib/budget/fm-save';
import { loadFmTemplate } from '@/lib/budget/fm-page';
import { diffFmUpload, readFmTemplate, type FmUploadChange, type FmUploadError } from '@/lib/budget/fm-excel';

const done = (r: FmResult) => {
  if (!r.error) revalidatePath('/fm');
  return r;
};

export async function saveFmLines(versionId: number, propertyId: number, input: unknown): Promise<FmResult> {
  return done(await saveFmLinesAs(await requireUser(), versionId, propertyId, input));
}

export async function saveFmStaff(versionId: number, input: unknown): Promise<FmResult> {
  return done(await saveFmStaffAs(await requireUser(), versionId, input));
}

export async function fmTransition(versionId: number, propertyId: number, action: 'submit' | 'approve' | 'return', note: string | null): Promise<FmResult> {
  return done(await fmTransitionAs(await requireUser(), versionId, propertyId, action, note));
}

export interface FmUploadResult {
  error?: string;
  changes: FmUploadChange[];
  errors: FmUploadError[];
  saved?: { facilities: number; changes: number };
}

/** Upload of the FM Budget template: `apply` false = preview of the changes, true = save them. */
export async function uploadFmTemplate(versionId: number, form: FormData, apply: boolean): Promise<FmUploadResult> {
  const user = await requireUser();
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return { error: 'Choose the FM Budget template (.xlsx)', changes: [], errors: [] };
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version) return { error: 'Version not found', changes: [], errors: [] };
  if (version.status === 'LOCKED') return { error: 'This budget version is locked', changes: [], errors: [] };
  const read = await readFmTemplate(await file.arrayBuffer());
  if (read.error) return { error: read.error, changes: [], errors: [] };
  // every facility the user can see, not only the current filters
  const visible = (await visibleProperties(user)).map((p) => p.id);
  const { facilities } = await loadFmTemplate(version, user, visible);
  const current = new Map(facilities.flatMap((f) => f.lines.map((l) => [l.id, { ...l, propertyId: f.id }] as const)));
  const { saves, changes, errors } = diffFmUpload(read.rows, facilities, current);
  if (!apply) return { changes, errors };

  const code = new Map(facilities.map((f) => [f.id, f.code]));
  const ok = new Set<string>();
  for (const [propertyId, s] of saves) {
    const r = await saveFmLinesAs(user, versionId, propertyId, s);
    if (r.error) errors.push({ excelRow: 0, facility: code.get(propertyId) ?? '', message: r.error });
    else ok.add(code.get(propertyId) ?? '');
  }
  revalidatePath('/fm');
  return { changes, errors, saved: { facilities: ok.size, changes: changes.filter((c) => ok.has(c.facility)).length } };
}
