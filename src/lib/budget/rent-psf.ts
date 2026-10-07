// Rent per sq ft for the Dashboard: passing rent (current contract, annualised) ÷ let sq ft,
// area-weighted (sum of rent ÷ sum of area, never an average of unit rates). Leased lines with an
// area and a passing rent only; camps are left out (priced per bed).
//
// Every line falls in one use group. Whole-building leases (every line of a property whose leased
// lines share one lease number, plus three named single-deal properties) are kept apart so their
// negotiated rates don't distort the use averages; the rest go by category.
import { unitPasses, type Filters } from '@/lib/filters';
import type { Category } from './category';

export type UseGroup = 'retail' | 'office' | 'residential' | 'warehouse' | 'whole';

/** display order */
export const USE_GROUPS: { key: UseGroup; label: string }[] = [
  { key: 'retail', label: 'Retail & showroom' },
  { key: 'office', label: 'Office & commercial' },
  { key: 'residential', label: 'Residential' },
  { key: 'warehouse', label: 'Warehouses & sheds' },
  { key: 'whole', label: 'Whole-building leases' },
];

/** single negotiated deals, always counted as whole-building leases */
const WHOLE_BUILDING_NAMES = ['MIRDIFF SHOPPING MALL', 'MJN AL WARQAA SCHOOL', 'AL RAFA BUILDING (PLAZA 2)'];

const GROUP_OF: Record<Category, UseGroup | null> = {
  Retail: 'retail',
  Commercial: 'office',
  Residential: 'residential',
  Warehouse: 'warehouse',
  Mall: 'retail',
  Camps: null,
};

/** A budget line as the rent psf card needs it. */
export interface PsfLine {
  propertyId: number;
  propertyName: string;
  buCode: string;
  pm: string;
  category: Category;
  /** sq ft (0 when unknown) */
  area: number;
  /** current contract rent, annualised (0 without a current lease) */
  passing: number;
  leaseNumber: string | null;
  /** Oracle unit type (RESI/COMMERCIAL as per Fusion) */
  unitType: string;
  location: string;
}

export interface PsfStat {
  psf: number;
  /** let sq ft */
  area: number;
  units: number;
}

export interface RentPsf {
  total: PsfStat | null;
  groups: { key: UseGroup; label: string; stat: PsfStat; buildings: ({ id: number; name: string } & PsfStat)[] }[];
  unitTypes: ({ label: string } & PsfStat)[];
  locations: ({ label: string } & PsfStat)[];
}

type Acc = { rent: number; area: number; units: number };
const add = (m: Map<string, Acc>, k: string, l: PsfLine) => {
  const a = m.get(k) ?? { rent: 0, area: 0, units: 0 };
  a.rent += l.passing;
  a.area += l.area;
  a.units++;
  m.set(k, a);
};
const stat = (a: Acc): PsfStat => ({ psf: a.area > 0 ? a.rent / a.area : 0, area: a.area, units: a.units });
const byPsf = <T extends PsfStat>(a: T, b: T) => b.psf - a.psf;

export function buildRentPsf(lines: PsfLine[], filters: Filters): RentPsf {
  // whole-building properties, from all lines (before filters): all leased lines on one lease
  const leases = new Map<number, Set<string>>();
  const named = new Set<number>();
  for (const l of lines) {
    if (l.leaseNumber) leases.set(l.propertyId, (leases.get(l.propertyId) ?? new Set()).add(l.leaseNumber));
    if (WHOLE_BUILDING_NAMES.includes(l.propertyName.trim().toUpperCase())) named.add(l.propertyId);
  }
  const whole = (id: number) => named.has(id) || leases.get(id)?.size === 1;

  const inView = lines.filter(
    (l) => l.passing > 0 && l.area > 0 && l.category !== 'Camps' && unitPasses({ bu: l.buCode, pm: l.pm, propertyId: l.propertyId, category: l.category }, filters),
  );

  const all: Acc = { rent: 0, area: 0, units: 0 };
  const groups = new Map<UseGroup, { acc: Map<string, Acc>; buildings: Map<string, Acc>; names: Map<string, string> }>();
  const types = new Map<string, Acc>();
  const locations = new Map<string, Acc>();
  for (const l of inView) {
    const g = whole(l.propertyId) ? 'whole' : GROUP_OF[l.category];
    if (!g) continue;
    all.rent += l.passing;
    all.area += l.area;
    all.units++;
    const e = groups.get(g) ?? { acc: new Map(), buildings: new Map(), names: new Map() };
    add(e.acc, 'all', l);
    add(e.buildings, String(l.propertyId), l);
    e.names.set(String(l.propertyId), l.propertyName);
    groups.set(g, e);
    add(types, l.unitType || '—', l);
    add(locations, l.location, l);
  }

  return {
    total: all.units ? stat(all) : null,
    groups: USE_GROUPS.filter((g) => groups.has(g.key)).map((g) => {
      const e = groups.get(g.key)!;
      return {
        key: g.key,
        label: g.label,
        stat: stat(e.acc.get('all')!),
        buildings: [...e.buildings].map(([id, a]) => ({ id: Number(id), name: e.names.get(id)!, ...stat(a) })).sort(byPsf),
      };
    }),
    // the 12 types with the most let area, then those with at least 3 units
    unitTypes: [...types]
      .map(([label, a]) => ({ label, ...stat(a) }))
      .sort((a, b) => b.area - a.area)
      .slice(0, 12)
      .filter((t) => t.units >= 3)
      .sort(byPsf),
    locations: [...locations].map(([label, a]) => ({ label, ...stat(a) })).sort(byPsf),
  };
}
