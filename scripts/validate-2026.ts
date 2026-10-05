// Recomputes every 2026 unit with the engine and compares it with the values in the
// finance master workbook. Usage: npx tsx scripts/validate-2026.ts "<path to H.E. MJN_Budget 2026.xlsm>"

import { readFileSync, writeFileSync } from 'node:fs';
import { readWorkbook, parseRevenueMaster, parseCamps, type ParsedLease } from '../src/lib/import/budget2026';
import { computeLease } from '../src/lib/engine/lease';
import { DEFAULT_ASSUMPTIONS } from '../src/lib/engine/assumptions';
import { formatDay } from '../src/lib/engine/dates';

const path = process.argv[2];
if (!path) throw new Error('Pass the workbook path');
const wb = readWorkbook(readFileSync(path));
const leases: ParsedLease[] = [...parseRevenueMaster(wb), ...parseCamps(wb)];

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
let excelRev = 0, toolRev = 0, excelCash = 0, toolCash = 0;
const revDiffs: string[] = [];
const cashDiffs: { unit: string; excel: number; tool: number; detail: string }[] = [];

for (const l of leases) {
  const res = computeLease(
    {
      rc: l.rc,
      isCamp: l.source === 'CAMPS',
      area: l.area,
      capacity: l.capacity,
      staffOwner: l.staffOwner,
      mfCurrent: l.mfCurrent,
      currentRent: l.currentRent,
      currentStart: l.currentStart,
      currentEnd: l.currentEnd,
      currentSchedule: null,
      securityDeposit: null,
      r1Schedule: null,
      r2Schedule: null,
      renew1: l.renew1,
      noRenewal: l.noRenewal,
      r1Rent: l.r1Rent ?? 0,
      r1Start: l.r1Start,
      r1End: l.r1End,
      r1Mf: l.r1Mf ?? false,
      // the workbook holds explicit 2nd-renewal values; no value means no 2nd renewal
      r2Renew: l.r2Start ? true : false,
      r2Rent: l.r2Rent,
      r2Start: l.r2Start,
      r2End: l.r2End,
      r2Mf: l.r2Mf ?? false,
      budgetRate: null,
      increasePctOverride: null,
      cheques: null,
    },
    2026,
    DEFAULT_ASSUMPTIONS,
  );
  const eR = sum(l.excelRevenue), tR = res.totals.revenue;
  excelRev += eR; toolRev += tR;
  if (Math.abs(eR - tR) > 1) revDiffs.push(`${l.source} r${l.row} ${l.unitCode}: excel ${eR.toFixed(0)} tool ${tR.toFixed(0)} diff ${(tR - eR).toFixed(0)}`);
  if (l.excelCash) {
    const eC = sum(l.excelCash), tC = res.totals.cash;
    excelCash += eC; toolCash += tC;
    if (Math.abs(eC - tC) > 1) {
      const months = l.excelCash.map((v, i) => (Math.abs(v - res.cash[i]) > 1 ? `m${i + 1}: ${v.toFixed(0)}->${res.cash[i].toFixed(0)}` : null)).filter(Boolean);
      cashDiffs.push({ unit: `r${l.row} ${l.unitCode}`, excel: eC, tool: tC, detail: `${months.join(', ')} | start ${formatDay(l.currentStart)} r1 ${formatDay(l.r1Start)}` });
    }
  }
}

console.log(`Units checked: ${leases.length}`);
console.log(`Revenue  excel ${excelRev.toFixed(0)}  tool ${toolRev.toFixed(0)}  diff ${(toolRev - excelRev).toFixed(0)}  units differing: ${revDiffs.length}`);
console.log(`Cash     excel ${excelCash.toFixed(0)}  tool ${toolCash.toFixed(0)}  diff ${(toolCash - excelCash).toFixed(0)}  units differing: ${cashDiffs.length}`);
console.log('\nRevenue differences (first 25):\n' + revDiffs.slice(0, 25).join('\n'));
console.log('\nCash differences (first 25):\n' + cashDiffs.slice(0, 25).map((d) => `${d.unit}: excel ${d.excel.toFixed(0)} tool ${d.tool.toFixed(0)} | ${d.detail}`).join('\n'));
if (process.argv[3]) {
  writeFileSync(process.argv[3], JSON.stringify({ revDiffs, cashDiffs }, null, 2));
}
