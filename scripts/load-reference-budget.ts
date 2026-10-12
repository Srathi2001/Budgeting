// The 2026 budget as read-only reference for the cost tabs (Building Overheads, Other Income, Admin
// Overheads): a 2026B column and the change of 2027B against it. From the approved workbook:
//   BuildingxOverheads    per building × GL account (row 5 to the Grand Total row)
//   OtherxIncome          per property × GL account; the General interest row split per company as in
//                         PnLxREHLxANPM (the REHL and REHL-MJN columns of "Interest on Fixed Deposit")
//   Admin(GA)xOverheads   per department × cost line (department columns by header), and what REHL pays
//   PayrollxCost          cost to company per department (the table under "Dept. Code")
// Columns are found by their headers, and each part is checked against the workbook's own total.
// Every amount keeps its sheet!cell. Without --apply it only prints what it would load and the
// tie-out to the workbook's own totals. Loading again replaces the year's reference rows.
//
//   npx tsx scripts/load-reference-budget.ts [workbook] [--apply]      (default: BUDGET_2026_XLSX)
import 'dotenv/config';
import { scriptActor } from './script-actor';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { propertyKey } from '../src/lib/import/tenant-lease';
import { OI_ACCOUNT } from '../src/lib/budget/other-income-types';

const YEAR = 2026;

type Ref = { module: 'boh' | 'oi' | 'admin' | 'payroll' | 'fees' | 'gasplit'; propertyId: number | null; scope: string; account: string; amount: number; note: string | null; source: string };

/** BuildingxOverheads: column → the tool's account */
const BOH_COLS: Record<string, { account: string; note?: string }> = {
  G: { account: '62324' },
  H: { account: '62401' },
  I: { account: '62402' },
  J: { account: '62501' },
  K: { account: '62502' },
  L: { account: '62504' },
  M: { account: '62210' },
  N: { account: '62119' },
  O: { account: '62608' },
  P: { account: '64303' },
  Q: { account: '64802' },
  R: { account: '64601', note: 'Insurance, all policies (one figure in the 2026 budget)' },
  S: { account: '62505', note: 'Misc maintenance (no account of its own in the tool)' },
  T: { account: '62601' },
  U: { account: '62608', note: 'Land rent / master community charges (one figure in the 2026 budget)' },
};

/** Admin(GA)xOverheads: department column headers → cost centre */
const ADMIN_DEPTS: Record<string, string> = {
  FM: '209',
  HR: '207',
  'PM & OPS': '206',
  Finance: '201',
  'Senior Management': '214',
  'Family Office - MAN': '106',
  PDD: '212',
  Legal: '202',
  Security: '211',
  'Office Support': '208',
  'ANPM - General': '000',
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r2 = (v: number) => Math.round(v * 100) / 100;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const file = args.find((a) => a !== '--apply') ?? process.env.BUDGET_2026_XLSX;
  if (!file) throw new Error('usage: load-reference-budget.ts <workbook> [--apply] (or set BUDGET_2026_XLSX)');
  const wb = XLSX.read(readFileSync(file), { cellFormula: false });
  const sheet = (name: string) => {
    const ws = wb.Sheets[name];
    if (!ws) throw new Error(`Sheet ${name} not found`);
    return ws;
  };
  const cell = (ws: XLSX.WorkSheet, a: string) => ws[a]?.v as unknown;
  /** the first cell whose text matches (column and row, 0-based column, 1-based row) */
  const find = (ws: XLSX.WorkSheet, re: RegExp) => {
    for (const [addr, c] of Object.entries(ws)) {
      if (addr.startsWith('!') || typeof (c as XLSX.CellObject).v !== 'string' || !re.test(String((c as XLSX.CellObject).v).trim())) continue;
      const d = XLSX.utils.decode_cell(addr);
      return { c: d.c, r: d.r + 1 };
    }
    throw new Error(`No cell matching ${re} in the sheet`);
  };

  const props = await db.select({ id: schema.properties.id, code: schema.properties.code }).from(schema.properties);
  const byKey = new Map(props.map((p) => [propertyKey(p.code), p]));
  const refs: Ref[] = [];
  const unmatched: string[] = [];
  const add = (r: Ref) => {
    const same = refs.find((x) => x.module === r.module && x.scope === r.scope && x.account === r.account);
    if (same) {
      // two workbook columns on one account (e.g. master community charges): one reference amount
      same.amount = r2(same.amount + r.amount);
      same.source += `+${r.source}`;
      same.note = same.note ?? r.note;
    } else refs.push(r);
  };

  // ---- BuildingxOverheads ----
  const boh = sheet('BuildingxOverheads');
  let bohTotal = 0;
  let bohGrand: number | null = null;
  for (let row = 4; row < 200; row++) {
    const a = cell(boh, `A${row}`);
    if (a === 'Grand Total') {
      bohGrand = num(cell(boh, `V${row}`));
      break;
    }
    const code = String(cell(boh, `B${row}`) ?? '').trim();
    if (!code || code === 'General') continue;
    const p = byKey.get(propertyKey(code));
    if (!p) unmatched.push(`BuildingxOverheads ${code}`);
    for (const [col, m] of Object.entries(BOH_COLS)) {
      const v = num(cell(boh, `${col}${row}`));
      if (!v) continue;
      bohTotal += v;
      add({ module: 'boh', propertyId: p?.id ?? null, scope: code, account: m.account, amount: r2(v), note: m.note ?? null, source: `BuildingxOverheads!${col}${row}` });
    }
  }

  // ---- OtherxIncome: found by its headers ("Property Code", the account row above it, "Grand Total") ----
  const oi = sheet('OtherxIncome');
  const oiHead = find(oi, /^Property Code$/);
  const oiCols: [string, string][] = [];
  let oiTotalCol: string | null = null;
  for (let c = oiHead.c + 1; c < oiHead.c + 60; c++) {
    const col = XLSX.utils.encode_col(c);
    const acct = String(cell(oi, `${col}${oiHead.r - 1}`) ?? '').trim();
    if (/^52\d{3}$/.test(acct)) oiCols.push([col, acct]);
    else if (/^Total$/i.test(acct)) oiTotalCol = col;
  }
  const codeCol = XLSX.utils.encode_col(oiHead.c);
  const nameCol = XLSX.utils.encode_col(oiHead.c + 1);
  let oiTotal = 0;
  let oiGrand: number | null = null;
  for (let row = oiHead.r + 1; row < oiHead.r + 200; row++) {
    const name = String(cell(oi, `${nameCol}${row}`) ?? '').trim();
    if (name === 'Grand Total') {
      oiGrand = oiTotalCol ? num(cell(oi, `${oiTotalCol}${row}`)) : null;
      break;
    }
    const code = String(cell(oi, `${codeCol}${row}`) ?? '').trim();
    if (name === 'GENERAL') {
      // interest on deposits, per company as in the P&L sheet (REHL, REHL-MJN columns next to the label)
      const pnl = sheet('PnLxREHLxANPM');
      const at = find(pnl, /^Interest on Fixed Deposit$/);
      const split: [string, string][] = [
        ['501', `${XLSX.utils.encode_col(at.c + 1)}${at.r}`],
        ['502', `${XLSX.utils.encode_col(at.c + 2)}${at.r}`],
      ];
      for (const [col, acct] of oiCols) {
        const v = num(cell(oi, `${col}${row}`));
        if (!v) continue;
        oiTotal += v;
        if (acct !== '52201') throw new Error(`General row: ${acct} has no company split`);
        const parts = split.map(([, a]) => num(cell(pnl, a)) ?? 0);
        if (Math.abs(parts.reduce((s, x) => s + x, 0) - v) > 0.05) throw new Error(`The P&L interest split ${parts.join(' + ')} does not add up to ${v}`);
        split.forEach(([bu, a], i) =>
          add({ module: 'oi', propertyId: null, scope: `G:${bu}`, account: acct, amount: r2(parts[i]), note: 'Interest on fixed deposits, per company as in the P&L', source: `OtherxIncome!${col}${row} (PnLxREHLxANPM!${a})` }),
        );
      }
      continue;
    }
    if (!code || code === '0') continue;
    const p = byKey.get(propertyKey(code));
    let any = false;
    for (const [col, acct] of oiCols) {
      const v = num(cell(oi, `${col}${row}`));
      if (!v) continue;
      any = true;
      oiTotal += v;
      if (!OI_ACCOUNT.has(acct)) throw new Error(`OtherxIncome ${acct} is not an account in the tool`);
      add({ module: 'oi', propertyId: p?.id ?? null, scope: p ? `P:${p.id}` : code, account: acct, amount: r2(v), note: null, source: `OtherxIncome!${col}${row}` });
    }
    if (any && !p) unmatched.push(`OtherxIncome ${code}`);
  }

  // ---- Admin(GA)xOverheads: department columns by their header, cost lines to the "Total" row ----
  const ga = sheet('Admin(GA)xOverheads');
  const gaHead = find(ga, /^Details - Department Wise$/);
  const gaCols: [string, string][] = [];
  let rehlCol: string | null = null;
  let grandCol: string | null = null;
  for (let c = gaHead.c + 1; c < gaHead.c + 30; c++) {
    const col = XLSX.utils.encode_col(c);
    const h = String(cell(ga, `${col}${gaHead.r}`) ?? '').trim();
    if (ADMIN_DEPTS[h]) gaCols.push([col, ADMIN_DEPTS[h]]);
    else if (h === 'REHL') rehlCol = col;
    else if (h === 'Grand Total') grandCol = col;
  }
  if (gaCols.length !== Object.keys(ADMIN_DEPTS).length) throw new Error(`Admin(GA)xOverheads: found ${gaCols.length} of ${Object.keys(ADMIN_DEPTS).length} department columns`);
  const lineCol = XLSX.utils.encode_col(gaHead.c);
  let gaTotal = 0;
  let gaRehl = 0;
  let totalRow = 0;
  for (let row = gaHead.r + 1; row < gaHead.r + 60; row++) {
    const line = String(cell(ga, `${lineCol}${row}`) ?? '').trim();
    if (!line) continue;
    if (line === 'Total') {
      totalRow = row;
      break;
    }
    for (const [col, dept] of gaCols) {
      const v = num(cell(ga, `${col}${row}`));
      if (!v) continue;
      gaTotal += v;
      add({ module: 'admin', propertyId: null, scope: dept, account: line, amount: r2(v), note: null, source: `Admin(GA)xOverheads!${col}${row}` });
    }
    const rehl = rehlCol ? num(cell(ga, `${rehlCol}${row}`)) : null;
    if (rehl) {
      gaRehl += rehl;
      add({ module: 'admin', propertyId: null, scope: '000', account: `${line} (paid by REHL)`, amount: r2(rehl), note: 'Paid by REHL', source: `Admin(GA)xOverheads!${rehlCol}${row}` });
    }
  }
  const gaGrand = grandCol && totalRow ? num(cell(ga, `${grandCol}${totalRow}`)) : null;
  const gaRehlGrand = rehlCol && totalRow ? num(cell(ga, `${rehlCol}${totalRow}`)) : null;

  // ---- PayrollxCost: cost to company per department (the table under "Dept. Code") ----
  const pc = sheet('PayrollxCost');
  const pcHead = find(pc, /^Dept\. Code$/);
  const deptCol = XLSX.utils.encode_col(pcHead.c);
  const deptNameCol = XLSX.utils.encode_col(pcHead.c + 1);
  const ctcCol = XLSX.utils.encode_col(pcHead.c + 2);
  if (!/CTC/i.test(String(cell(pc, `${ctcCol}${pcHead.r}`) ?? ''))) throw new Error('PayrollxCost: no "Total CTC" next to "Dept. Code"');
  let payTotal = 0;
  let payGrand: number | null = null;
  for (let row = pcHead.r + 1; row < pcHead.r + 40; row++) {
    const d = cell(pc, `${deptCol}${row}`);
    if (d === 'Grand Total') {
      payGrand = num(cell(pc, `${ctcCol}${row}`));
      break;
    }
    const dept = d === null || d === undefined ? '' : String(d).trim();
    const v = num(cell(pc, `${ctcCol}${row}`));
    if (!/^\d{3}$/.test(dept) || !v) continue;
    payTotal += v;
    add({ module: 'payroll', propertyId: null, scope: dept, account: 'CTC', amount: r2(v), note: String(cell(pc, `${deptNameCol}${row}`) ?? '') || null, source: `PayrollxCost!${ctcCol}${row}` });
  }

  // ---- the 2026 fees: PnLxREHLxANPM "General Admin Cost (PMA@6%)" and "AMA Agreement with MJN-H" ----
  // (they were written into the code as PAST_FEES; audit FIN-019) — rate in % (the label / the comment),
  // the fee per landlord in the three columns after the label: REHL, REHL-MJN, Mall
  const pnl = sheet('PnLxREHLxANPM');
  const rowText = (ws: XLSX.WorkSheet, r: number) =>
    Object.entries(ws)
      .filter(([a, c]) => !a.startsWith('!') && XLSX.utils.decode_cell(a).r + 1 === r && typeof (c as XLSX.CellObject).v === 'string')
      .map(([, c]) => String((c as XLSX.CellObject).v))
      .join(' ');
  let feesTotal = 0;
  for (const [fee, re] of [
    ['PMA', /^General Admin Cost \(PMA@/],
    ['AMA', /^AMA Agreement with MJN-H$/],
  ] as const) {
    const at = find(pnl, re);
    const pct = Number(/([\d.]+)\s*%/.exec(rowText(pnl, at.r))?.[1]);
    if (!pct) throw new Error(`PnLxREHLxANPM row ${at.r}: no rate (%) on the ${fee} row`);
    add({ module: 'fees', propertyId: null, scope: fee, account: 'ratePct', amount: pct, note: 'rate in %', source: `PnLxREHLxANPM!row ${at.r} text` });
    ['501', '502', 'MALL'].forEach((e, i) => {
      const a = `${XLSX.utils.encode_col(at.c + 1 + i)}${at.r}`;
      const v = num(cell(pnl, a));
      if (v === null) throw new Error(`PnLxREHLxANPM!${a}: no ${fee} fee for ${e}`);
      feesTotal += v;
      add({ module: 'fees', propertyId: null, scope: fee, account: e, amount: r2(v), note: null, source: `PnLxREHLxANPM!${a}` });
    });
  }

  // ---- the 2026 split of ANPM's G&A by revenue: PayrollxCost "Budget Revenue" and "Total Admin Payroll
  // Cost" rows, columns by their headers (REHL, REHL-MJN, ANPM-PMA; Net Total) (was PAST_SPLIT) ----
  const head = find(pc, /^Description$/);
  const colOf = (h: string) => {
    for (let c = head.c; c < head.c + 30; c++) if (String(cell(pc, `${XLSX.utils.encode_col(c)}${head.r}`) ?? '').trim() === h) return XLSX.utils.encode_col(c);
    throw new Error(`PayrollxCost: no "${h}" column`);
  };
  const revRow = find(pc, /^Budget Revenue$/).r;
  const allocRow = find(pc, /^Total Admin Payroll Cost$/).r;
  const net = num(cell(pc, `${colOf('Net Total')}${allocRow}`));
  if (net === null) throw new Error('PayrollxCost: no net G&A');
  add({ module: 'gasplit', propertyId: null, scope: 'net', account: 'total', amount: r2(net), note: "ANPM's net G&A", source: `PayrollxCost!${colOf('Net Total')}${allocRow}` });
  for (const [h, e] of [['REHL', '501'], ['REHL-MJN', '502'], ['ANPM-PMA', '522']] as const) {
    for (const [scope, r] of [['revenue', revRow], ['allocated', allocRow]] as const) {
      const a = `${colOf(h)}${r}`;
      const v = num(cell(pc, a));
      if (v === null) throw new Error(`PayrollxCost!${a}: empty`);
      add({ module: 'gasplit', propertyId: null, scope, account: e, amount: r2(v), note: null, source: `PayrollxCost!${a}` });
    }
  }

  const tie = (label: string, loaded: number, book: number | null) => console.log(`${label.padEnd(34)} loaded ${loaded.toFixed(2).padStart(16)}  workbook ${book === null ? '-' : book.toFixed(2).padStart(16)}  ${book !== null && Math.abs(loaded - book) < 0.05 ? 'ties' : 'DIFFERS'}`);
  tie('BuildingxOverheads (Grand Total)', bohTotal, bohGrand);
  tie('OtherxIncome (Grand Total)', oiTotal, oiGrand);
  tie('Admin(GA)xOverheads (Total)', gaTotal, gaGrand);
  tie('Admin(GA) paid by REHL (Total)', gaRehl, gaRehlGrand);
  tie('PayrollxCost cost to company (Grand Total)', payTotal, payGrand);
  console.log(`2026 fees (PMA + AMA, three landlords) ${feesTotal.toFixed(2)} · ANPM net G&A ${net.toFixed(2)}`);
  console.log(`${refs.length} reference rows · ${refs.filter((r) => r.module === 'boh').length} building overheads · ${refs.filter((r) => r.module === 'oi').length} other income · ${refs.filter((r) => r.module === 'admin').length} admin · ${refs.filter((r) => r.module === 'payroll').length} payroll`);
  if (unmatched.length) console.log(`Not a property in the tool (kept, not shown): ${unmatched.join(', ')}`);

  if (!apply) {
    console.log('Dry run: add --apply to load.');
    return;
  }
  const actor = await scriptActor();
  await db.transaction(async (tx) => {
    await tx.delete(schema.budgetReference).where(eq(schema.budgetReference.year, YEAR));
    for (let i = 0; i < refs.length; i += 500) await tx.insert(schema.budgetReference).values(refs.slice(i, i + 500).map((r) => ({ year: YEAR, ...r })));
    await tx.insert(schema.auditLog).values({ userId: actor, entity: 'budget_reference', action: 'load', changes: { year: YEAR, file: file.split(/[\\/]/).pop(), rows: refs.length, boh: r2(bohTotal), oi: r2(oiTotal), admin: r2(gaTotal + gaRehl), payroll: r2(payTotal) } });
  });
  console.log(`Loaded ${refs.length} reference rows for ${YEAR}B.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
