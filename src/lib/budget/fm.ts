// FM cost budget of a version, calculated over the whole portfolio (the staff allocation needs every
// building's works), then read per building by the reports.
import 'server-only';
import { cache } from 'react';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { computeFm } from './fm-calc';
import { withDefaults } from '@/lib/engine/assumptions';

export const loadFmBudget = cache(async (versionId: number) => {
  const [[version], props, lines, staff] = await Promise.all([
    db.select({ assumptions: schema.budgetVersions.assumptions }).from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId)),
    db.select({ id: schema.properties.id, bu: schema.properties.buCode, zone: schema.properties.fmZone }).from(schema.properties).where(eq(schema.properties.active, true)),
    db
      .select({ propertyId: schema.fmLines.propertyId, workType: schema.fmLines.workType, amount: schema.fmLines.amount, month: schema.fmLines.month })
      .from(schema.fmLines)
      .where(eq(schema.fmLines.versionId, versionId)),
    db.select().from(schema.fmStaff).where(eq(schema.fmStaff.versionId, versionId)),
  ]);
  return { result: computeFm(props, lines, staff, withDefaults(version?.assumptions).fmSupervision), budgeted: lines.length > 0 || staff.length > 0 };
});
