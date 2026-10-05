import { getCurrentUser, getActiveVersion, visibleProperties } from '@/lib/auth/dal';
import { loadMasterRows } from '@/lib/budget/master';
import { xlsxResponse, excelDate, r2 } from '@/lib/export/xlsx';
import { MONTHS } from '@/lib/format';

const yn = (b: boolean | null | undefined) => (b === true ? 'Y' : b === false ? 'N' : '-');

// Same column layout as the "Revenue Master" sheet of the finance workbook (A..BF),
// followed by the tool's extra inputs, so rows can be pasted straight across.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { version } = await getActiveVersion();
  if (!version) return new Response('No version', { status: 404 });
  const p = new URL(request.url).searchParams.get('p');
  const visible = await visibleProperties(user);
  const ids = p && p !== 'all' ? visible.filter((x) => x.id === Number(p)).map((x) => x.id) : visible.map((x) => x.id);
  const rows = await loadMasterRows(version.id, { propertyIds: ids });

  const header1: unknown[] = Array(59).fill(null);
  header1[14] = 'Current Contract';
  header1[18] = `1st Renewal ${version.year - 1}/${version.year}`;
  header1[25] = `2nd Renewal ${version.year}/${version.year + 1}`;
  header1[31] = 'REVENUE';
  header1[45] = 'CASH';
  header1[59] = 'TOOL INPUTS';
  const header2 = [
    'Sr', 'BU', 'PC', 'Property', 'Property Code', 'Unit Code', 'Tenant', 'BR', 'SQF', 'R/C', 'Pivot Category', 'Unit Type',
    'Vacant -Y/N', 'STAFF/OWNER', 'MF (Y/N)', 'Rent', 'Start', 'End', 'Renew (Y/N)', 'MF (Y/N)', 'Rent', '', '', 'Start', 'End',
    'Renew (Y/N)', 'MF (Y/N)', 'Rent', 'Start', 'End', '',
    ...MONTHS, 'REVENUE TOTAL', '',
    ...MONTHS, 'CASH TOTAL', '',
    'Not re-let', 'Budget rate', 'Increase %', 'Cheques', 'Rooms', 'Capacity', 'Vacancy loss', 'Fees', 'Warnings', 'Notes',
  ];
  const body = rows.map((r, i) => [
    i + 1, r.buCode, r.coordinator, r.propertyName, r.propertyCode, r.unitCode, r.tenant, r.bedroom, r.area, r.rc,
    r.pivotCategory, r.unitType, r.vacant ? 'Y' : 'N', r.staffOwner ?? 0, yn(r.mfCurrent),
    r.currentRent, excelDate(r.currentStart), excelDate(r.currentEnd),
    r.r1 ? (r.renew1 ? 'Y' : 'N') : '-', r.r1 ? yn(r.r1.mf) : null, r2(r.r1?.rent), null, null,
    excelDate(r.r1?.start), excelDate(r.r1?.end),
    r.r2 ? 'Y' : null, r.r2 ? yn(r.r2.mf) : null, r2(r.r2?.rent), excelDate(r.r2?.start), excelDate(r.r2?.end), null,
    ...r.revenue.map(r2), r2(r.revenueTotal), null,
    ...r.cash.map(r2), r2(r.cashTotal), r2(r.cashTotal - r.revenueTotal),
    r.noRenewal ? 'Y' : '', r.budgetRate, r.increasePct === null ? null : r2(r.increasePct * 100), r.cheques,
    r.rooms, r.capacity, r2(r.vacancyLoss), r2(r.otherIncomeTotal), r.warnings.join('; '), r.notes,
  ]);
  const name = `Lease Budget ${version.name}.xlsx`.replace(/[^\w .()-]/g, '');
  return xlsxResponse([{ name: 'Revenue Master', rows: [header1, header2, ...body], cols: [5, 5, 8, 28, 10, 20, 30] }], name);
}
