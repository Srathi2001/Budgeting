import { getCurrentUser, getActiveVersion } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { propertyRollups, cashFlow } from '@/lib/budget/reports';
import { xlsxResponse, r2 } from '@/lib/export/xlsx';
import { MONTHS, sum } from '@/lib/format';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { version } = await getActiveVersion();
  if (!version) return new Response('No version', { status: 404 });
  // the export follows the page filters (BU, PM, category, property)
  const scope = await filteredScope(user);
  const rolls = await propertyRollups(version.id, scope.propertyIds, scope.categories);

  const pnl = [
    ['S.N.', 'BU', 'Units', 'CODE', 'PROPERTY NAME', 'Rental revenue', 'Total expenses', 'Gross profit', 'Cash inflow'],
    ...rolls.map((r, i) => {
      const rent = sum(r.revenue);
      return [i + 1, r.buName, r.kind === 'CAMP' ? 'Camps' : r.units, r.code, r.name, r2(rent), null, r2(rent), r2(sum(cashFlow(r)))];
    }),
  ];
  const monthly = (get: (r: (typeof rolls)[number]) => number[]) => [
    ['CODE', 'PROPERTY NAME', ...MONTHS.map((m) => `${m}-${String(version.year).slice(2)}`), 'Total'],
    ...rolls.map((r) => [r.code, r.name, ...get(r).map(r2), r2(sum(get(r)))]),
  ];
  return xlsxResponse(
    [
      { name: 'Building P&L', rows: pnl, cols: [5, 7, 7, 10, 34] },
      { name: 'Revenue by month', rows: monthly((r) => r.revenue), cols: [10, 34] },
      { name: 'Cash inflow by month', rows: monthly(cashFlow), cols: [10, 34] },
    ],
    `Building PnL ${version.year}.xlsx`,
  );
}
