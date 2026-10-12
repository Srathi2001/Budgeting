// The current-year forecast of rent (e.g. 2026F for the 2027 budget), one rule for every screen:
// - Jan to the cut-off month (the version's actualsCutoffMonth, 30 September for 2026): Oracle's
//   recognised rent (Revenue Recognition Summary), per property.
// - the months after it: the leases as they run. A lease running to December gives its own rent; a lease
//   ending in between is followed by what the property managers entered (renew, new tenant after the
//   vacancy days, not re-let). This is each line's `priorRevenue` from the lease engine. Oracle's own
//   forecast is not used.
// - a property without Oracle actuals (the PMC properties) is projected for the whole year, and marked.
// A month up to the cut-off with no actual for a property that has others is projected too, and listed.
// Pure: the database side is forecast.ts.

export interface ForecastLine {
  lineId: number;
  unitId: number;
  propertyId: number;
  /** the line's rent of the year as the leases run (the lease engine's priorRevenue) */
  projection: number[];
}

export interface PropertyForecast {
  propertyId: number;
  /** the forecast by month */
  months: number[];
  /** the Oracle actuals used, by month (0 where projected) */
  actual: number[];
  /** the projection used, by month (0 where actual) */
  projected: number[];
  /** false: no Oracle actuals for this property in the year (whole year projected) */
  hasActuals: boolean;
  /** months (1–12) up to the cut-off that had no actual and were projected */
  missing: number[];
}

const z12 = () => Array.from({ length: 12 }, () => 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * `actuals`: property → month (1–12) → amount, for the forecast year. Returns the forecast per
 * property and per line (actual months split over a property's lines by their projection, equally when
 * the projection is nil).
 */
export function buildForecast(lines: ForecastLine[], actuals: Map<number, Map<number, number>>, propertyIds: number[], cutoff: number) {
  const byProperty = new Map<number, ForecastLine[]>();
  for (const l of lines) byProperty.set(l.propertyId, [...(byProperty.get(l.propertyId) ?? []), l]);
  const properties = new Map<number, PropertyForecast>();
  const lineMonths = new Map<number, number[]>();
  // lines are not rounded (their sum is the property's figure, which is)
  for (const l of lines) lineMonths.set(l.lineId, [...l.projection]);

  for (const id of new Set([...propertyIds, ...byProperty.keys()])) {
    const ls = byProperty.get(id) ?? [];
    const act = actuals.get(id);
    const hasActuals = !!act && [...act.keys()].some((m) => m <= cutoff);
    const pf: PropertyForecast = { propertyId: id, months: z12(), actual: z12(), projected: z12(), hasActuals, missing: [] };
    for (let i = 0; i < 12; i++) {
      const proj = ls.reduce((s, l) => s + l.projection[i], 0);
      const a = act?.get(i + 1);
      if (hasActuals && i < cutoff && a !== undefined) {
        pf.actual[i] = r2(a);
        pf.months[i] = r2(a);
        // the property's actual over its lines, by their projection (equally where there is none)
        for (const l of ls) lineMonths.get(l.lineId)![i] = proj > 0 ? (a * l.projection[i]) / proj : a / ls.length;
      } else {
        if (hasActuals && i < cutoff) pf.missing.push(i + 1);
        pf.projected[i] = r2(proj);
        pf.months[i] = r2(proj);
      }
    }
    if (!ls.length && !hasActuals) continue;
    properties.set(id, pf);
  }
  return { properties, lines: lineMonths };
}
