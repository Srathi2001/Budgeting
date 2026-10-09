// The statement table shared by Monthly Summary (income & expenses, cash flow), Consolidated (cash flow
// by quarter) and the P&L pages: a sticky first column of labelled lines (group headings, items,
// subtotals, totals, running balances), one column per period, a year total, and a basis line that
// says what the numbers are (units, VAT, recognition) so no reader has to guess.
import type { ReactNode } from 'react';
import type { StatementLine } from '@/lib/budget/summary';
import { MONTHS, sum } from '@/lib/format';
import { Num } from '@/components/num';

export type Period = 'month' | 'quarter';
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

export function periodLabels(period: Period, yy: string): string[] {
  return (period === 'month' ? MONTHS : QUARTERS).map((p) => `${p}-${yy}`);
}

/** The value of a line in one period: months as they are; quarters summed, or the quarter-end value of a running balance. */
function periodValue(l: StatementLine, period: Period, i: number): number | null {
  if (!l.vals) return null;
  if (period === 'month') return l.vals[i];
  return l.noTotal ? l.vals[i * 3 + 2] : sum(l.vals.slice(i * 3, i * 3 + 3));
}

export function StatementHead({ period, yy, first, firstWidth = 320 }: { period: Period; yy: string; first: ReactNode; firstWidth?: number }) {
  const labels = periodLabels(period, yy);
  return (
    <thead>
      <tr>
        <th className="stick stick-edge" style={{ width: firstWidth }} scope="col">
          {first}
        </th>
        {labels.map((h, i) => (
          <th key={h} className={`num ${period === 'month' ? 'w-[92px]' : 'w-[110px]'} ${i === 0 ? 'sep' : ''}`} scope="col">
            {h}
          </th>
        ))}
        <th className="num sep w-[110px]" scope="col">
          {period === 'month' ? 'Total' : 'Year'}
        </th>
      </tr>
    </thead>
  );
}

export interface StatementTableProps {
  lines: StatementLine[];
  period: Period;
  /** two-digit year for the column heads */
  yy: string;
  /** the first column's heading */
  head: string;
  /** what the numbers are: units, VAT, recognition rules; shown under the table */
  basis?: ReactNode;
  /** scrolls inside the viewport (long statements) */
  tall?: boolean;
  caption?: string;
}

export function StatementTable({ lines, period, yy, head, basis, tall = false, caption }: StatementTableProps) {
  const n = period === 'month' ? 12 : 4;
  return (
    <figure className="ui-statement">
      <div className={`frame ${tall ? 'frame-tall' : ''}`}>
        <table className="tbl">
          {caption && <caption className="sr-only">{caption}</caption>}
          <StatementHead period={period} yy={yy} first={head} />
          <tbody>
            {lines.map((l) =>
              l.kind === 'group' ? (
                <tr key={l.label} className="tbl-group">
                  <th scope="rowgroup" className="stick stick-edge text-left">
                    {l.label}
                  </th>
                  <td colSpan={n + 1} />
                </tr>
              ) : (
                <tr key={l.label} className={l.kind === 'sub' ? 'tbl-sub' : l.kind === 'total' ? 'tbl-total' : ''}>
                  <th scope="row" className={`stick stick-edge text-left font-normal ${l.kind === 'muted' ? 'anh-muted' : ''}`}>
                    <div className="flex items-baseline gap-2 overflow-hidden" style={{ width: 300 }}>
                      <span className={`truncate ${l.kind === 'item' ? 'pl-3' : ''}`} title={l.label}>
                        {l.label}
                      </span>
                      {l.code && <span className="anh-muted shrink-0 text-[11px]">{l.code}</span>}
                    </div>
                  </th>
                  {Array.from({ length: n }, (_, i) => (
                    <Num key={i} v={periodValue(l, period, i)} className={i === 0 ? 'sep' : ''} title={l.vals ? undefined : 'Not budgeted yet'} />
                  ))}
                  {l.noTotal ? <td className="sep" /> : <Num v={l.vals ? sum(l.vals) : null} bold={l.kind !== 'item'} className="sep" title={l.vals ? undefined : 'Not budgeted yet'} />}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {basis && <figcaption className="ui-basis">{basis}</figcaption>}
    </figure>
  );
}

/** The one-line basis under a statement or at the foot of a page: what the figures are. */
export function Basis({ children }: { children: ReactNode }) {
  return <p className="ui-basis">{children}</p>;
}
