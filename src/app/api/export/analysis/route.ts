import { getCurrentUser, getActiveVersion } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { loadAnalysisData } from '@/lib/budget/analysis';
import { xlsxResponse, r2 } from '@/lib/export/xlsx';
import { MONTHS } from '@/lib/format';

const tot = (a: number[] | null) => (a ? a.reduce((x, y) => x + y, 0) : null);
const chg = (a: number, b: number | null) => (b === null ? [null, null] : [r2(a - b), b ? r2((a - b) / b) : null]);

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { version } = await getActiveVersion();
  if (!version) return new Response('No version', { status: 404 });
  // the export follows the page filters: their properties; with a category filter, only those units
  const scope = await filteredScope(user);
  const d = await loadAnalysisData(version, scope.propertyIds, new Set());
  if (scope.categories.length) d.units = d.units.filter((u) => scope.categories.includes(u.category));
  const { labels } = d;

  const byProp = d.properties
    .map((p) => {
      const us = d.units.filter((u) => u.propertyId === p.id);
      const budget = us.reduce((s, u) => s + (tot(u.budget) ?? 0), 0);
      const prior = d.priorSource ? us.reduce((s, u) => s + (tot(u.prior) ?? 0), 0) : p.comps[labels.prior];
      const vl = p.vacancyLossOverride ?? us.reduce((s, u) => s + u.vacancyLoss, 0);
      return { p, units: us.filter((u) => u.budget).length, budget, prior, vl };
    })
    .sort((a, b) => a.p.bu.localeCompare(b.p.bu) || b.budget - a.budget);

  const sheet1 = [
    ['BU', 'PM', 'Code', 'Property', 'Units', labels.budget, labels.forecast, 'Change', '%', labels.prior, 'Change', '%', ...labels.actuals, 'Vacancy loss', '% of B', 'Comments'],
    ...byProp.map(({ p, units, budget, prior, vl }) => [
      p.buName, p.pm, p.code, p.name, units, r2(budget),
      p.comps[labels.forecast], ...chg(budget, p.comps[labels.forecast]),
      r2(prior ?? null), ...chg(budget, prior ?? null),
      ...labels.actuals.map((l) => p.comps[l]),
      r2(vl), budget ? r2(vl / budget) : null, p.comment,
    ]),
  ];

  const propById = new Map(d.properties.map((p) => [p.id, p]));
  const sheet2 = [
    ['BU', 'PM', 'Category', 'Code', 'Property', 'Unit', 'Tenant', ...MONTHS.map((m) => `${labels.budget} ${m}`), labels.budget, labels.prior, 'Change', 'Vacancy loss'],
    ...d.units.map((u) => {
      const p = propById.get(u.propertyId)!;
      const b = tot(u.budget) ?? 0;
      const pr = tot(u.prior);
      return [p.buName, p.pm, u.category, p.code, p.name, u.unitCode, u.tenant, ...(u.budget ?? Array(12).fill(0)).map(r2), r2(b), r2(pr), pr === null ? null : r2(b - pr), r2(u.vacancyLoss)];
    }),
  ];

  return xlsxResponse(
    [
      { name: 'By property', rows: sheet1, cols: [8, 9, 10, 34, 7, 14, 14, 12, 7, 14, 12, 7, 14, 14, 12, 8, 60] },
      { name: 'By unit', rows: sheet2, cols: [8, 9, 12, 10, 30, 22, 30] },
    ],
    `Revenue Analysis ${version.year}.xlsx`,
  );
}
