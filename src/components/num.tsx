import { fmt, pct } from '@/lib/format';

/** Right-aligned amount cell: brackets and red for negatives, a dash for zero. */
export function Num({ v, className = '', bold, title }: { v: number | null | undefined; className?: string; bold?: boolean; title?: string }) {
  if (v === null || v === undefined) return <td className={`na ${className}`} title={title ?? 'Not available'}>–</td>;
  return (
    <td className={`num ${v < -0.5 ? 'neg' : ''} ${bold ? 'font-semibold' : ''} ${className}`} title={title}>
      {fmt(v)}
    </td>
  );
}

/** Percentage cell; colour shows direction when `signed`. */
export function Pct({ v, className = '', signed, decimals = 1 }: { v: number | null | undefined; className?: string; signed?: boolean; decimals?: number }) {
  if (v === null || v === undefined || !Number.isFinite(v)) return <td className={`na ${className}`}>–</td>;
  const tone = signed ? (v < -0.0005 ? 'neg' : v > 0.0005 ? 'pos' : '') : '';
  return <td className={`num ${tone} ${className}`}>{pct(v, decimals)}</td>;
}
