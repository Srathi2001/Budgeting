// The input pages' Excel templates (see cell-template.ts): what each one holds, who may use it, and how
// an upload's changes are saved (through the page's own save function and its permission checks).
import 'server-only';
import { isFinance, isFm, visibleProperties, editablePropertyIds, type CurrentUser } from '@/lib/auth/dal';
import type { schema } from '@/db';
import { getFilters, filteredScope } from '@/lib/filters-server';
import { loadOtherIncome, saveOtherIncome } from '@/lib/budget/other-income';
import { OI_ACCOUNTS, oiCell, oiInput, oiLabel, type OiChange } from '@/lib/budget/other-income-types';
import { loadBuildingOverheads, saveBuildingOverheads } from '@/lib/budget/boh';
import { BOH_ACCOUNT, BOH_LINE_LABEL, paidInOneMonth, type BohChange } from '@/lib/budget/boh-types';
import { loadAdminOverheads, saveAdminOverheads } from '@/lib/budget/admin';
import { ADMIN_ACCOUNTS, ADMIN_ACCOUNT, AMA_ENTITIES, DEPTS, PAYERS, deptName, isPayrollAccount, type AdminChange } from '@/lib/budget/admin-types';
import { ITEM_KIND, SCHEDULE_ACCOUNT } from '@/lib/budget/admin-items';
import { loadFmPage } from '@/lib/budget/fm-page';
import { saveFmStaffAs } from '@/lib/budget/fm-save';
import { STAFF_TEAMS } from '@/lib/budget/fm-types';
import type { Template, TemplateChange, TplRow } from './cell-template';

export const TEMPLATE_KINDS = ['other-income', 'building-overheads', 'admin-overheads', 'fm-labour'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const isTemplateKind = (s: unknown): s is TemplateKind => TEMPLATE_KINDS.includes(s as TemplateKind);

/** null when the user may use the template, else why not */
export function templateAccess(kind: TemplateKind, user: CurrentUser): string | null {
  if (kind === 'fm-labour') return isFinance(user) || isFm(user) ? null : 'The FM staff budget is entered by facilities management';
  if (isFm(user)) return 'Facilities management enters the FM budget only';
  if (kind === 'admin-overheads' && !isFinance(user)) return 'Admin overheads are entered by Finance';
  return null;
}

const FILE: Record<TemplateKind, string> = {
  'other-income': 'Other Income',
  'building-overheads': 'Building Overheads',
  'admin-overheads': 'Admin Overheads',
  'fm-labour': 'FM Labour allocation',
};
export const templateFileName = (kind: TemplateKind, year: number) => `${FILE[kind]} input ${year}.xlsx`;

/**
 * The template as of now. `filtered`: the page filters apply (download); without, every property the
 * user can see (upload, so a filter changed in between doesn't reject rows).
 */
export async function buildInputTemplate(kind: TemplateKind, user: CurrentUser, version: schema.BudgetVersion, filtered: boolean): Promise<Template> {
  const locked = version.status === 'LOCKED';
  const Y = version.year;
  const scoped = async () => {
    const props = await visibleProperties(user);
    if (!filtered) return props;
    const ids = new Set((await filteredScope(user)).propertyIds);
    return props.filter((p) => ids.has(p.id));
  };

  if (kind === 'other-income') {
    const props = await scoped();
    const f = filtered ? await getFilters() : null;
    const blocks = (await loadOtherIncome(version, user, props, await editablePropertyIds(user, version))).filter(
      // company-level (General) rows follow only the business unit filter, as on the page
      (b) => b.kind === 'P' || !f || ((!f.bu.length || f.bu.includes(b.buCode)) && !f.pm.length && !f.cat.length && !f.prop.length),
    );
    const rows: TplRow[] = blocks.flatMap((b) =>
      OI_ACCOUNTS.filter((a) => (b.kind === 'G' ? a.general : !a.general) || b.values[a.code]).map((a) => ({
        key: `${b.scope}|${a.code}`,
        values: {
          bu: b.buCode,
          code: b.kind === 'G' ? 'General' : b.code,
          name: b.kind === 'G' ? `${b.buName} (company level)` : b.name,
          pm: b.pm,
          gl: a.code,
          account: a.name,
          side: a.side === 'LL' ? 'Landlord' : (a.side ?? null),
          A2: oiCell(b, a.code, 'A2'),
          A1: oiCell(b, a.code, 'A1'),
          YTD: oiCell(b, a.code, 'YTD'),
          OD: oiCell(b, a.code, 'OD'),
          F: oiCell(b, a.code, 'F'),
          B: oiCell(b, a.code, 'B'),
        },
        open: b.editable ? (['OD', 'B'] as const).filter((c) => oiInput(b, a.code, c)) : [],
      })),
    );
    return {
      title: 'Other Income',
      scope: `${blocks.filter((b) => b.kind === 'P').length} properties`,
      locked,
      instructions: [
        `4. Enter the ${oiLabel('OD', Y)} forecast and the ${oiLabel('B', Y)} budget per property and account. Actuals come from the GL; the maintenance service fee budget is calculated from the leases and the PMA fee from the rent.`,
      ],
      sheets: [
        {
          name: 'Other Income',
          columns: [
            { key: 'bu', header: 'BU', width: 6, kind: 'text' },
            { key: 'code', header: 'Code', width: 11, kind: 'text', label: true },
            { key: 'name', header: 'Property', width: 34, kind: 'text' },
            { key: 'pm', header: 'PM', width: 10, kind: 'text' },
            { key: 'gl', header: 'GL', width: 8, kind: 'text' },
            { key: 'account', header: 'Account', width: 30, kind: 'text', label: true },
            { key: 'side', header: 'LL / ANPM', width: 10, kind: 'text' },
            { key: 'A2', header: oiLabel('A2', Y), width: 12, kind: 'money' },
            { key: 'A1', header: oiLabel('A1', Y), width: 12, kind: 'money' },
            { key: 'YTD', header: oiLabel('YTD', Y), width: 13, kind: 'money' },
            { key: 'OD', header: oiLabel('OD', Y), width: 13, kind: 'money', input: true, help: `Forecast for the rest of ${Y - 1}.` },
            { key: 'F', header: `${oiLabel('F', Y)} (calc.)`, width: 13, kind: 'money', help: `${oiLabel('YTD', Y)} + ${oiLabel('OD', Y)}, as of the download.` },
            { key: 'B', header: oiLabel('B', Y), width: 13, kind: 'money', input: true, help: `Budget for ${Y}. Grey where it is calculated.` },
          ],
          rows,
        },
      ],
    };
  }

  if (kind === 'building-overheads') {
    const props = await scoped();
    const { blocks } = await loadBuildingOverheads(version, props, await editablePropertyIds(user, version));
    const finance = isFinance(user);
    const rows: TplRow[] = blocks.flatMap((b) =>
      b.rows.map((r) => {
        const a = BOH_ACCOUNT.get(r.account)!;
        const may = b.editable && (a.owner === 'PM' || finance);
        return {
          key: `${b.propertyId}|${r.account}`,
          values: {
            bu: b.buCode,
            code: b.code,
            name: b.name,
            pm: b.pm,
            line: BOH_LINE_LABEL[a.line],
            gl: a.code,
            account: a.name,
            owner: a.owner === 'FIN' ? 'Finance' : 'Property manager',
            a2: r.a2,
            a1: r.a1,
            ytd: r.ytd,
            f: r.f,
            b: r.b,
            due: paidInOneMonth(a) ? (r.dueMonth ?? null) : null,
          },
          open: may ? ['b', ...(paidInOneMonth(a) ? ['due'] : [])] : [],
        };
      }),
    );
    return {
      title: 'Building Overheads',
      scope: `${blocks.length} properties`,
      locked,
      instructions: [
        '4. Enter the budget per building and account. Accounts marked Finance are entered by Finance. For amounts paid in one month (service charges, civil defence, premiums paid upfront) the Due month says when; blank = last year’s month.',
      ],
      sheets: [
        {
          name: 'Building Overheads',
          columns: [
            { key: 'bu', header: 'BU', width: 6, kind: 'text' },
            { key: 'code', header: 'Code', width: 11, kind: 'text', label: true },
            { key: 'name', header: 'Property', width: 34, kind: 'text' },
            { key: 'pm', header: 'PM', width: 10, kind: 'text' },
            { key: 'line', header: 'P&L line', width: 22, kind: 'text' },
            { key: 'gl', header: 'GL', width: 8, kind: 'text' },
            { key: 'account', header: 'Account', width: 32, kind: 'text', label: true },
            { key: 'owner', header: 'Entered by', width: 16, kind: 'text' },
            { key: 'a2', header: `${Y - 3}A`, width: 12, kind: 'money' },
            { key: 'a1', header: `${Y - 2}A`, width: 12, kind: 'money' },
            { key: 'ytd', header: `${Y - 1} YTD`, width: 12, kind: 'money' },
            { key: 'f', header: `${Y - 1}F`, width: 12, kind: 'money' },
            { key: 'b', header: `${Y}B`, width: 13, kind: 'money', input: true, help: `Budget for ${Y}, for the year.` },
            { key: 'due', header: 'Due month', width: 10, kind: 'month', input: true, help: 'Only for amounts paid in one month. Blank = last year’s month.' },
          ],
          rows,
        },
      ],
    };
  }

  if (kind === 'admin-overheads') {
    const d = await loadAdminOverheads(version);
    const deptText = (code: string) => `${code} ${deptName(code)}`;
    const acctText = (code: string) => `${code} ${ADMIN_ACCOUNT.get(code)?.name ?? ''}`.trim();
    const typed = (account: string) => !SCHEDULE_ACCOUNT.has(account) && !isPayrollAccount(account);
    const PAY = PAYERS.map((p) => p.code);
    const DEPT_LIST = DEPTS.filter((x) => !x.elsewhere).map((x) => deptText(x.code));
    const ACCT_LIST = ADMIN_ACCOUNTS.filter((a) => typed(a.code)).map((a) => acctText(a.code));
    return {
      title: 'Admin Overheads',
      scope: 'All cost centres',
      locked,
      instructions: [
        '4. Payroll: headcount and cost to company per department (existing and new staff). The three shares are the 2026 rules; blank = the default rule.',
        '5. Admin costs: the budget per department and account by paying company. To add an account for a department, use a blank row at the bottom of the sheet. Accounts with their own schedule in the tool (vehicles, telephones, training, events) are entered there.',
        '6. Assets: the landlords’ asset values the AMA fee is calculated on.',
      ],
      sheets: [
        {
          name: 'Payroll',
          columns: [
            { key: 'dept', header: 'Department', width: 32, kind: 'text', label: true },
            { key: 'a2', header: `${Y - 3}A`, width: 12, kind: 'money' },
            { key: 'a1', header: `${Y - 2}A`, width: 12, kind: 'money' },
            { key: 'ytd', header: `${Y - 1} YTD`, width: 12, kind: 'money' },
            { key: 'f', header: `${Y - 1}F`, width: 12, kind: 'money' },
            { key: 'headcount', header: 'Headcount', width: 11, kind: 'int', input: true, help: 'Existing staff.' },
            { key: 'ctc', header: 'Cost to company', width: 15, kind: 'money', input: true, help: 'Existing staff, for the year.' },
            { key: 'newHeadcount', header: 'New headcount', width: 11, kind: 'int', input: true, help: 'New hires.' },
            { key: 'newCtc', header: 'New cost to company', width: 15, kind: 'money', input: true, help: 'New hires, for the year.' },
            { key: 'capPct', header: 'Capitalised %', width: 12, kind: 'pct', input: true, help: 'Share capitalised to projects. Blank = the 2026 rule.' },
            { key: 'mjnhPct', header: 'Recharged to MJNH %', width: 12, kind: 'pct', input: true, help: 'Blank = the 2026 rule.' },
            { key: 'asrePct', header: 'Recharged to ASRE %', width: 12, kind: 'pct', input: true, help: 'Blank = the 2026 rule.' },
          ],
          rows: d.payroll.map((r) => ({
            key: `pay|${r.dept}`,
            values: { dept: deptText(r.dept), a2: r.a2, a1: r.a1, ytd: r.ytd, f: r.f, headcount: r.headcount, ctc: r.ctc, newHeadcount: r.newHeadcount, newCtc: r.newCtc, capPct: r.capPct, mjnhPct: r.mjnhPct, asrePct: r.asrePct },
            open: ['headcount', 'ctc', 'newHeadcount', 'newCtc', 'capPct', 'mjnhPct', 'asrePct'],
          })),
        },
        {
          name: 'Admin costs',
          columns: [
            { key: 'dept', header: 'Department', width: 30, kind: 'text', label: true, identity: true, list: DEPT_LIST, help: 'New rows: the department (drop-down).' },
            { key: 'account', header: 'Account', width: 36, kind: 'text', label: true, identity: true, list: ACCT_LIST, help: 'New rows: the GL account (drop-down).' },
            { key: 'note', header: 'Entered in', width: 16, kind: 'text' },
            { key: 'a2', header: `${Y - 3}A`, width: 12, kind: 'money' },
            { key: 'a1', header: `${Y - 2}A`, width: 12, kind: 'money' },
            { key: 'ytd', header: `${Y - 1} YTD`, width: 12, kind: 'money' },
            { key: 'f', header: `${Y - 1}F`, width: 12, kind: 'money' },
            ...PAYERS.map((p) => ({ key: `b${p.code}`, header: `${Y}B ${p.name}`, width: 14, kind: 'money' as const, input: true, help: `Budget paid by ${p.name} (${p.code}).` })),
          ],
          rows: d.admin.map((r) => {
            const elsewhere = DEPTS.find((x) => x.code === r.dept)?.elsewhere;
            const note = r.schedule ? `${ITEM_KIND.get(r.schedule)!.label} tab` : elsewhere ? 'Another module' : isPayrollAccount(r.account) ? 'Payroll' : null;
            return {
              key: `adm|${r.dept}|${r.account}`,
              values: { dept: deptText(r.dept), account: acctText(r.account), note, a2: r.a2, a1: r.a1, ytd: r.ytd, f: r.f, ...Object.fromEntries(PAY.map((p) => [`b${p}`, r.schedule ? (r.items[p] ?? null) : (r.b[p] ?? null)])) },
              open: note ? [] : PAY.map((p) => `b${p}`),
            };
          }),
          newRows: 60,
          keyOf: (v) => {
            const dept = /^\d{3}/.exec(String(v.dept ?? ''))?.[0];
            const account = /^\d{5}/.exec(String(v.account ?? ''))?.[0];
            return dept && account ? `adm|${dept}|${account}` : null;
          },
        },
        {
          name: 'Assets (AMA)',
          columns: [
            { key: 'entity', header: 'Landlord', width: 20, kind: 'text', label: true },
            { key: 'value', header: 'Asset value', width: 16, kind: 'money', input: true, help: 'The AMA fee is the rate × this value.' },
          ],
          rows: d.assets.map((a) => ({ key: `ast|${a.entity}`, values: { entity: AMA_ENTITIES.find((e) => e.key === a.entity)?.name ?? a.entity, value: a.assetValue }, open: ['value'] })),
        },
      ],
    };
  }

  // fm-labour
  const page = await loadFmPage(version, user, [], null);
  const label = new Map(STAFF_TEAMS.map((t) => [t.code, t]));
  const prior = page.priorLabel;
  return {
    title: 'FM Labour allocation',
    scope: 'FM staff by team',
    locked,
    instructions: ['4. Enter the cost to company and overtime of each FM team for the year; the G&A share (department overheads) as one amount. Last year’s figures are there for reference.'],
    sheets: [
      {
        name: 'FM staff',
        columns: [
          { key: 'team', header: 'Team', width: 28, kind: 'text', label: true },
          { key: 'spread', header: 'Spread over', width: 46, kind: 'text' },
          ...(prior
            ? [
                { key: 'pctc', header: `${prior} cost to company`, width: 15, kind: 'money' as const },
                { key: 'pot', header: `${prior} overtime`, width: 13, kind: 'money' as const },
              ]
            : []),
          { key: 'ctc', header: `${Y}B cost to company`, width: 15, kind: 'money', input: true, help: 'For the year. The G&A share row: the department overheads.' },
          { key: 'ot', header: `${Y}B overtime`, width: 13, kind: 'money', input: true, help: 'For the year (not on the G&A share row).' },
        ],
        rows: page.staff.map((s) => ({
          key: `team|${s.team}`,
          values: { team: label.get(s.team)?.label ?? s.team, spread: label.get(s.team)?.hint ?? null, pctc: s.prior?.ctc ?? null, pot: s.team === 'GA' ? null : (s.prior?.overtime ?? null), ctc: s.ctc || null, ot: s.team === 'GA' ? null : s.overtime || null },
          open: page.canEditStaff ? (s.team === 'GA' ? ['ctc'] : ['ctc', 'ot']) : [],
        })),
      },
    ],
  };
}

/** Saves the changes of an upload through the page's save path. */
export async function applyInputTemplate(kind: TemplateKind, user: CurrentUser, version: schema.BudgetVersion, current: Template, changes: TemplateChange[]): Promise<{ saved: number; errors: string[] }> {
  const rowOf = new Map(current.sheets.flatMap((s) => s.rows.map((r) => [r.key, r] as const)));
  const byKey = new Map<string, TemplateChange[]>();
  for (const c of changes) byKey.set(c.key, [...(byKey.get(c.key) ?? []), c]);
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  const chunks = async <T>(list: T[], save: (part: T[]) => Promise<{ saved: number; errors: string[] }>) => {
    const out = { saved: 0, errors: [] as string[] };
    for (let i = 0; i < list.length; i += 400) {
      const r = await save(list.slice(i, i + 400));
      out.saved += r.saved;
      out.errors.push(...r.errors);
    }
    return out;
  };

  if (kind === 'other-income') {
    const list: OiChange[] = changes.map((c) => {
      const [scope, account] = c.key.split('|');
      return { scope, account, period: c.column as 'OD' | 'B', amount: num(c.to) };
    });
    return chunks(list, (p) => saveOtherIncome(user, version.id, p));
  }
  if (kind === 'building-overheads') {
    // amount and due month are saved together: an unchanged one keeps its value
    const list: BohChange[] = [...byKey].map(([key, cs]) => {
      const [pid, account] = key.split('|');
      const cur = rowOf.get(key)!.values;
      const get = (col: string) => {
        const c = cs.find((x) => x.column === col);
        return c ? num(c.to) : num(cur[col]);
      };
      return { propertyId: Number(pid), account, amount: get('b'), dueMonth: get('due') };
    });
    return chunks(list, (p) => saveBuildingOverheads(user, version.id, p));
  }
  if (kind === 'admin-overheads') {
    const list: AdminChange[] = changes.map((c) => {
      const [k, a, b] = c.key.split('|');
      if (k === 'pay') return { kind: 'payroll', dept: a, field: c.column as Extract<AdminChange, { kind: 'payroll' }>['field'], value: num(c.to) };
      if (k === 'adm') return { kind: 'admin', dept: a, account: b, entity: c.column.slice(1), value: num(c.to) };
      return { kind: 'asset', entity: a, value: num(c.to) };
    });
    return chunks(list, (p) => saveAdminOverheads(user, version.id, p));
  }
  // fm-labour: each changed team with both its amounts
  const staff = [...byKey].map(([key, cs]) => {
    const team = key.split('|')[1];
    const cur = rowOf.get(key)!.values;
    const get = (col: string) => {
      const c = cs.find((x) => x.column === col);
      return (c ? num(c.to) : num(cur[col])) ?? 0;
    };
    return { team, ctc: get('ctc'), overtime: team === 'GA' ? 0 : get('ot') };
  });
  const r = await saveFmStaffAs(user, version.id, staff);
  return r.error ? { saved: 0, errors: [r.error] } : { saved: staff.length, errors: [] };
}
