'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import type { AnalysisData, AnalysisProperty, AnalysisUnit } from '@/lib/budget/analysis';
import { MONTHS } from '@/lib/format';
import { Num, Pct } from '@/components/num';
import { PageHeader } from '@/components/ui/page-header';
import { saveNote } from './actions';
import { useFilters } from '@/components/filter-bar';
import { unitPasses } from '@/lib/filters';

// ---- dimensions ------------------------------------------------------------------------------

type Dim = 'bu' | 'pm' | 'category' | 'property' | 'unit';
const DIM_LABEL: Record<Dim, string> = { bu: 'Business unit', pm: 'Property manager', category: 'Category', property: 'Property', unit: 'Unit' };
const PRESETS: { label: string; dims: Dim[] }[] = [
  { label: 'BU › Property › Unit', dims: ['bu', 'property', 'unit'] },
  { label: 'PM › Property › Unit', dims: ['pm', 'property', 'unit'] },
  { label: 'Category › Property › Unit', dims: ['category', 'property', 'unit'] },
  { label: 'BU › Category › Property', dims: ['bu', 'category', 'property'] },
  { label: 'Property › Category › Unit', dims: ['property', 'category', 'unit'] },
];

type Period = 'Y' | 'Q' | 'M';

interface Node {
  key: string;
  dim: Dim;
  label: string;
  sub?: string;
  depth: number;
  units: AnalysisUnit[];
  children: Node[];
  property?: AnalysisProperty;
}

const sumArr = (rows: (number[] | null)[]) => {
  const out = Array(12).fill(0) as number[];
  let any = false;
  for (const r of rows)
    if (r) {
      any = true;
      r.forEach((v, i) => (out[i] += v));
    }
  return any ? out : null;
};
const total = (a: number[] | null) => (a ? a.reduce((x, y) => x + y, 0) : null);
const quarters = (a: number[]) => [0, 1, 2, 3].map((q) => a[q * 3] + a[q * 3 + 1] + a[q * 3 + 2]);

export function AnalysisPivot({ versionId, data, finance, locked }: { versionId: number; data: AnalysisData; finance: boolean; locked: boolean }) {
  const [dims, setDims] = useState<Dim[]>(PRESETS[0].dims);
  const [period, setPeriod] = useState<Period>('Y');
  const [sortBy, setSortBy] = useState<'name' | 'budget' | 'change'>('budget');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [depth, setDepth] = useState(1); // levels opened by "Show"
  const [msg, setMsg] = useState<string | null>(null);
  // the shared page filters scope every row and the total
  const { filters } = useFilters();
  const propMeta = useMemo(() => new Map(data.properties.map((p) => [p.id, p])), [data.properties]);
  const units = useMemo(
    () =>
      data.units.filter((u) => {
        const p = propMeta.get(u.propertyId)!;
        return unitPasses({ bu: p.bu, pm: p.pm, propertyId: u.propertyId, category: u.category }, filters);
      }),
    [data.units, propMeta, filters],
  );
  const { labels } = data;
  // the forecast: Oracle revenue actuals to the last month imported, Lease Budget projection after
  const forecastNote = (() => {
    if (!data.lastActual) return null;
    const m = Number(data.lastActual.slice(5));
    const name = (i: number) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i - 1];
    return m >= 12 ? `${labels.forecast}: actual Jan–Dec` : `${labels.forecast}: actual Jan–${name(m)} (Oracle) + ${name(m + 1)}–Dec projected from the Lease Budget`;
  })();

  const propById = useMemo(() => new Map(data.properties.map((p) => [p.id, p])), [data.properties]);
  // units per property, to tell whether a group holds whole properties (property-level figures)
  const unitsPerProperty = useMemo(() => {
    const m = new Map<number, number>();
    for (const u of data.units) m.set(u.propertyId, (m.get(u.propertyId) ?? 0) + 1);
    return m;
  }, [data.units]);

  const tree = useMemo(() => {
    const keyOf = (u: AnalysisUnit, d: Dim): [string, string, string?] => {
      const p = propById.get(u.propertyId)!;
      switch (d) {
        case 'bu':
          return [p.bu, `${p.bu} · ${p.buName}`];
        case 'pm':
          return [p.pm, p.pm.charAt(0) + p.pm.slice(1).toLowerCase()];
        case 'category':
          return [u.category, u.category];
        case 'property':
          return [String(p.id), p.name, p.code];
        case 'unit':
          return [u.key, u.unitCode, u.tenant ?? undefined];
      }
    };
    const build = (units: AnalysisUnit[], level: number, parentKey: string): Node[] => {
      if (level >= dims.length) return [];
      const d = dims[level];
      const groups = new Map<string, Node>();
      for (const u of units) {
        const [k, label, sub] = keyOf(u, d);
        const key = `${parentKey}/${d}:${k}`;
        let n = groups.get(key);
        if (!n) {
          n = { key, dim: d, label, sub, depth: level, units: [], children: [], property: d === 'property' ? propById.get(u.propertyId) : undefined };
          groups.set(key, n);
        }
        n.units.push(u);
      }
      const nodes = [...groups.values()];
      for (const n of nodes) n.children = build(n.units, level + 1, n.key);
      return nodes;
    };
    return build(units, 0, '');
  }, [units, dims, propById]);

  /** Figures for a node. Property-level comparatives only when the node holds whole properties. */
  const metrics = (n: Node) => {
    const budget = sumArr(n.units.map((u) => u.budget));
    const prior = data.priorSource ? sumArr(n.units.map((u) => u.prior)) : null;
    const counts = new Map<number, number>();
    for (const u of n.units) counts.set(u.propertyId, (counts.get(u.propertyId) ?? 0) + 1);
    const whole = [...counts.entries()].every(([pid, c]) => unitsPerProperty.get(pid) === c);
    const comp = (label: string) => {
      if (!whole) return null;
      let s = 0;
      let any = false;
      for (const pid of counts.keys()) {
        const v = propById.get(pid)?.comps[label];
        if (v !== null && v !== undefined) {
          s += v;
          any = true;
        }
      }
      return any ? s : null;
    };
    const priorTotal = data.priorSource ? total(prior) : comp(labels.prior);
    const units = n.units.filter((u) => u.budget).length;
    // property rows use the override when one is set
    const vl = n.dim === 'property' && n.property?.vacancyLossOverride !== null && n.property?.vacancyLossOverride !== undefined ? n.property.vacancyLossOverride : n.units.reduce((s, u) => s + u.vacancyLoss, 0);
    return {
      budget,
      budgetTotal: total(budget) ?? 0,
      priorTotal,
      forecast: comp(labels.forecast),
      actuals: labels.actuals.map(comp),
      units,
      vacancyLoss: vl,
      whole,
    };
  };

  const sortNodes = (nodes: Node[]) => {
    if (sortBy === 'name') return [...nodes].sort((a, b) => a.label.localeCompare(b.label));
    const m = new Map(nodes.map((n) => [n.key, metrics(n)]));
    if (sortBy === 'budget') return [...nodes].sort((a, b) => m.get(b.key)!.budgetTotal - m.get(a.key)!.budgetTotal);
    const chg = (k: string) => {
      const x = m.get(k)!;
      const base = x.forecast ?? x.priorTotal;
      return base ? x.budgetTotal - base : 0;
    };
    return [...nodes].sort((a, b) => chg(b.key) - chg(a.key));
  };

  const isOpen = (n: Node) => (expanded.has(n.key) ? true : expanded.has(`!${n.key}`) ? false : n.depth < depth);
  const toggle = (n: Node) =>
    setExpanded((s) => {
      const next = new Set(s);
      const open = isOpen(n);
      next.delete(n.key);
      next.delete(`!${n.key}`);
      if (open && n.depth < depth) next.add(`!${n.key}`);
      else if (!open && n.depth >= depth) next.add(n.key);
      return next;
    });
  const expandTo = (d: number) => {
    setDepth(d);
    setExpanded(new Set());
  };

  const grand = metrics({ key: 'all', dim: 'bu', label: 'Total', depth: -1, units, children: [] });
  const periods = period === 'M' ? MONTHS : period === 'Q' ? ['Q1', 'Q2', 'Q3', 'Q4'] : [];
  const byPeriod = (a: number[] | null) => (a ? (period === 'M' ? a : quarters(a)) : periods.map(() => null));

  const saveComment = (p: AnalysisProperty, comment: string | null) =>
    saveNote({ versionId, propertyId: p.id, comment, vacancyLossOverride: p.vacancyLossOverride })
      .then((r) => setMsg(r.error ?? 'Comment saved'))
      .catch((e: Error) => setMsg(e.message));

  const varCells = (budget: number, base: number | null) => (
    <>
      <Num v={base === null ? null : budget - base} />
      <Pct v={base ? (budget - base) / base : null} signed />
    </>
  );

  const renderRow = (n: Node): React.ReactNode => {
    const m = metrics(n);
    const open = isOpen(n);
    const hasKids = n.children.length > 0;
    return (
      <Fragment key={n.key}>
        <tr className={n.depth === 0 && dims.length > 1 ? 'lvl-0' : ''} role="row" aria-level={n.depth + 1} aria-expanded={hasKids ? open : undefined}>
          <td className="stick stick-edge" style={{ paddingLeft: 10 + n.depth * 18 }}>
            <div className="flex w-[300px] items-center gap-1.5 overflow-hidden">
              {hasKids ? (
                <button
                  type="button"
                  onClick={() => toggle(n)}
                  onKeyDown={(e) => {
                    // arrow keys as a tree: → opens, ← closes, * opens every row at this level
                    if (e.key === 'ArrowRight' && !open) toggle(n);
                    else if (e.key === 'ArrowLeft' && open) toggle(n);
                    else if (e.key === '*') expandTo(Math.min(n.depth + 1, dims.length - 1));
                    else return;
                    e.preventDefault();
                  }}
                  className="w-4 shrink-0 text-slate-500 hover:text-slate-900"
                  aria-expanded={open}
                  aria-label={`${open ? 'Collapse' : 'Expand'} ${n.label}`}
                >
                  <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                </button>
              ) : (
                <span className="w-4 shrink-0" />
              )}
              {n.dim === 'property' && n.property ? (
                <Link href={`/master?p=${n.property.id}`} className="truncate hover:text-sky-700 hover:underline" title={n.label}>
                  {n.label}
                </Link>
              ) : (
                <span className={n.sub ? 'max-w-[65%] shrink-0 truncate' : 'truncate'} title={n.label}>
                  {n.label}
                </span>
              )}
              {n.sub && (
                <span className="min-w-0 truncate text-[11px] text-slate-400" title={n.sub}>
                  {n.sub}
                </span>
              )}
            </div>
          </td>
          <td className="num muted">{n.dim === 'unit' ? '' : m.units}</td>
          {period === 'Y' ? (
            <>
              <Num v={m.budgetTotal} bold className="sep" />
              <Num v={m.forecast} className="sep" title={m.whole ? undefined : 'Forecast is held per property'} />
              {varCells(m.budgetTotal, m.forecast)}
              <Num v={m.priorTotal} className="sep" />
              {varCells(m.budgetTotal, m.priorTotal)}
              {m.actuals.map((a, i) => (
                <Num key={i} v={a} className={i === 0 ? 'sep' : ''} title={m.whole ? undefined : 'Actuals are held per property'} />
              ))}
              <Num v={m.vacancyLoss} className="sep" />
              <Pct v={m.budgetTotal ? m.vacancyLoss / m.budgetTotal : null} decimals={2} />
              <td className="sep wrap min-w-[260px] py-1">
                {n.dim === 'property' && n.property ? (
                  n.property.canComment && !locked ? (
                    <textarea
                      className="cell-edit block resize-none text-xs leading-snug"
                      rows={1}
                      defaultValue={n.property.comment ?? ''}
                      placeholder="Add comment…"
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null;
                        if (v !== n.property!.comment) saveComment(n.property!, v);
                      }}
                    />
                  ) : (
                    <span className="text-xs text-slate-600">{n.property.comment}</span>
                  )
                ) : null}
              </td>
            </>
          ) : (
            <>
              {byPeriod(m.budget).map((v, i) => (
                <Num key={i} v={v ?? 0} className={i === 0 ? 'sep' : ''} />
              ))}
              <Num v={m.budgetTotal} bold className="sep" />
              <Num v={m.priorTotal} className="sep" />
              {varCells(m.budgetTotal, m.priorTotal)}
            </>
          )}
        </tr>
        {open && sortNodes(n.children).map(renderRow)}
      </Fragment>
    );
  };

  const head =
    period === 'Y' ? (
      <>
        <tr className="tbl-band">
          <th className="stick" colSpan={2} />
          <th className="sep">Budget</th>
          <th className="sep" colSpan={3}>
            vs {labels.forecast} (forecast)
          </th>
          <th className="sep" colSpan={3}>
            vs {labels.prior} (budget)
          </th>
          <th className="sep" colSpan={labels.actuals.length}>
            Actuals
          </th>
          <th className="sep" colSpan={2}>
            Vacancy
          </th>
          <th className="sep" />
        </tr>
        <tr>
          <th className="stick stick-edge w-[330px]">{dims.map((d) => DIM_LABEL[d]).join(' › ')}</th>
          <th className="num w-14">Units</th>
          <th className="num sep w-28">{labels.budget}</th>
          <th className="num sep w-28" title={forecastNote ?? undefined}>
            {labels.forecast}
          </th>
          <th className="num w-24">Change</th>
          <th className="num w-16">%</th>
          <th className="num sep w-28">{labels.prior}</th>
          <th className="num w-24">Change</th>
          <th className="num w-16">%</th>
          {labels.actuals.map((l, i) => (
            <th key={l} className={`num w-28 ${i === 0 ? 'sep' : ''}`}>
              {l}
            </th>
          ))}
          <th className="num sep w-24">Loss</th>
          <th className="num w-16">% of B</th>
          <th className="sep">Comments</th>
        </tr>
      </>
    ) : (
      <>
        <tr className="tbl-band">
          <th className="stick" colSpan={2} />
          <th className="sep" colSpan={periods.length + 1}>
            {labels.budget} by {period === 'M' ? 'month' : 'quarter'}
          </th>
          <th className="sep" colSpan={3}>
            vs {labels.prior}
          </th>
        </tr>
        <tr>
          <th className="stick stick-edge w-[330px]">{dims.map((d) => DIM_LABEL[d]).join(' › ')}</th>
          <th className="num w-14">Units</th>
          {periods.map((p, i) => (
            <th key={p} className={`num ${period === 'M' ? 'w-24' : 'w-28'} ${i === 0 ? 'sep' : ''}`}>
              {p}
            </th>
          ))}
          <th className="num sep w-28">Total</th>
          <th className="num sep w-28">{labels.prior}</th>
          <th className="num w-24">Change</th>
          <th className="num w-16">%</th>
        </tr>
      </>
    );

  const totalRow = (
    <tr className="tbl-total">
      <td className="stick stick-edge">Total</td>
      <td className="num">{grand.units}</td>
      {period === 'Y' ? (
        <>
          <Num v={grand.budgetTotal} className="sep" />
          <Num v={grand.forecast} className="sep" />
          {varCells(grand.budgetTotal, grand.forecast)}
          <Num v={grand.priorTotal} className="sep" />
          {varCells(grand.budgetTotal, grand.priorTotal)}
          {grand.actuals.map((a, i) => (
            <Num key={i} v={a} className={i === 0 ? 'sep' : ''} />
          ))}
          <Num v={grand.vacancyLoss} className="sep" />
          <Pct v={grand.budgetTotal ? grand.vacancyLoss / grand.budgetTotal : null} decimals={2} />
          <td className="sep" />
        </>
      ) : (
        <>
          {byPeriod(grand.budget).map((v, i) => (
            <Num key={i} v={v ?? 0} className={i === 0 ? 'sep' : ''} />
          ))}
          <Num v={grand.budgetTotal} className="sep" />
          <Num v={grand.priorTotal} className="sep" />
          {varCells(grand.budgetTotal, grand.priorTotal)}
        </>
      )}
    </tr>
  );

  return (
    <div className="anh-main">
      <PageHeader
        eyebrow="Revenue"
        title="Revenue Analysis"
        sub={`${labels.budget} vs ${labels.forecast}, ${labels.prior} and actuals ${labels.actuals.join(', ')} · AED ex VAT`}
        actions={
          <>
            {finance && (
              <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin?tab=comparatives">
                Comparatives
              </Link>
            )}
            <a className="ui-btn ui-btn--secondary ui-btn--sm" href="/api/export/analysis">
              Export to Excel
            </a>
          </>
        }
      />

      <div className="card flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2 text-[13px]">
        <label className="flex items-center gap-2">
          <span className="text-slate-500">Rows</span>
          <select
            className="input"
            value={PRESETS.find((p) => p.dims.join() === dims.join())?.label ?? 'custom'}
            onChange={(e) => {
              const p = PRESETS.find((x) => x.label === e.target.value);
              if (p) {
                setDims(p.dims);
                expandTo(1);
              }
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.label}>{p.label}</option>
            ))}
            {!PRESETS.some((p) => p.dims.join() === dims.join()) && <option value="custom">Custom</option>}
          </select>
        </label>
        <div className="flex items-center gap-1">
          {dims.map((d, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-400">›</span>}
              <select
                className="input py-0.5"
                value={d}
                onChange={(e) => {
                  const next = [...dims];
                  next[i] = e.target.value as Dim;
                  setDims(next.filter((x, j) => next.indexOf(x) === j));
                  expandTo(Math.min(depth, next.length - 1));
                }}
              >
                {(Object.keys(DIM_LABEL) as Dim[]).map((x) => (
                  <option key={x} value={x} disabled={x !== d && dims.includes(x)}>
                    {DIM_LABEL[x]}
                  </option>
                ))}
              </select>
              {dims.length > 1 && (
                <button
                  className="text-slate-400 hover:text-red-600"
                  title="Remove level"
                  onClick={() => {
                    setDims(dims.filter((_, j) => j !== i));
                    expandTo(Math.min(depth, dims.length - 2));
                  }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {dims.length < 5 && (
            <button
              className="btn btn-xs ml-1"
              onClick={() => {
                const free = (Object.keys(DIM_LABEL) as Dim[]).find((x) => !dims.includes(x));
                if (free) setDims([...dims, free]);
              }}
            >
              + Level
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-500">Show</span>
          <div className="seg">
            {dims.map((d, i) => (
              <button key={d} className={depth === i ? 'on' : ''} onClick={() => expandTo(i)} title={`Roll up / down to ${DIM_LABEL[d]} level`}>
                {DIM_LABEL[d]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-500">Period</span>
          <div className="seg">
            {(['Y', 'Q', 'M'] as Period[]).map((p) => (
              <button key={p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>
                {{ Y: 'Year', Q: 'Quarter', M: 'Month' }[p]}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-slate-500">Sort</span>
          <select className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
            <option value="budget">{labels.budget} (high → low)</option>
            <option value="change">Change (high → low)</option>
            <option value="name">Name</option>
          </select>
        </label>
        {msg && <span className="ml-auto text-xs text-slate-500">{msg}</span>}
      </div>

      <div className="frame frame-tall">
        <table className="tbl" role="treegrid" aria-label={`Revenue analysis by ${dims.map((d) => DIM_LABEL[d]).join(', ')}`} aria-rowcount={-1}>
          <thead>{head}</thead>
          <tbody>
            {sortNodes(tree).map(renderRow)}
            {totalRow}
          </tbody>
        </table>
      </div>
      <section className="ui-defs" aria-labelledby="defs-h">
        <h2 id="defs-h" className="ui-defs__title">
          What the columns mean
        </h2>
        <dl>
          <div>
            <dt>{labels.budget}</dt>
            <dd>This version&rsquo;s rent, recognised by day over each lease, ex VAT. Held per unit, so it drills to any level.</dd>
          </div>
          <div>
            <dt>{labels.forecast}</dt>
            <dd>{forecastNote ?? 'Current-year forecast: actuals to the cut-off, then the Lease Budget projection.'} Held per property: shown for properties and groups of whole properties, “–” below property level.</dd>
          </div>
          <div>
            <dt>{labels.prior}</dt>
            <dd>The prior budget{data.priorSource ? ` (${data.priorSource.name})` : ''}, per unit.</dd>
          </div>
          <div>
            <dt>Change, %</dt>
            <dd>{labels.budget} minus the comparator, and that change as a share of the comparator. Blank when the comparator is not held at this level.</dd>
          </div>
          <div>
            <dt>Actuals ({labels.actuals.join(', ')})</dt>
            <dd>Oracle recognised rent from the Revenue Recognition Summary, per property.</dd>
          </div>
          <div>
            <dt>Vacancy loss, % of B</dt>
            <dd>Rent lost between a lease ending and the next tenant starting, at the new rent; and that loss as a share of {labels.budget}. A typed override replaces the calculated figure.</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
