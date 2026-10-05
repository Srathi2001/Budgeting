import { getCurrentUser, getActiveVersion, visibleProperties } from '@/lib/auth/dal';
import { loadMasterRows } from '@/lib/budget/master';
import { withDefaults } from '@/lib/engine/assumptions';
import { xlsxResponse, excelDate, r2 } from '@/lib/export/xlsx';
import { MONTHS } from '@/lib/format';

const yn = (b: boolean | null | undefined) => (b === true ? 'Y' : b === false ? 'N' : null);

// Column order of the consolidated revenue template (Consolidated Revenue Budget 2026_Template.xlsx),
// followed by the PM-template RERA working and the tool's budget inputs.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { version } = await getActiveVersion();
  if (!version) return new Response('No version', { status: 404 });
  const p = new URL(request.url).searchParams.get('p');
  const visible = await visibleProperties(user);
  const wanted = new Set((p && p !== 'all' ? p.split(',') : []).map(Number));
  const ids = wanted.size ? visible.filter((x) => wanted.has(x.id)).map((x) => x.id) : visible.map((x) => x.id);
  const rows = await loadMasterRows(version.id, { propertyIds: ids });
  const staffDiscount = withDefaults(version.assumptions).staffDiscount;
  const yy = String(version.year).slice(2);

  const header = [
    'Sl No', 'REFERENCE SHEET', 'BU', 'PROPERTY CODE', 'PROPERTY NAME', 'UNIT CODE', 'PC', 'Bedroom / Code', 'Area (sq.ft)',
    'Type (R/C)', 'MF (Y/N)', 'MERGED UNIT NUMBER', 'UNIT STATUS', 'UNIT TYPE', 'RESI/COMMERCIAL (As per Fusion)', 'Landlord',
    'LEASE NUMBER', 'VERSION', 'TENANT CODE', 'TENANT NAME', 'Customer Class', 'LEASE START', 'RENT START', 'LEASE END',
    'ACTUAL LEASE AMOUNT', 'VAT', 'SECURITY DEPOSIT', 'LEASE STATUS',
    '1ST RENEWAL START', '1ST RENEWAL END', '1ST RENEWAL AMOUNT',
    '2ND RENEWAL START', '2ND RENEWAL END', '2ND RENEWAL AMOUNT',
    '3RD RENEWAL START', '3RD RENEWAL END', '3RD RENEWAL AMOUNT',
    ...MONTHS.map((m) => `REV ${m.toUpperCase()}'${yy}`), 'REVENUE TOTAL',
    ...MONTHS.map((m) => `CASH ${m.toUpperCase()}'${yy}`), 'CASH TOTAL',
    'Vacant (Y/N)', 'STAFF/OWNER', 'Renew (Y/N)', 'Not re-let', 'Budget Rate', 'Cheques / yr',
    'RERA Index', 'RERA Low', 'RERA High', 'RERA Average', 'Old Rent psf', 'New Rent psf', '% Difference', 'Increase Allowed', 'Staff Discount',
    'Vacancy Loss', 'Issues', 'Lease Remarks', 'Notes',
  ];
  const psf = (rent: number | null | undefined, area: number | null) => (rent && area ? r2(rent / area) : null);
  const body = rows.map((r, i) => [
    i + 1, `Revenue Budget_${r.buName}`, r.buCode, r.propertyCode, r.propertyName, r.unitCode, r.coordinator, r.bedroom, r.area,
    r.rc, yn(r.mfCurrent), r.mergedUnitNumber, r.unitStatus, r.unitType, r.resiCommercial, r.landlord,
    r.leaseNumber, r.leaseVersion, r.tenantCode, r.tenant, r.customerClass, excelDate(r.currentStart), excelDate(r.rentStart), excelDate(r.currentEnd),
    r.currentRent, r.vatAmount, r.securityDeposit, r.leaseStatus,
    excelDate(r.r1?.start), excelDate(r.r1?.end), r2(r.r1?.rent),
    excelDate(r.r2?.start), excelDate(r.r2?.end), r2(r.r2?.rent),
    excelDate(r.r3?.start), excelDate(r.r3?.end), r2(r.r3?.rent),
    ...r.revenue.map(r2), r2(r.revenueTotal),
    ...r.cashFlow.map(r2), r2(r.cashFlowTotal),
    yn(r.vacant), r.staffOwner, yn(r.renew1), r.noRenewal ? 'Y' : null, r.budgetRate, r.cheques,
    `${r.propertyCode}-${r.bedroom ?? ''}`, r.reraMin, r.reraMax, r2(r.reraAverage), psf(r.currentRent, r.area), psf(r.r1?.rent, r.area),
    r.reraGap === null ? null : r2(r.reraGap), r.increasePct, r.staffOwner === 'STAFF' ? staffDiscount : 0,
    r2(r.vacancyLoss), r.warnings.join('; '), r.leaseRemarks, r.notes,
  ]);
  const name = `Lease Budget ${version.name}.xlsx`.replace(/[^\w .()-]/g, '');
  return xlsxResponse([{ name: 'Lease Budget', rows: [header, ...body], cols: [5, 18, 5, 10, 28, 20, 8, 8, 9, 6, 6, 18, 10, 14, 14, 12, 16, 6, 11, 30] }], name);
}
