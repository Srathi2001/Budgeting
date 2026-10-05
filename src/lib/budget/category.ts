// Reporting category for a unit: Residential, Commercial, Retail, Warehouse, Camps, Mall.

export const CATEGORIES = ['Residential', 'Commercial', 'Retail', 'Warehouse', 'Camps', 'Mall'] as const;
export type Category = (typeof CATEGORIES)[number];

export function categoryOf(
  unit: { pivotCategory: string | null; unitType: string | null; rc: string },
  propertyKind: 'BUILDING' | 'CAMP' | 'MALL',
): Category {
  if (propertyKind === 'CAMP') return 'Camps';
  if (propertyKind === 'MALL') return 'Mall';
  const s = `${unit.pivotCategory ?? ''} ${unit.unitType ?? ''}`.toUpperCase();
  if (/WAREHOUSE|SHED/.test(s)) return 'Warehouse';
  if (/RETAIL|SHOP|SHOWROOM/.test(s)) return 'Retail';
  if (/APARTMENT|RESIDENTIAL|VILLA|STUDIO/.test(s) && unit.rc !== 'C') return 'Residential';
  if (/^\s*APARTMENTS?\b/.test(unit.pivotCategory?.toUpperCase() ?? '')) return 'Residential';
  if (unit.rc === 'R') return 'Residential';
  if (unit.rc === 'L') return 'Camps';
  return 'Commercial';
}
