'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db';
import { requireUser } from '@/lib/auth/dal';
import { diffTemplate, type TemplateChange, type TemplateError } from '@/lib/excel/cell-template';
import { applyInputTemplate, buildInputTemplate, isTemplateKind, templateAccess } from '@/lib/excel/input-templates';

export interface TemplateUploadResult {
  error?: string;
  changes: TemplateChange[];
  errors: TemplateError[];
  saved?: number;
  /** what the save path refused */
  refused?: string[];
}

const PAGE: Record<string, string> = { 'other-income': '/other-income', 'building-overheads': '/building-overheads', 'admin-overheads': '/admin-overheads', 'fm-labour': '/fm' };

/** Upload of a page's input template: `apply` false = preview of the changes, true = save them. */
export async function uploadInputTemplate(kind: string, versionId: number, form: FormData, apply: boolean): Promise<TemplateUploadResult> {
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
  if (!apply || !diff.changes.length) return { changes: diff.changes, errors: diff.errors };
  const r = await applyInputTemplate(kind, user, version, current, diff.changes);
  revalidatePath(PAGE[kind]);
  return { changes: diff.changes, errors: diff.errors, saved: r.saved, refused: r.errors };
}
