// Data behind Revenue Analysis: unit-level monthly budget (current + prior budget version) and
// property-level comparatives (forecast, actuals), for roll-up / drill-down in any order.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { StoredCalc } from './calc';
import { categoryOf, type Category } from './category';

export interface AnalysisUnit {
  key: string; // unit id
  unitCode: string;
  tenant: string | null;
  propertyId: number;
  category: Category;
  vacant: boolean;
  /** monthly revenue, current budget (null when the unit is not in this budget) */
  budget: number[] | null;
  /** monthly revenue, prior-year budget version (null when not in it) */
  prior: number[] | null;
  vacancyLoss: number;
}

export interface AnalysisProperty {
  id: number;
  code: string;
  name: string;
  bu: string;
  buName: string;
  pm: string;
  kind: 'BUILDING' | 'CAMP' | 'MALL';
  /** property-level comparatives by label (forecast and actuals) */
  comps: Record<string, number | null>;
  comment: string | null;
  vacancyLossOverride: number | null;
  canComment: boolean;
}

export interface AnalysisData {
  year: number;
  labels: { budget: string; forecast: string; prior: string; actuals: string[] };
  /** where the prior-year budget comes from */
  priorSource: { versionId: number; name: string } | null;
  units: AnalysisUnit[];
  properties: AnalysisProperty[];
}

const z12 = () => Array(12).fill(0) as number[];

export async function loadAnalysisData(
  version: schema.BudgetVersion,
  propertyIds: number[],
  commentable: Set<number>,
): Promise<AnalysisData> {
  const y = version.year;
  const labels = { budget: `${y}B`, forecast: `${y - 1}F`, prior: `${y - 1}B`, actuals: [`${y - 2}A`, `${y - 3}A`] };
  const ids = propertyIds.length ? propertyIds : [-1];

  // prior-year budget: the version this one was rolled from, else the latest version of last year
  let [priorV] = version.sourceVersionId
    ? await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, version.sourceVersionId))
    : [];
  if (!priorV || priorV.year !== y - 1) {
    [priorV] = await db
      .select()
      .from(schema.budgetVersions)
      .where(eq(schema.budgetVersions.year, y - 1))
      .orderBy(desc(schema.budgetVersions.status), desc(schema.budgetVersions.id))
      .limit(1);
  }

  const props = await db
    .select({ p: schema.properties, buName: schema.businessUnits.name })
    .from(schema.properties)
    .innerJoin(schema.businessUnits, eq(schema.businessUnits.code, schema.properties.buCode))
    .where(inArray(schema.properties.id, ids));
  const kindOf = new Map(props.map(({ p }) => [p.id, p.kind]));

  const loadLines = async (versionId: number) =>
    db
      .select({ l: schema.leaseLines, u: schema.units })
      .from(schema.leaseLines)
      .innerJoin(schema.units, eq(schema.units.id, schema.leaseLines.unitId))
      .where(and(eq(schema.leaseLines.versionId, versionId), inArray(schema.leaseLines.propertyId, ids)));

  const units = new Map<number, AnalysisUnit>();
  const touch = (u: schema.Unit, propertyId: number, tenant: string | null) => {
    let a = units.get(u.id);
    if (!a) {
      a = {
        key: String(u.id),
        unitCode: u.unitCode,
        tenant,
        propertyId,
        category: categoryOf(u, kindOf.get(propertyId) ?? 'BUILDING'),
        vacant: false,
        budget: null,
        prior: null,
        vacancyLoss: 0,
      };
      units.set(u.id, a);
    }
    return a;
  };
  for (const { l, u } of await loadLines(version.id)) {
    const calc = l.calc as StoredCalc | null;
    const a = touch(u, l.propertyId, l.tenant);
    a.tenant = l.tenant;
    a.vacant = l.vacant;
    a.budget = calc?.revenue ?? z12();
    a.vacancyLoss = calc?.vacancyLoss ?? 0;
  }
  if (priorV) {
    for (const { l, u } of await loadLines(priorV.id)) {
      const calc = l.calc as StoredCalc | null;
      touch(u, l.propertyId, l.tenant).prior = calc?.revenue ?? z12();
    }
  }

  const wanted = [labels.forecast, ...labels.actuals, ...(priorV ? [] : [labels.prior])];
  const comps = await db
    .select()
    .from(schema.comparatives)
    .where(and(eq(schema.comparatives.versionId, version.id), inArray(schema.comparatives.label, wanted), inArray(schema.comparatives.propertyId, ids)));
  const notes = await db.select().from(schema.propertyNotes).where(eq(schema.propertyNotes.versionId, version.id));

  // with no prior version in the tool, the prior budget is a property-level comparative
  if (!priorV) for (const a of units.values()) a.prior = null;

  return {
    year: y,
    labels,
    priorSource: priorV ? { versionId: priorV.id, name: priorV.name } : null,
    units: [...units.values()].sort((a, b) => a.unitCode.localeCompare(b.unitCode)),
    properties: props.map(({ p, buName }) => {
      const n = notes.find((x) => x.propertyId === p.id);
      const c: Record<string, number | null> = {};
      for (const l of wanted) c[l] = comps.find((x) => x.propertyId === p.id && x.label === l)?.amount ?? null;
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        bu: p.buCode,
        buName,
        pm: p.coordinator ?? '—',
        kind: p.kind,
        comps: c,
        comment: n?.comment ?? null,
        vacancyLossOverride: n?.vacancyLossOverride ?? null,
        canComment: commentable.has(p.id),
      };
    }),
  };
}
