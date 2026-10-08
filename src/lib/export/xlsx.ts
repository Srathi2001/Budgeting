import 'server-only';
import * as XLSX from 'xlsx';
import { XL } from '@/lib/format';

/** a column's kind, read from its heading (dates come as Excel serials from excelDate) */
function kindOf(header: string, values: number[]): keyof typeof XL {
  const h = header.toLowerCase();
  const serials = values.length > 0 && values.every((v) => Number.isInteger(v) && v > 30000 && v < 70000);
  if (serials && /date|start|end|commencement|from|to\b|expiry|paid/.test(h)) return 'date';
  if (/%|percent|\bpct\b|share of|growth|increase|occupancy/.test(h) && values.every((v) => Math.abs(v) <= 10)) return 'pct';
  // serial numbers and areas are whole however they come
  if (/^(s\.?\s?n\.?|sl\.?\s?no\.?|sr\.?\s?no\.?|no\.?)$|area|sq\.? ?ft/.test(h)) return 'count';
  if (/\bunits?\b|\bbeds?\b|\brooms?\b|cheques|\bdays\b|\bmonths\b|\blines\b|\bcount\b|\bqty\b|quantity|headcount|\byear\b|version/.test(h) && values.every((v) => Number.isInteger(v)))
    return 'count';
  return 'amount';
}

/**
 * Excel download. Numbers get the tool's formats by column: amounts 1,234.56 with brackets and a dash for
 * zero, counts whole, percentages 0.00%, dates 08-Oct-2026 (the column heading says which).
 */
export function xlsxResponse(sheets: { name: string; rows: unknown[][]; cols?: number[] }[], filename: string) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows, { cellDates: false });
    if (s.cols) ws['!cols'] = s.cols.map((wch) => ({ wch }));
    // the heading of a column: the last text above its first number
    const width = Math.max(0, ...s.rows.map((r) => r.length));
    for (let c = 0; c < width; c++) {
      const first = s.rows.findIndex((r) => typeof r[c] === 'number');
      if (first < 0) continue;
      let header = '';
      for (let r = first - 1; r >= 0; r--) if (typeof s.rows[r][c] === 'string' && s.rows[r][c]) {
        header = s.rows[r][c] as string;
        break;
      }
      const values = s.rows.slice(first).map((r) => r[c]).filter((v): v is number => typeof v === 'number');
      const z = XL[kindOf(header, values)];
      for (let r = first; r < s.rows.length; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.t === 'n') cell.z = z;
      }
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** 'YYYY-MM-DD' -> Excel serial date number (so the cell is a real date in Excel). */
export function excelDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000) + 25569;
}

export const r2 = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);
