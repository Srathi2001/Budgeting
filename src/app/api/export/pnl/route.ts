import { getCurrentUser, getActiveVersion, visibleProperties } from '@/lib/auth/dal';
import { propertyRollups, autoOtherTotal } from '@/lib/budget/reports';
import { xlsxResponse, r2 } from '@/lib/export/xlsx';
import { MONTHS, sum } from '@/lib/format';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { version } = await getActiveVersion();
  if (!version) return new Response('No version', { status: 404 });
  const rolls = await propertyRollups(version.id, (await visibleProperties(user)).map((p) => p.id));

  const pnl = [
    ['S.N.', 'BU', 'Units', 'CODE', 'PROPERTY NAME', 'Rental revenue', 'Other income', 'Total revenue', 'Total expenses', 'Gross profit'],
    ...rolls.map((r, i) => {
      const rent = sum(r.revenue);
      const other = sum(autoOtherTotal(r)) + sum(r.manualOther);
      return [i + 1, r.buName, r.kind === 'CAMP' ? 'Camps' : r.units, r.code, r.name, r2(rent), r2(other), r2(rent + other), null, r2(rent + other)];
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
      { name: 'Cash by month', rows: monthly((r) => r.cash), cols: [10, 34] },
      { name: 'Other income by month', rows: monthly((r) => autoOtherTotal(r).map((v, i) => v + r.manualOther[i])), cols: [10, 34] },
    ],
    `Building PnL ${version.year}.xlsx`,
  );
}
