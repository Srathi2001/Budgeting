// DataGrid: the read-only report table. A sticky header row and (by default) a sticky first column,
// numbers right-aligned in tabular figures, row kinds for group / subtotal / total lines, and simple
// windowing when there are many rows (fixed row height; only the rows near the viewport render).
// Entry grids keep AG Grid (Lease Budget) or their own cell editors; this is for lists and statements.
'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface GridColumn<T> {
  key: string;
  header: ReactNode;
  /** right for numbers (tabular figures) */
  align?: 'left' | 'right' | 'center';
  width?: number;
  /** a one-line definition of the column, shown on hover and read by assistive tech */
  title?: string;
  cell: (row: T, index: number) => ReactNode;
  /** the cell's own class (e.g. 'num', 'muted') */
  className?: string;
}

export type GridRowKind = 'group' | 'subtotal' | 'total' | 'muted';

export interface DataGridProps<T> {
  columns: GridColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  rowKind?: (row: T) => GridRowKind | undefined;
  /** the first column stays in view while scrolling sideways (default true) */
  stickyFirst?: boolean;
  /** the last column (row actions) stays in view on the right */
  stickyLast?: boolean;
  /** scroll inside this height instead of growing the page */
  maxHeight?: number | string;
  /** window the rows: on by default from 150 rows; needs a fixed `rowHeight` */
  virtual?: boolean;
  rowHeight?: number;
  caption?: string;
  /** shown instead of the body when there are no rows */
  empty?: ReactNode;
  /** compact rows (28 px) for dense lists */
  dense?: boolean;
  className?: string;
  onRowClick?: (row: T) => void;
}

const OVERSCAN = 12;

export function DataGrid<T>({ columns, rows, rowKey, rowKind, stickyFirst = true, stickyLast = false, maxHeight, virtual, rowHeight, caption, empty, dense = false, className = '', onRowClick }: DataGridProps<T>) {
  const rh = rowHeight ?? (dense ? 28 : 34);
  const windowed = virtual ?? rows.length > 150;
  const scroller = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ top: 0, height: 0 });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setRange({ top: el.scrollTop, height: el.clientHeight || window.innerHeight });
  }, []);
  useEffect(() => {
    if (!windowed) return;
    const el = scroller.current;
    if (!el) return;
    const id = requestAnimationFrame(measure);
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(id);
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [windowed, measure]);

  const { first, last } = useMemo(() => {
    if (!windowed) return { first: 0, last: rows.length };
    const f = Math.max(0, Math.floor(range.top / rh) - OVERSCAN);
    const l = Math.min(rows.length, Math.ceil((range.top + (range.height || 600)) / rh) + OVERSCAN);
    return { first: f, last: l };
  }, [windowed, range, rh, rows.length]);

  const style: CSSProperties | undefined = maxHeight ? { maxHeight } : windowed && !maxHeight ? { maxHeight: '70vh' } : undefined;
  const n = columns.length;

  return (
    <div ref={scroller} className={`ui-grid-wrap ${className}`} style={style}>
      <table className={`ui-grid ${dense ? 'ui-grid--dense' : ''} ${stickyFirst ? 'ui-grid--sticky-first' : ''} ${stickyLast ? 'ui-grid--sticky-last' : ''}`} style={windowed ? { ['--ui-grid-rh' as string]: `${rh}px` } : undefined}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`${c.align === 'right' ? 'num' : c.align === 'center' ? 'mid' : ''} ${c.className ?? ''}`} style={c.width ? { width: c.width, minWidth: c.width } : undefined} title={c.title}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!rows.length && (
            <tr>
              <td colSpan={n} className="ui-grid__empty">
                {empty ?? 'Nothing to show.'}
              </td>
            </tr>
          )}
          {windowed && first > 0 && (
            <tr aria-hidden="true" className="ui-grid__spacer">
              <td colSpan={n} style={{ height: first * rh }} />
            </tr>
          )}
          {rows.slice(first, last).map((r, i) => {
            const index = first + i;
            const kind = rowKind?.(r);
            return (
              <tr key={rowKey(r, index)} className={kind ? `is-${kind}` : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined} style={windowed ? { height: rh } : undefined}>
                {columns.map((c, j) =>
                  j === 0 ? (
                    <th key={c.key} scope="row" className={`${c.align === 'right' ? 'num' : ''} ${c.className ?? ''}`}>
                      {c.cell(r, index)}
                    </th>
                  ) : (
                    <td key={c.key} className={`${c.align === 'right' ? 'num' : c.align === 'center' ? 'mid' : ''} ${c.className ?? ''}`}>
                      {c.cell(r, index)}
                    </td>
                  ),
                )}
              </tr>
            );
          })}
          {windowed && last < rows.length && (
            <tr aria-hidden="true" className="ui-grid__spacer">
              <td colSpan={n} style={{ height: (rows.length - last) * rh }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
