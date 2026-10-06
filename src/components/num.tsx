import { fmt, pct } from '@/lib/format';

/** Right-aligned amount cell: brackets for negatives, a dash for zero. */
export function Num({ v, className = '', bold, title }: { v: number | null | undefined; className?: string; bold?: boolean; title?: string }) {
  if (v === null || v === undefined) return <td className={`na ${className}`} title={title ?? 'Not available'}>–</td>;
  return (
    <td className={`num ${bold ? 'font-semibold' : ''} ${className}`} title={title}>
      {fmt(v)}
    </td>
  );
}

/**
 * Percentage cell. When `signed`, it is a revenue variance (.anh-var): the glyph gives the direction,
 * a fall is underlined as adverse, and a fall past 10% is a solid chip. Never colour.
 */
export function Pct({ v, className = '', signed, decimals = 1 }: { v: number | null | undefined; className?: string; signed?: boolean; decimals?: number }) {
  if (v === null || v === undefined || !Number.isFinite(v)) return <td className={`na ${className}`}>–</td>;
  if (!signed || Math.abs(v) < 0.0005) return <td className={`num ${className}`}>{pct(v, decimals)}</td>;
  const dir = v > 0 ? 'anh-var--up' : 'anh-var--down is-adverse';
  return (
    <td className={`num ${className}`}>
      <span className={`anh-var ${dir} ${v < -0.1 ? 'is-breach' : ''}`}>{pct(v, decimals)}</span>
    </td>
  );
}
