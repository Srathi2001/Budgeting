import 'server-only';
import * as XLSX from 'xlsx';

export function xlsxResponse(sheets: { name: string; rows: unknown[][]; cols?: number[] }[], filename: string) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows, { cellDates: false });
    if (s.cols) ws['!cols'] = s.cols.map((wch) => ({ wch }));
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
