// One line for an audit_log `changes` value: `field: from → to` pairs joined by ·.
import { fmt } from './format';

export function describeChanges(changes: unknown): string {
  if (!changes || typeof changes !== 'object') return '';
  return Object.entries(changes as Record<string, unknown>)
    .map(([k, v]) => {
      if (v && typeof v === 'object' && 'from' in v && 'to' in v) {
        const c = v as { from: unknown; to: unknown };
        return `${k}: ${fmtVal(c.from)} → ${fmtVal(c.to)}`;
      }
      return `${k}: ${fmtVal(v)}`;
    })
    .join(' · ');
}

function fmtVal(v: unknown) {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'number') return fmt(v, Number.isInteger(v) ? 0 : 2);
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === 'object') return '{…}';
  return String(v);
}
