// Building blocks of the Summary tabs (Lease Budget, FM Budget, Building Overheads, Admin Overheads):
// cards, reporting tables whose first cell can open the line it sums up, and the list of points to
// check. Plain markup on the design system's classes; the charts come from components/charts.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { fmt, pctSigned } from '@/lib/format';

export type SumCell = string | number | null;

export const sum = (a: (number | null | undefined)[]) => a.reduce<number>((s, v) => s + (v ?? 0), 0);
/** a change against a comparator, signed (+12.35%); '–' without one */
export const change = (b: number | null, base: number | null) => (b === null || base === null || !base ? '–' : pctSigned((b - base) / Math.abs(base)));

export function SummaryHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <header className="anh-pagehead">
      <div>
        <span className="anh-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="page-sub mt-1">{sub}</p>
      </div>
    </header>
  );
}

export function Card({ title, sub, children, className = '' }: { title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`anh-card ${className}`}>
      <header className="anh-card__head">
        <div className="min-w-0">
          <h2 className="anh-card__title">{title}</h2>
          {sub && <p className="anh-card__sub">{sub}</p>}
        </div>
      </header>
      <div className="anh-card__body">{children}</div>
    </section>
  );
}

export interface SumRow {
  cells: SumCell[];
  kind?: 'section' | 'subtotal' | 'total';
  /** the first cell opens this page (the line in its input tab) */
  href?: string;
}

/** A reporting table: first column text, numbers formatted as amounts unless `int` (whole counts). */
export function SummaryTable({ head, rows, int = [], className = 'max-h-[28rem]' }: { head: string[]; rows: SumRow[]; int?: number[]; className?: string }) {
  return (
    <div className={`anh-grid-wrap ${className}`}>
      <table className="anh-grid">
        <thead>
          <tr className="h1">
            {head.map((h, i) => (
              <th key={h + i} className={i ? 'anh-num' : ''}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.kind ?? 'child'}>
              {r.cells.map((c, j) => {
                const text = c === null ? '–' : typeof c === 'number' ? (int.includes(j) ? Math.round(c).toLocaleString('en-US') : fmt(c)) : c;
                return (
                  <td key={j} className={j && (typeof c === 'number' || c === null || /^[+−-]?[\d.,]+%$|^–$/.test(String(c))) ? 'anh-num' : ''}>
                    {j === 0 && r.href ? (
                      <Link href={r.href} className="underline decoration-[var(--line-strong)] underline-offset-2 hover:decoration-[var(--ink)]">
                        {text}
                      </Link>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={head.length}>Nothing for this selection</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export interface CheckItem {
  /** what to look at, e.g. the building */
  what: string;
  /** why */
  why: string;
  href?: string;
}

/** Points worth a second look, grouped by the rule that raised them. */
export function CheckList({ groups }: { groups: { title: string; items: CheckItem[] }[] }) {
  const shown = groups.filter((g) => g.items.length);
  if (!shown.length) return <p className="text-[13px]">Nothing stands out.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {shown.map((g) => (
        <div key={g.title}>
          <h3 className="mb-1 text-[13px] font-bold text-[var(--ink)]">
            {g.title} <span className="font-normal tabular-nums">({g.items.length})</span>
          </h3>
          <ul className="max-h-64 space-y-0.5 overflow-auto text-[12px]">
            {g.items.map((it, i) => (
              <li key={i} className="flex gap-2 border-b border-[var(--line)] py-1">
                <span className="min-w-0 flex-1 truncate" title={it.what}>
                  {it.href ? (
                    <Link href={it.href} className="underline decoration-[var(--line-strong)] underline-offset-2 hover:decoration-[var(--ink)]">
                      {it.what}
                    </Link>
                  ) : (
                    it.what
                  )}
                </span>
                <span className="shrink-0 tabular-nums text-[var(--ink-2)]">{it.why}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
