// Monthly Summary to Excel: every view as a sheet, for the page filters (same figures as the page).
import { getCurrentUser, getActiveVersion } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { propertyRollups, cashFlow, type PropertyRollup } from '@/lib/budget/reports';
import { CONSOLIDATION_COLUMNS, cashStatement, groupPnl, incomeStatement, summaryData, type StatementLine } from '@/lib/budget/summary';
import { xlsxResponse, r2 } from '@/lib/export/xlsx';
import { MONTHS, sum } from '@/lib/format';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { version } = await getActiveVersion();
  if (!version) return new Response('No version', { status: 404 });
  const scope = await filteredScope(user);
  const rolls = await propertyRollups(version.id, scope.propertyIds, scope.categories);
  const { atoms, expenses } = await summaryData(version.id, user, scope, rolls);
  const months = MONTHS.map((m) => `${m}-${String(version.year).slice(2)}`);

  const statement = (head: string, lines: StatementLine[]) => [
    [head, 'Account', ...months, 'Total'],
    ...lines.map((l) =>
      l.kind === 'group' ? [l.label] : [l.kind === 'item' ? `   ${l.label}` : l.label, l.code ?? null, ...(l.vals ? l.vals.map(r2) : months.map(() => null)), l.vals && !l.noTotal ? r2(sum(l.vals)) : null],
    ),
  ];

  const pnl = groupPnl(atoms, expenses);
  const group = [
    ['Line', 'Account', ...pnl.inside.map((e) => e.label), ...CONSOLIDATION_COLUMNS, ...pnl.outside.map((e) => `${e.label} (outside the group)`)],
    ...pnl.rows.map((r) => (r.kind === 'group' ? [r.label] : [r.kind === 'item' ? `   ${r.label}` : r.label, r.code ?? null, ...r.vals.map(r2)])),
  ];

  const byProperty = (get: (r: PropertyRollup) => number[]) => [
    ['BU', 'Code', 'Property', ...months, 'Total'],
    ...rolls.map((r) => [r.buName, r.code, r.name, ...get(r).map(r2), r2(sum(get(r)))]),
    ['Total', null, null, ...months.map((_, i) => r2(sum(rolls.map((r) => get(r)[i])))), r2(sum(rolls.map((r) => sum(get(r)))))],
  ];

  return xlsxResponse(
    [
      { name: 'Income & expenses', rows: statement('Income & expenses', incomeStatement(atoms, expenses)), cols: [44, 9] },
      { name: 'Cash flow', rows: statement('Cash flow', cashStatement(atoms, expenses)), cols: [44, 9] },
      { name: 'Group P&L', rows: group, cols: [44, 9, ...Array(pnl.inside.length + CONSOLIDATION_COLUMNS.length + pnl.outside.length).fill(15)] },
      { name: 'Rent by property', rows: byProperty((r) => r.revenue), cols: [8, 10, 34] },
      { name: 'Rent cash by property', rows: byProperty(cashFlow), cols: [8, 10, 34] },
    ],
    `Monthly Summary ${version.year}.xlsx`,
  );
}
