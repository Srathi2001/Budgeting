'use client';

// Top bar "Export tables": every data table on the page, as shown (filters, open tabs, typed values),
// to an Excel file for checking: one sheet per table, named by its heading, amounts as numbers.
import { useState } from 'react';
import { XL, fmtDateTime } from '@/lib/format';

type Cell = string | number | null;

const PCT = /^-?[\d,]+(\.\d+)?%$/;
const NUM = /^\(?-?[\d,]*\.?\d+\)?$/;

/** the value of a cell as Excel should hold it */
function valueOf(td: HTMLTableCellElement): { v: Cell; z?: string } {
  const field = td.querySelector('input:not([type=checkbox]):not([type=file]), select, textarea') as HTMLInputElement | HTMLSelectElement | null;
  let text: string;
  if (field) text = field instanceof HTMLSelectElement ? (field.selectedOptions[0]?.text ?? field.value) : field.value;
  else {
    // the words as written (headings are styled upper case on screen), without markers and buttons
    const copy = td.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.fx, [aria-hidden="true"], svg, button').forEach((e) => e.remove());
    copy.querySelectorAll('br, div, p, li').forEach((e) => e.append(' '));
    text = copy.textContent ?? '';
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (!text || text === '—' || text === '·') return { v: null };
  const numeric = td.classList.contains('num') || td.classList.contains('anh-num');
  if (text === '-' && numeric) return { v: 0, z: XL.amount };
  if (PCT.test(text)) return { v: Number(text.replace(/[,%]/g, '')) / 100, z: XL.pct };
  if (NUM.test(text) && /\d/.test(text)) {
    const neg = text.startsWith('(') && text.endsWith(')');
    const n = Number(text.replace(/[(),]/g, ''));
    if (Number.isFinite(n)) return { v: neg ? -n : n, z: /\.\d/.test(text) || neg ? XL.amount : XL.count };
  }
  return { v: text };
}

/** the heading a table sits under: its own label, the closest section heading, else the page title */
function nameOf(table: HTMLTableElement): string {
  const own = table.getAttribute('data-export-name') ?? table.getAttribute('aria-label') ?? table.querySelector('caption')?.textContent;
  if (own) return own;
  for (let el: Element | null = table; el && el !== document.body; el = el.parentElement) {
    let sib = el.previousElementSibling;
    while (sib) {
      const h = sib.matches('h1,h2,h3,h4') ? sib : sib.querySelector('h1,h2,h3,h4');
      if (h?.textContent?.trim()) return h.textContent.trim();
      sib = sib.previousElementSibling;
    }
  }
  return document.querySelector('main h1')?.textContent?.trim() || 'Table';
}

export function ExportTables() {
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    const tables = [...document.querySelectorAll<HTMLTableElement>('main table')].filter(
      (t) => t.offsetParent !== null && !t.closest('[data-no-export]') && t.rows.length > 1,
    );
    if (!tables.length) {
      setMsg('No tables on this page');
      setTimeout(() => setMsg(null), 3000);
      return;
    }
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const crumbs = document.querySelector('.anh-crumbs')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const filters = document.querySelector('[data-filter-summary]')?.textContent?.trim() ?? '';
    const about = XLSX.utils.aoa_to_sheet([
      ['Page', crumbs],
      ['Filters', filters || 'None'],
      ['Exported', fmtDateTime(new Date())],
      ['Tables', tables.length],
    ]);
    about['!cols'] = [{ wch: 10 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, about, 'About');
    const used = new Set(['about']);
    for (const table of tables) {
      // grid with merged cells (colspan / rowspan) laid out as in the page
      const grid: Cell[][] = [];
      const fmt: (string | undefined)[][] = [];
      const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
      [...table.rows].forEach((tr, r) => {
        grid[r] ??= [];
        fmt[r] ??= [];
        let c = 0;
        for (const td of [...tr.cells]) {
          while (grid[r][c] !== undefined) c++;
          const { v, z } = valueOf(td);
          const cs = Math.max(td.colSpan, 1);
          const rs = Math.max(td.rowSpan, 1);
          for (let i = 0; i < rs; i++)
            for (let j = 0; j < cs; j++) {
              (grid[r + i] ??= [])[c + j] = i === 0 && j === 0 ? v : null;
              (fmt[r + i] ??= [])[c + j] = i === 0 && j === 0 ? z : undefined;
            }
          if (cs > 1 || rs > 1) merges.push({ s: { r, c }, e: { r: r + rs - 1, c: c + cs - 1 } });
          c += cs;
        }
      });
      const width = Math.max(...grid.map((row) => row.length));
      const rows = grid.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? null));
      const ws = XLSX.utils.aoa_to_sheet(rows);
      rows.forEach((row, r) =>
        row.forEach((_, c) => {
          const z = fmt[r]?.[c];
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (z && cell && typeof cell.v === 'number') cell.z = z;
        }),
      );
      if (merges.length) ws['!merges'] = merges;
      ws['!cols'] = Array.from({ length: width }, (_, c) => ({ wch: Math.min(Math.max(...rows.map((row) => String(row[c] ?? '').length), 6) + 2, 50) }));
      const head = table.tHead?.rows.length ?? 0;
      if (head) ws['!freeze'] = { xSplit: 0, ySplit: head };
      // sheet names: at most 31 characters, unique regardless of case
      const base = nameOf(table).replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim() || 'Table';
      let name = base.slice(0, 31);
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`;
      used.add(name.toLowerCase());
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    const page = (document.querySelector('.anh-crumbs b')?.textContent ?? document.title).replace(/[\\/?*:|"<>]/g, ' ').trim();
    XLSX.writeFile(wb, `${page} ${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-xs">{msg}</span>}
      <button className="anh-btn anh-btn--secondary anh-btn--sm" onClick={run} title="Every table on this page, as shown, to Excel (one sheet per table) for checking">
        Export tables
      </button>
    </span>
  );
}
