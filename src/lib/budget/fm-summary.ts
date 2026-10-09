// FM Budget summary: what facilities management entered, for Finance to check once it is in. The
// facilities with their works and staff against last year's budget and actuals, the works by type, kind
// and business need, the phasing, the largest lines and the points worth a second look.
import 'server-only';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { CurrentUser } from '@/lib/auth/dal';
import { loadFmBudget } from './fm';
import { loadFmPage, type FmFacilityRow, type FmStaffRow } from './fm-page';
import { BUSINESS_NEEDS, FM_KINDS, WORK_TYPE, WORK_TYPES, elementLabel, isWorkType } from './fm-types';

export interface FmSummary {
  versionName: string;
  year: number;
  priorLabel: string | null;
  actualLabel: string;
  facilities: FmFacilityRow[];
  workTypes: { code: string; label: string; prior: number | null; actual: number; budget: number }[];
  kinds: { label: string; amount: number; lines: number }[];
  needs: { label: string; amount: number; lines: number }[];
  /** the facilities in view, by month */
  months: { maintenance: number[]; repairs: number[]; capexItems: number[]; fmStaff: number[] };
  staff: FmStaffRow[];
  unallocated: number;
  largest: { facilityId: number; facility: string; workType: string; element: string; description: string; kind: string; need: string; amount: number }[];
  /** major repairs, refurbishment and capex items with no month: spread over the year */
  noMonth: { facilityId: number; facility: string; workType: string; amount: number }[];
}

const z12 = () => Array.from({ length: 12 }, () => 0);

export async function loadFmSummary(version: schema.BudgetVersion, user: CurrentUser, propertyIds: number[]): Promise<FmSummary> {
  const page = await loadFmPage(version, user, propertyIds, null);
  const ids = page.facilities.map((f) => f.id);
  const name = new Map(page.facilities.map((f) => [f.id, `${f.code} ${f.name}`]));
  const [prior] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.year, version.year - 1)).orderBy(desc(schema.budgetVersions.id)).limit(1);
  const [cur, prev, actuals, lines] = await Promise.all([
    loadFmBudget(version.id),
    prior ? loadFmBudget(prior.id) : null,
    ids.length
      ? db
          .select()
          .from(schema.fmActuals)
          .where(and(inArray(schema.fmActuals.propertyId, ids), gte(schema.fmActuals.month, `${version.year - 1}-01`), lte(schema.fmActuals.month, `${version.year - 1}-12`)))
      : Promise.resolve([]),
    ids.length ? db.select().from(schema.fmLines).where(and(eq(schema.fmLines.versionId, version.id), inArray(schema.fmLines.propertyId, ids))) : Promise.resolve([]),
  ]);

  const workTypes = WORK_TYPES.map((w) => ({
    code: w.code,
    label: w.label,
    prior: prev ? ids.reduce((s, id) => s + (prev.result.byProperty.get(id)?.works[w.code] ?? 0), 0) : null,
    actual: actuals.filter((a) => a.workType === w.code).reduce((s, a) => s + a.amount, 0),
    budget: ids.reduce((s, id) => s + (cur.result.byProperty.get(id)?.works[w.code] ?? 0), 0),
  }));
  const months = { maintenance: z12(), repairs: z12(), capexItems: z12(), fmStaff: z12() };
  for (const id of ids) {
    const m = cur.result.byProperty.get(id)?.monthly;
    if (!m) continue;
    for (const k of Object.keys(months) as (keyof typeof months)[]) m[k].forEach((v, i) => (months[k][i] += v));
  }
  const by = <K extends string>(keys: readonly K[], of: (l: (typeof lines)[number]) => string | null, label: (k: K) => string) => [
    ...keys.map((k) => {
      const ls = lines.filter((l) => of(l) === k);
      return { label: label(k), amount: ls.reduce((s, l) => s + l.amount, 0), lines: ls.length };
    }),
    ...(lines.some((l) => !keys.includes(of(l) as K)) ? [{ label: 'Not given', amount: lines.filter((l) => !keys.includes(of(l) as K)).reduce((s, l) => s + l.amount, 0), lines: lines.filter((l) => !keys.includes(of(l) as K)).length }] : []),
  ];

  return {
    versionName: version.name,
    year: version.year,
    priorLabel: page.priorLabel,
    actualLabel: page.actualLabel,
    facilities: page.facilities,
    workTypes,
    kinds: by(
      FM_KINDS.map((k) => k.code),
      (l) => l.kind,
      (k) => FM_KINDS.find((x) => x.code === k)!.label,
    ),
    needs: by(BUSINESS_NEEDS, (l) => l.businessNeed, (k) => k),
    months,
    staff: page.staff,
    unallocated: page.unallocated,
    largest: [...lines]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15)
      .map((l) => ({
        facilityId: l.propertyId,
        facility: name.get(l.propertyId) ?? String(l.propertyId),
        workType: `${l.workType} ${WORK_TYPE.get(l.workType as never)?.label ?? ''}`.trim(),
        element: `${l.element} ${elementLabel(l.element)}`,
        description: l.description ?? l.subElement ?? '',
        kind: FM_KINDS.find((k) => k.code === l.kind)?.label ?? l.kind,
        need: l.businessNeed ?? '',
        amount: l.amount,
      })),
    noMonth: lines
      .filter((l) => isWorkType(l.workType) && !WORK_TYPE.get(l.workType)!.spread && l.month === null)
      .map((l) => ({ facilityId: l.propertyId, facility: name.get(l.propertyId) ?? String(l.propertyId), workType: l.workType, amount: l.amount })),
  };
}
