// Server side of the shared page filters: the selection (cookie) and what can be filtered.
import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getSettings } from '@/lib/settings';
import { db, schema } from '@/db';
import { getActiveVersion, isFinance, visibleProperties, type CurrentUser } from '@/lib/auth/dal';
import { categoryOf, type Category } from './budget/category';
import { ENTITIES, entityOf, isMall } from './budget/group';
import { FILTER_COOKIE, parseFilters, propertyPasses, type FilterProperty, type Filters } from './filters';

export const getFilters = cache(async (): Promise<Filters> => parseFilters((await cookies()).get(FILTER_COOKIE)?.value));

/** The properties the user may see, with their BU, PM and unit categories (active version). */
export const filterUniverse = cache(async (user: CurrentUser): Promise<FilterProperty[]> => {
  await getSettings(); // the mappings (e.g. the Mall's codes) before any property is classified
  const props = await visibleProperties(user);
  const { version } = await getActiveVersion();
  const bus = new Map((await db.select().from(schema.businessUnits)).map((b) => [b.code, b.name]));
  const cats = new Map<number, Set<Category>>();
  if (version) {
    const rows = await db
      .select({ propertyId: schema.leaseLines.propertyId, pivotCategory: schema.units.pivotCategory, unitType: schema.units.unitType, rc: schema.units.rc })
      .from(schema.leaseLines)
      .innerJoin(schema.units, eq(schema.units.id, schema.leaseLines.unitId))
      .where(eq(schema.leaseLines.versionId, version.id));
    const kind = new Map(props.map((p) => [p.id, p.kind]));
    for (const r of rows) {
      const k = kind.get(r.propertyId);
      if (!k) continue;
      const s = cats.get(r.propertyId) ?? new Set<Category>();
      s.add(categoryOf(r, k));
      cats.set(r.propertyId, s);
    }
  }
  return props.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    // the business unit filter works by entity, as the budget's columns: the Mall apart from REHL-MJN
    bu: entityOf(p.buCode, p.code),
    buName: isMall(p.code) ? 'Mall' : (bus.get(p.buCode) ?? p.buCode),
    pm: p.coordinator ?? '—',
    categories: [...(cats.get(p.id) ?? [])],
  }));
});

/**
 * The business units the filter offers. Finance: every entity, also those without properties (ANPM 521
 * and the companies outside the group), in the budget's order; others: the ones of their properties.
 */
export const filterBusinessUnits = cache(async (user: CurrentUser): Promise<{ code: string; name: string }[]> => {
  const universe = await filterUniverse(user);
  if (!isFinance(user)) return [...new Map(universe.map((p) => [p.bu, p.buName])).entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, name]) => ({ code, name }));
  const names = new Map((await db.select().from(schema.businessUnits)).map((b) => [b.code, b.name]));
  const order: string[] = ENTITIES.map((e) => e.key);
  const codes = [...new Set([...order.filter((k) => k === 'MALL' || names.has(k)), ...names.keys()])];
  return codes.map((code) => ({ code, name: code === 'MALL' ? 'Mall' : (names.get(code) ?? code) }));
});

/** Property ids that pass the user's filters, and the category filter (for unit-level totals). */
export async function filteredScope(user: CurrentUser) {
  await getSettings(); // the mappings (e.g. the Mall's codes) before any property is classified
  const [universe, filters] = await Promise.all([filterUniverse(user), getFilters()]);
  return { filters, propertyIds: universe.filter((p) => propertyPasses(p, filters)).map((p) => p.id), categories: filters.cat };
}
