import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireUser, isFinance, requireVersion } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { propertyRollups } from '@/lib/budget/reports';
import { sum } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Banner } from '@/components/ui/status';
import { ActivityTable } from '@/components/activity-table';
import { SubmissionsBoard, type BoardRow } from './board';

export const metadata = { title: 'Submissions · Budget' };

export default async function SubmissionsPage() {
  const user = await requireUser();
  const v = await requireVersion();
  // the shared page filters pick the properties; a submission covers the whole property
  const ids = (await filteredScope(user)).propertyIds;
  const rolls = await propertyRollups(v.id, ids);
  const subs = await db.select().from(schema.submissions).where(eq(schema.submissions.versionId, v.id));
  const byId = new Map(subs.map((s) => [s.propertyId, s]));
  const finance = isFinance(user);
  const open = v.status === 'OPEN';

  const rows: BoardRow[] = rolls.map((r) => ({
    propertyId: r.propertyId,
    code: r.code,
    name: r.name,
    buName: r.buName,
    coordinator: r.coordinator,
    units: r.units,
    vacantUnits: r.vacantUnits,
    warnings: r.warnings,
    revenue: sum(r.revenue),
    status: r.status,
    note: byId.get(r.propertyId)?.note ?? null,
    updatedAt: byId.get(r.propertyId)?.updatedAt.toISOString() ?? null,
  }));

  const activity = await db
    .select({ a: schema.auditLog, user: schema.users.name, property: schema.properties.name })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
    .leftJoin(schema.properties, eq(schema.properties.id, schema.auditLog.propertyId))
    .where(and(eq(schema.auditLog.versionId, v.id), inArray(schema.auditLog.propertyId, ids.length ? ids : [-1])))
    .orderBy(desc(schema.auditLog.at))
    .limit(60);

  return (
    <div className="anh-main">
      <PageHeader eyebrow="Workflow" title="Submissions" sub={`${v.name} · property managers submit each property when its inputs are complete; Finance approves, or returns it with a note. Revenue is the year's budget, ex VAT.`} />
      {!open && (
        <Banner kind="info" title={`${v.name} is locked`}>
          Statuses cannot change in a locked version.
        </Banner>
      )}
      <SubmissionsBoard rows={rows} versionId={v.id} finance={finance} open={open} />

      <section className="ui-section" aria-labelledby="activity-h">
        <h2 id="activity-h" className="ui-section__title">
          Recent activity
        </h2>
        <ActivityTable items={activity.map(({ a, user: who, property }) => ({ id: a.id, at: a.at.toISOString(), who, property, entity: a.entity, action: a.action, changes: a.changes }))} />
      </section>
    </div>
  );
}
