import { describe, expect, it } from 'vitest';
import { scanAccountAnalysis } from './gl-analysis';

const td = (...c: string[]) => `<tr>${c.map((x) => `<td><p>${x}</p></td>`).join('')}</tr>`;
const HEAD = ['Source', 'Category', 'GL Date', 'Event Class', 'Transaction Date / Cheque Date', 'Voucher Number', 'Transaction Number', 'Asset Number', 'PO Number', 'Supplier/Customer Name', 'Line Description', 'Lease No', 'Tenant No', 'Unit Code', 'Debit', 'Credit', 'Balance'];
const blank = (n: number) => Array<string>(n).fill('');
const line = (date: string, dr: string, cr: string) => td('Receivables', 'Sales Invoices', date, ...blank(11), dr, cr, '');

const html = [
  '<html><body><table>',
  td('Period From', 'Jan-24', 'Period To', 'Sep-26'),
  td('Ledger Name', 'MJN HOLDING', '', 'Ledger Currency', '', 'AED'),
  td('Account', '501-00-206-30B101-52401-00000-000-000', 'Description', 'REHL-GENERAL-PMD-AL QUSAIS-ADMIN FEE-GENERAL-GENERAL-GENERAL'),
  td(...HEAD),
  td(...blank(14), '0.00', '0.00', '0.00'),
  line('15-Jan-2025', '', '1,000.00'),
  line('20-Jan-2025', '', '500.00'),
  line('3-Feb-2026', '200.00', ''),
  td(...blank(10), 'Total for Account', ...blank(3), '', '1,300.00', ''),
  td('', 'Total for Ledger', '', '', '', '0.00'),
  '</table></body></html>',
].join('\n');

// the Analytics Publisher export: MIME, quoted-printable, lines wrapped at 76 with "=" soft breaks
const qp = (s: string) =>
  s
    .replace(/=/g, '=3D')
    .split('\n')
    .map((l) => l.replace(/(.{70})/g, '$1=\r\n'))
    .join('\r\n');
const mime = `Date: Tue, 6 Oct 2026\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qp(html)}${' '.repeat(5000)}\r\n--b1--`;

async function* chunks(s: string, size: number) {
  for (let i = 0; i < s.length; i += size) yield Buffer.from(s.slice(i, i + size), 'latin1');
}

describe('Account Analysis Report', () => {
  it.each([1, 7, 64, 100000])('reads it in chunks of %i bytes', async (size) => {
    const scan = await scanAccountAnalysis(chunks(mime, size));
    expect(scan.ledger).toBe('MJN HOLDING');
    expect([scan.periodFrom, scan.periodTo]).toEqual(['Jan-24', 'Sep-26']);
    expect(scan.mismatches).toEqual([]);
    expect(scan.months.sort((a, b) => a.month.localeCompare(b.month))).toEqual([
      { account: '501-00-206-30B101-52401-00000-000-000', month: '2025-01', debit: 0, credit: 1500, lines: 2 },
      { account: '501-00-206-30B101-52401-00000-000-000', month: '2026-02', debit: 200, credit: 0, lines: 1 },
    ]);
  });
  it('flags an account whose lines do not add up to its total', async () => {
    const scan = await scanAccountAnalysis(chunks(mime.replace('1,300.00', '1,400.00'), 4096));
    expect(scan.mismatches).toHaveLength(1);
  });
  it('rejects a cut-off file', async () => {
    await expect(scanAccountAnalysis(chunks(mime.slice(0, mime.indexOf('Total for Ledger') - 200), 4096))).rejects.toThrow(/incomplete/);
  });
});
