// Other Income to Excel, for the page filters: every row × account with its actuals, forecast and
// budget, and the by-account totals with the group adjustments (as on the tab).
import { withDefaults } from '@/lib/engine/assumptions';
import { getCurrentUser, getActiveVersion, visibleProperties } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { loadOtherIncome } from '@/lib/budget/other-income';
import { OI_ACCOUNTS, OI_COLUMNS, oiCell, oiLabel, type OiBlock } from '@/lib/budget/other-income-types';
import { GROUP_NAME, classifyOtherIncome, type GroupClass } from '@/lib/budget/group';
import { xlsxResponse, r2 } from '@/lib/export/xlsx';

const CLASS_LABEL: Record<GroupClass, string> = { group: 'Group', owners: "Owners' share", intergroup: 'Intergroup', outside: 'Outside the group' };
const ADJUSTMENTS: { cls: GroupClass; label: string }[] = [
  { cls: 'outside', label: 'Outside the group · MJNH, MJN Private Office' },
  { cls: 'owners', label: "Owners' share · PMC properties" },
  { cls: 'intergroup', label: 'Intergroup eliminated · PMA fee' },
];

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { version } = await getActiveVersion();
  if (!version) return new Response('No version', { status: 404 });
  const scope = await filteredScope(user);
  const f = scope.filters;
  const ids = new Set(scope.propertyIds);
  const blocks = (await loadOtherIncome(version, user, await visibleProperties(user), new Set())).filter((b) =>
    // as on the tab: property rows follow every filter, a General row only the business unit one
    b.kind === 'P' ? ids.has(b.propertyId!) : (!f.bu.length || f.bu.includes(b.buCode)) && !f.pm.length && !f.cat.length && !f.prop.length,
  );
  const cutoff = withDefaults(version.assumptions).actualsCutoffMonth;
  const heads = OI_COLUMNS.map((c) => oiLabel(c, version.year, cutoff));
  const hasData = (b: OiBlock, a: string) => OI_COLUMNS.some((c) => oiCell(b, a, c) !== null);

  const detail = [
    ['BU', 'Business unit', 'Code', 'Property', 'PM', 'Account', 'Account name', 'Side', 'Group', ...heads],
    ...blocks.flatMap((b) =>
      OI_ACCOUNTS.filter((a) => hasData(b, a.code)).map((a) => [
        b.buCode,
        b.buName,
        b.code,
        b.name,
        b.pm,
        a.code,
        a.name,
        a.side === 'LL' ? 'Landlord' : (a.side ?? ''),
        CLASS_LABEL[classifyOtherIncome(b.scope, b.buCode, a.code)],
        ...OI_COLUMNS.map((c) => r2(oiCell(b, a.code, c))),
      ]),
    ),
  ];

  const total = (c: (typeof OI_COLUMNS)[number], keep: (b: OiBlock, account: string) => boolean) => {
    let s = 0;
    for (const b of blocks) for (const a of OI_ACCOUNTS) if (keep(b, a.code)) s += oiCell(b, a.code, c) ?? 0;
    return r2(s);
  };
  const ofClass = (cls: GroupClass) => (b: OiBlock, a: string) => classifyOtherIncome(b.scope, b.buCode, a) === cls;
  const byAccount = [
    ['Account', 'Account name', 'Side', ...heads],
    ...OI_ACCOUNTS.filter((a) => blocks.some((b) => hasData(b, a.code))).map((a) => [
      a.code,
      a.name,
      a.side === 'LL' ? 'Landlord' : (a.side ?? ''),
      ...OI_COLUMNS.map((c) => total(c, (_, x) => x === a.code)),
    ]),
    ['Total other income', null, null, ...OI_COLUMNS.map((c) => total(c, () => true))],
    ...ADJUSTMENTS.map((adj) => [adj.label, null, null, ...OI_COLUMNS.map((c) => -(total(c, ofClass(adj.cls)) ?? 0))]),
    [`Group other income · ${GROUP_NAME}`, null, null, ...OI_COLUMNS.map((c) => total(c, ofClass('group')))],
  ];

  return xlsxResponse(
    [
      { name: 'By account', rows: byAccount, cols: [44, 40, 10, ...heads.map(() => 15)] },
      { name: 'By property and account', rows: detail, cols: [6, 20, 10, 32, 10, 9, 40, 10, 16, ...heads.map(() => 15)] },
    ],
    `Other Income ${version.name}.xlsx`,
  );
}
