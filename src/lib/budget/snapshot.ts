// What a version shows at the moment it is locked, for the figures otherwise worked out live from data
// shared with other versions (audit FIN-004, user decision 11-Oct-2026): the comparatives (2024A, 2025A,
// 2026F per property), the current-year rent forecast by line, the building overhead cells and the PMA /
// AMA fees. Stored in version_snapshots on lock (admin/actions setVersionStatus), dropped on reopen; the
// loaders read it through snapshot-store while the version is locked. Lease figures are already stored
// per line (line_monthly) and a locked version is never recalculated.
import 'server-only';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { comparativeLabels, resolveComparatives, type ComparativesSnapshot } from './comparatives';
import { liveForecast, type ForecastSnapshot } from './forecast';
import { bohSnapshot } from './boh';
import { managementFees } from './admin';
import type { SnapshotPart } from './snapshot-store';

export async function takeSnapshot(version: schema.BudgetVersion): Promise<{ part: SnapshotPart; data: unknown }[]> {
  // worked out as the open version shows it now
  const open = { ...version, status: 'OPEN' as const };
  const ids = (await db.select({ id: schema.properties.id }).from(schema.properties)).map((p) => p.id);
  const labels = await comparativeLabels(version);
  const comps = await resolveComparatives(open, labels, ids);
  const comparatives: ComparativesSnapshot = { labels, values: Object.fromEntries(comps.values), lastActual: comps.lastActual };
  const f = await liveForecast(open, ids);
  const lineProperty = new Map((await db.select({ id: schema.leaseLines.id, p: schema.leaseLines.propertyId }).from(schema.leaseLines).where(eq(schema.leaseLines.versionId, version.id))).map((l) => [l.id, l.p]));
  const forecast: ForecastSnapshot = {
    year: f.year,
    label: f.label,
    cutoff: f.cutoff,
    properties: [...f.properties.values()],
    lines: [...f.lines].map(([id, m]) => [id, lineProperty.get(id) ?? -1, m]),
  };
  return [
    { part: 'comparatives', data: comparatives },
    { part: 'forecast', data: forecast },
    { part: 'boh', data: await bohSnapshot(version) },
    { part: 'fees', data: await managementFees(open) },
  ];
}
