// Oracle exports saved as ".xls" are often web pages, not spreadsheets: the Unit Dump is an Excel
// "Single File Web Page" (MIME, one HTML part per sheet) and Oracle Analytics Publisher reports are a
// nested MIME message with one HTML document. This reads either (or a real .xls / .xlsx) into tables.
import * as XLSX from 'xlsx';

export interface Table {
  name: string;
  rows: unknown[][];
}

const sheets = (wb: XLSX.WorkBook, prefix = ''): Table[] =>
  wb.SheetNames.map((s) => ({ name: `${prefix}${s}`, rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[s], { header: 1, raw: false, defval: null }) }));

export function readTables(data: Buffer): Table[] {
  // a real workbook (zip / OLE)
  if (data[0] === 0x50 && data[1] === 0x4b) return sheets(XLSX.read(data, { type: 'buffer' }));
  if (data[0] === 0xd0 && data[1] === 0xcf) return sheets(XLSX.read(data, { type: 'buffer' }));

  const raw = data.toString('latin1');
  const out: Table[] = [];
  const boundary = /boundary="?([^"\r\n;]+)"?/i.exec(raw)?.[1];
  if (boundary) {
    for (const part of raw.split(`--${boundary}`)) {
      const sep = part.search(/\r?\n\r?\n/);
      if (sep < 0) continue;
      const head = part.slice(0, sep);
      if (!/text\/html/i.test(head)) continue;
      let body = part.slice(sep).trim();
      if (/quoted-printable/i.test(head)) body = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
      if (/base64/i.test(head)) body = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('latin1');
      if (!/<table/i.test(body)) continue;
      const name = /Content-Location:\s*(\S+)/i.exec(head)?.[1]?.split('/').pop() ?? `part${out.length + 1}`;
      out.push(...sheets(XLSX.read(body, { type: 'string', raw: true }), `${name}:`));
    }
  }
  // nested multipart (Analytics Publisher) or a plain HTML file: the HTML document itself
  if (!out.length) {
    const start = raw.search(/<html/i);
    const end = raw.search(/<\/html>/i);
    if (start >= 0) out.push(...sheets(XLSX.read(raw.slice(start, end > start ? end + 7 : undefined), { type: 'string', raw: true })));
  }
  return out;
}

const norm = (h: unknown) => String(h ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

/** Rows of every table that has a header containing `marker`, as header → text value. */
export function records(tables: Table[], marker: string): Record<string, string | null>[] {
  const out: Record<string, string | null>[] = [];
  for (const t of tables) {
    const hi = t.rows.findIndex((r) => r.some((c) => norm(c) === marker));
    if (hi < 0) continue;
    const h = t.rows[hi].map(norm);
    for (const r of t.rows.slice(hi + 1)) {
      const o: Record<string, string | null> = {};
      h.forEach((k, i) => {
        if (!k) return;
        const v = r[i];
        o[k] = v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim();
      });
      if (o[marker]) out.push(o);
    }
  }
  return out;
}
