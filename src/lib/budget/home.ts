import 'server-only';
// The Home page: what needs attention in the active version, for the person signed in.
// Finance sees the whole version (revenue and FM approvals, open warnings, recent activity);
// a property manager sees their properties; facilities management sees their facilities.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { isFinance, isFm, visibleProperties, type Actor } from '@/lib/auth/permissions';
import { propertyRollups, type PropertyRollup } from './reports';

export type SubStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED';
export const SUB_STATUSES: SubStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED'];

export interface HomeProperty {
  id: number;
  code: string;
  name: string;
  buName: string;
  coordinator: string | null;
  units: number;
  vacantUnits: number;
  warnings: number;
  /** budget revenue for the year, ex VAT */
  revenue: number;
  status: SubStatus;
  note: string | null;
  updatedAt: string | null;
}

export interface HomeFacility {
  id: number;
  code: string;
  name: string;
  buName: string;
  status: SubStatus;
  note: string | null;
  updatedAt: string | null;
  /** FM budget total for the year */
  total: number;
  lines: number;
}

export interface HomeActivity {
  id: number;
  at: string;
  who: string | null;
  property: string | null;
  entity: string;
  action: string;
}

export interface HomeData {
  version: { id: number; name: string; year: number; status: string };
  role: 'finance' | 'pm' | 'fm';
  /** revenue submissions (not for FM) */
  properties: HomeProperty[];
  /** FM submissions (Finance and FM) */
  facilities: HomeFacility[];
  activity: HomeActivity[];
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function loadHome(user: Actor, version: schema.BudgetVersion): Promise<HomeData> {
  const role = isFinance(user) ? 'finance' : isFm(user) ? 'fm' : 'pm';
  const visible = await visibleProperties(user);
  const ids = visible.map((p) => p.id);

  let properties: HomeProperty[] = [];
  if (role !== 'fm' && ids.length) {
    const rolls: PropertyRollup[] = await propertyRollups(version.id, ids);
    const subs = await db.select().from(schema.submissions).where(eq(schema.submissions.versionId, version.id));
    const byId = new Map(subs.map((s) => [s.propertyId, s]));
    properties = rolls.map((r) => ({
      id: r.propertyId,
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
      updatedAt: iso(byId.get(r.propertyId)?.updatedAt),
    }));
  }

  let facilities: HomeFacility[] = [];
  if (role !== 'pm' && ids.length) {
    const [subs, lines] = await Promise.all([
      db.select().from(schema.fmSubmissions).where(eq(schema.fmSubmissions.versionId, version.id)),
      db
        .select({ propertyId: schema.fmLines.propertyId, amount: schema.fmLines.amount })
        .from(schema.fmLines)
        .where(and(eq(schema.fmLines.versionId, version.id), inArray(schema.fmLines.propertyId, ids))),
    ]);
    const totals = new Map<number, { total: number; lines: number }>();
    for (const l of lines) {
      const t = totals.get(l.propertyId) ?? { total: 0, lines: 0 };
      t.total += Number(l.amount ?? 0);
      t.lines += 1;
      totals.set(l.propertyId, t);
    }
    const bus = new Map((await db.select().from(schema.businessUnits)).map((b) => [b.code, b.name]));
    const byId = new Map(subs.map((s) => [s.propertyId, s]));
    facilities = visible
      .filter((p) => totals.has(p.id) || byId.has(p.id) || role === 'fm')
      .map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        buName: bus.get(p.buCode) ?? p.buCode,
        status: (byId.get(p.id)?.status ?? 'DRAFT') as SubStatus,
        note: byId.get(p.id)?.note ?? null,
        updatedAt: iso(byId.get(p.id)?.updatedAt),
        total: totals.get(p.id)?.total ?? 0,
        lines: totals.get(p.id)?.lines ?? 0,
      }));
  }

  const rows = await db
    .select({ a: schema.auditLog, user: schema.users.name, property: schema.properties.name })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
    .leftJoin(schema.properties, eq(schema.properties.id, schema.auditLog.propertyId))
    .where(and(eq(schema.auditLog.versionId, version.id), inArray(schema.auditLog.propertyId, ids.length ? ids : [-1])))
    .orderBy(desc(schema.auditLog.at))
    .limit(8);
  const activity: HomeActivity[] = rows.map(({ a, user: who, property }) => ({ id: a.id, at: a.at.toISOString(), who, property, entity: a.entity, action: a.action }));

  return { version: { id: version.id, name: version.name, year: version.year, status: version.status }, role, properties, facilities, activity };
}
