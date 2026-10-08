import { CONSOLIDATION_COLUMNS, type GroupPnl } from '@/lib/budget/summary';
import { Num } from '@/components/num';

/** The Group P&L: entity columns, consolidation columns, entities outside the group (Monthly Summary, Consolidated). */
export function GroupTable({ pnl, year }: { pnl: GroupPnl; year: number }) {
  const { inside, outside, rows } = pnl;
  const n = inside.length + CONSOLIDATION_COLUMNS.length + outside.length;
  const sepAt = new Set([0, inside.length, inside.length + CONSOLIDATION_COLUMNS.length]);
  const groupCol = inside.length + CONSOLIDATION_COLUMNS.length - 1;
  return (
    <div className="frame">
      <table className="tbl">
        <thead>
          <tr className="tbl-band">
            <th className="stick" />
            <th className="sep" colSpan={inside.length}>
              Entities · {year}B
            </th>
            <th className="sep" colSpan={CONSOLIDATION_COLUMNS.length}>
              Consolidation
            </th>
            {outside.length > 0 && (
              <th className="sep" colSpan={outside.length}>
                Outside the group
              </th>
            )}
          </tr>
          <tr>
            <th className="stick stick-edge w-[300px]">Line</th>
            {[...inside.map((e) => e.label), ...CONSOLIDATION_COLUMNS, ...outside.map((e) => e.label)].map((h, i) => (
              <th key={h} className={`num w-[108px] ${sepAt.has(i) ? 'sep' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            r.kind === 'group' ? (
              <tr key={r.label} className="tbl-group">
                <td className="stick stick-edge">{r.label}</td>
                <td colSpan={n} />
              </tr>
            ) : (
              <tr key={r.label} className={r.kind === 'sub' ? 'tbl-sub' : r.kind === 'total' ? 'tbl-total' : ''}>
                <td className="stick stick-edge">
                  <div className="flex w-[280px] items-baseline gap-2 overflow-hidden">
                    <span className={`truncate ${r.kind === 'item' ? 'pl-3' : ''}`} title={r.label}>
                      {r.label}
                    </span>
                    {r.code && <span className="shrink-0 text-[11px] text-slate-400">{r.code}</span>}
                  </div>
                </td>
                {r.vals.map((v, i) => (
                  <Num key={i} v={v} bold={r.kind !== 'item' && i === groupCol} className={sepAt.has(i) ? 'sep' : ''} title={v === null ? 'Not budgeted yet' : undefined} />
                ))}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
