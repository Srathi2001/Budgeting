'use client';

// Small SVG chart kit on the Al Naboodah design system (design-system/README.md, Charts).
// Square marks, 2px surface gap between touching marks, hairline grid with a 2px baseline, text in
// ink tokens (never the series colour), legend on every chart, hover tooltip, table view on every
// card. Colours come from the registries in lib/segments, as CSS variables, so both themes follow.

import { useEffect, useRef, useState, type ReactNode } from 'react';

const INK = { primary: 'var(--ink)', secondary: 'var(--ink-2)', muted: 'var(--ink-muted)' };
const GRID = 'var(--chart-grid)';
const BASE = 'var(--line-strong)';
const SURFACE = 'var(--surface)';

export function compact(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M` : a >= 1e3 ? `${Math.round(a / 1e3)}K` : `${Math.round(a)}`;
  return n < 0 ? `−${s}` : s;
}
const full = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);

/** Tooltip amount: short and readable (AED 12.71M, AED 845.2K, AED 950). */
export function aed(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : `${Math.round(a)}`;
  return `${n < 0 ? '−' : ''}AED ${s}`;
}
/** A difference: signed (+AED 1.20M / −AED 6.28M). */
export const aedDiff = (n: number) => (n > 0 ? `+${aed(n)}` : aed(n));

type TipRow = { color?: string; label: string; value: string };
/** Tooltip rows: no empty or zero rows, so only what matters at that point is listed. */
const keep = (rows: (TipRow & { v?: number | null })[]): TipRow[] =>
  rows.filter((r) => r.v === undefined || (r.v !== null && Math.abs(r.v) >= 0.5)).map((r) => ({ color: r.color, label: r.label, value: r.value }));

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Clean axis ticks: 0 and 3-5 round steps up to max. */
function ticks(max: number, min = 0): number[] {
  const span = Math.max(max - min, 1);
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // whole-number steps only: every axis here is AED or %, and fractional steps round to duplicate labels
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= 5)!);
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** Square bar; nothing drawn when it has no size. */
function Bar({ x, y, w, h, color }: { x: number; y: number; w: number; h: number; color: string }) {
  if (w <= 0 || h <= 0) return null;
  return <rect x={x} y={y} width={w} height={h} style={{ fill: color }} />;
}

interface Tip {
  x: number;
  y: number;
  title: string;
  rows: TipRow[];
}

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x + 14, 4), Math.max(width - 210, 4));
  return (
    <div className="anh-tip" style={{ left, top: Math.max(tip.y - 10, 0) }}>
      <b>{tip.title}</b>
      {tip.rows.map((r) => (
        <div key={r.label} className="row">
          <span className="flex items-center gap-1.5">
            {r.color && <span className="inline-block h-2 w-2 shrink-0" style={{ background: r.color, boxShadow: '0 0 0 1px var(--ink-inverse)' }} />}
            {r.label}
          </span>
          <span className="font-semibold">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items, shape = 'rect' }: { items: { label: string; color: string; dash?: boolean }[]; shape?: 'rect' | 'line' }) {
  return (
    <ul className="anh-legend">
      {items.map((i) => (
        <li key={i.label}>
          <i style={shape === 'rect' ? { background: i.color } : { width: 20, height: 0, borderTop: `${i.dash ? '2px dashed' : '2.5px solid'} ${i.color}` }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Chart card (.anh-card) with a chart / table toggle (every chart has a table twin). */
export function ChartCard({
  title,
  sub,
  legend,
  table,
  children,
  className = '',
}: {
  title: string;
  sub?: string;
  legend?: ReactNode;
  table: { head: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className={`anh-card ${className}`}>
      <header className="anh-card__head">
        <div className="min-w-0">
          <h2 className="anh-card__title">{title}</h2>
          {sub && <p className="anh-card__sub">{sub}</p>}
        </div>
        <div className="anh-seg shrink-0" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
            Chart
          </button>
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>
            Table
          </button>
        </div>
      </header>
      <div className="anh-card__body">
        {view === 'chart' ? (
          <>
            {legend && <div className="mb-3">{legend}</div>}
            {children}
          </>
        ) : (
          <div className="anh-grid-wrap max-h-80">
            <table className="anh-grid">
              <thead>
                <tr className="h1">
                  {table.head.map((h, i) => (
                    <th key={h} className={i ? 'anh-num' : ''}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className={j ? 'anh-num' : ''}>
                        {typeof c === 'number' ? full(c) : c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

const PAD = { l: 52, r: 16, t: 10, b: 26 };

function YAxis({ ys, y, w, fmt = compact }: { ys: number[]; y: (v: number) => number; w: number; fmt?: (n: number) => string }) {
  return (
    <g>
      {ys.map((v, i) => (
        <g key={v}>
          <line
            x1={PAD.l}
            x2={w - PAD.r}
            y1={y(v)}
            y2={y(v)}
            style={{ stroke: i === 0 ? BASE : GRID }}
            strokeWidth={i === 0 ? 2 : 1}
            shapeRendering="crispEdges"
          />
          <text x={PAD.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} style={{ fill: INK.muted }} className="tabular-nums">
            {fmt(v)}
          </text>
        </g>
      ))}
    </g>
  );
}

// ---- line chart (crosshair + one tooltip for every series) ------------------------------------

export function LineChart({
  labels,
  series,
  height = 220,
  fmt = compact,
  tipFmt = aed,
  diffLabel,
  min,
}: {
  labels: string[];
  /** `dash`: a comparator line (budget, prior year), drawn dashed */
  series: { name: string; color: string; values: (number | null)[]; width?: number; dash?: boolean }[];
  height?: number;
  fmt?: (n: number) => string;
  /** tooltip value format (default: short AED) */
  tipFmt?: (n: number) => string;
  /** adds a tooltip line: last series − first series, with this label */
  diffLabel?: string;
  min?: number;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const ys = ticks(Math.max(...all, 1), min ?? Math.min(0, ...all));
  const lo = ys[0];
  const hi = ys[ys.length - 1];
  const x = (i: number) => PAD.l + ((w - PAD.l - PAD.r) * (i + 0.5)) / labels.length;
  const y = (v: number) => PAD.t + (height - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo || 1));
  const tip: Tip | null =
    hover === null
      ? null
      : {
          x: x(hover),
          y: PAD.t,
          title: labels[hover],
          rows: [
            ...keep(series.map((s) => ({ color: s.color, label: s.name, value: s.values[hover] === null ? '–' : tipFmt(s.values[hover]!), v: s.values[hover] }))),
            ...(diffLabel && series.length > 1 && series[0].values[hover] !== null && series[series.length - 1].values[hover] !== null
              ? [{ label: diffLabel, value: aedDiff(series[series.length - 1].values[hover]! - series[0].values[hover]!) }]
              : []),
          ],
        };
  return (
    <div ref={ref} className="relative" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={series.map((s) => s.name).join(' vs ')}>
          <YAxis ys={ys} y={y} w={w} fmt={fmt} />
          {labels.map((l, i) => (
            <text key={l} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} style={{ fill: INK.muted }}>
              {l}
            </text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={height - PAD.b} style={{ stroke: INK.primary }} strokeWidth={1} shapeRendering="crispEdges" />}
          {series.map((s) => {
            const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
            return (
              <polyline
                key={s.name}
                points={pts.join(' ')}
                fill="none"
                style={{ stroke: s.color }}
                strokeWidth={s.width ?? (s.dash ? 2 : 2.5)}
                strokeDasharray={s.dash ? '6 4' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}
          {hover !== null &&
            series.map((s) =>
              s.values[hover] === null ? null : <circle key={s.name} cx={x(hover)} cy={y(s.values[hover]!)} r={4} style={{ fill: s.color, stroke: SURFACE }} strokeWidth={2} />,
            )}
          {/* end marker on the last point */}
          {series.map((s) => {
            const i = s.values.length - 1;
            const v = s.values[i];
            return v === null ? null : <circle key={`e-${s.name}`} cx={x(i)} cy={y(v)} r={4} style={{ fill: s.color, stroke: SURFACE }} strokeWidth={2} />;
          })}
          <rect
            x={PAD.l}
            y={PAD.t}
            width={Math.max(w - PAD.l - PAD.r, 0)}
            height={height - PAD.t - PAD.b}
            fill="transparent"
            className="cursor-crosshair"
            onPointerMove={(e) => {
              const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
              const i = Math.floor(((e.clientX - r.left) / r.width) * labels.length);
              setHover(Math.max(0, Math.min(labels.length - 1, i)));
            }}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      <Tooltip tip={tip} width={w} />
    </div>
  );
}

// ---- grouped / stacked columns -------------------------------------------------------------------

export function Columns({
  labels,
  series,
  lines = [],
  stacked = false,
  height = 220,
  fmt = compact,
  tipFmt = aed,
  totalLabel = 'Total',
  diffLabel,
}: {
  labels: string[];
  series: { name: string; color: string; values: number[] }[];
  /** measures drawn as a line over the columns, on the same axis (null = no point that month) */
  lines?: { name: string; color: string; values: (number | null)[] }[];
  stacked?: boolean;
  height?: number;
  fmt?: (n: number) => string;
  /** value format in the tooltip (default: short AED) */
  tipFmt?: (n: number) => string;
  /** stacked: the tooltip's total line */
  totalLabel?: string;
  /** grouped: adds a tooltip line, last series − first series, with this label */
  diffLabel?: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const totals = labels.map((_, i) => series.reduce((s, x) => s + Math.max(x.values[i], 0), 0));
  const lineMax = Math.max(0, ...lines.flatMap((l) => l.values.filter((v): v is number => v !== null)));
  const max = Math.max(stacked ? Math.max(...totals, 1) : Math.max(...series.flatMap((s) => s.values), 1), lineMax);
  const ys = ticks(max);
  const hi = ys[ys.length - 1];
  const band = (w - PAD.l - PAD.r) / labels.length;
  const y = (v: number) => PAD.t + (height - PAD.t - PAD.b) * (1 - v / (hi || 1));
  const n = stacked ? 1 : series.length;
  const bw = Math.min(24, (band * 0.7 - (n - 1) * 2) / n);
  const tip: Tip | null =
    hover === null
      ? null
      : {
          x: PAD.l + band * hover + band / 2,
          y: PAD.t,
          title: labels[hover],
          rows: [
            // stacked: the total first, then only the parts that have a value
            ...(stacked && series.length > 1 ? [{ label: totalLabel, value: tipFmt(totals[hover]) }] : []),
            ...keep(series.map((s) => ({ color: s.color, label: s.name, value: tipFmt(s.values[hover]), v: s.values[hover] }))),
            ...(!stacked && diffLabel && series.length > 1 ? [{ label: diffLabel, value: aedDiff(series[series.length - 1].values[hover] - series[0].values[hover]) }] : []),
            ...keep(lines.map((l) => ({ color: l.color, label: l.name, value: l.values[hover] === null ? '–' : tipFmt(l.values[hover]!), v: l.values[hover] }))),
          ],
        };
  return (
    <div ref={ref} className="relative" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img">
          <YAxis ys={ys} y={y} w={w} fmt={fmt} />
          {labels.map((l, i) => {
            const cx = PAD.l + band * i + band / 2;
            const groupW = n * bw + (n - 1) * 2;
            let acc = 0;
            return (
              <g key={l} opacity={hover === null || hover === i ? 1 : 0.55}>
                {series.map((s, k) => {
                  const v = Math.max(s.values[i], 0);
                  if (stacked) {
                    const y0 = y(acc);
                    acc += v;
                    const y1 = y(acc);
                    // 2px surface gap between stacked segments
                    const h = Math.max(y0 - y1 - (k > 0 ? 2 : 0), 0);
                    return <Bar key={s.name} x={cx - bw / 2} y={y1} w={bw} h={h} color={s.color} />;
                  }
                  const x0 = cx - groupW / 2 + k * (bw + 2);
                  return <Bar key={s.name} x={x0} y={y(v)} w={bw} h={y(0) - y(v)} color={s.color} />;
                })}
                <text x={cx} y={height - 8} textAnchor="middle" fontSize={11} style={{ fill: INK.muted }}>
                  {l}
                </text>
              </g>
            );
          })}
          {/* lines over the columns: 2px, with a surface-ringed marker on each point */}
          {lines.map((l) => {
            const pts = l.values.map((v, i) => (v === null ? null : ([PAD.l + band * i + band / 2, y(v)] as const)));
            const path = pts.reduce((d, p, i) => (p ? `${d}${d && pts[i - 1] ? 'L' : 'M'}${p[0]},${p[1]}` : d), '');
            return (
              <g key={l.name} pointerEvents="none">
                <path d={path} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" />
                {pts.map((p, i) =>
                  p ? <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 5 : 4} fill={l.color} stroke="var(--surface)" strokeWidth={2} /> : null,
                )}
              </g>
            );
          })}
          {/* hover targets: the whole column band */}
          {labels.map((l, i) => (
            <rect
              key={l}
              x={PAD.l + band * i}
              y={PAD.t}
              width={band}
              height={height - PAD.t - PAD.b}
              fill="transparent"
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            />
          ))}
        </svg>
      )}
      <Tooltip tip={tip} width={w} />
    </div>
  );
}

// ---- horizontal bars (ranked list), stacked or diverging ---------------------------------------

export function HBars({
  rows,
  series,
  diverging = false,
  labelWidth = 170,
  fmt = compact,
  tipFmt = aed,
  note,
  noteLabel = 'Change',
}: {
  rows: { label: string; values: number[]; note?: string }[];
  series: { name: string; color: string }[];
  /** bars either side of a zero rule; position gives the direction, the colour stays the series' own */
  diverging?: boolean;
  labelWidth?: number;
  fmt?: (n: number) => string;
  /** value format in the tooltip (default: short AED) */
  tipFmt?: (n: number) => string;
  note?: (row: { label: string; values: number[]; note?: string }) => string | undefined;
  /** what a row's note is, in the tooltip */
  noteLabel?: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const rowH = 26;
  const height = rows.length * rowH + 4;
  // room right of the longest bar for its value (and note, when there is one)
  const valW = note && rows.some((r) => note(r)) ? 120 : 64;
  const plotW = Math.max(w - labelWidth - valW - 8, 10);
  const totals = rows.map((r) => r.values.reduce((s, v) => s + v, 0));
  const maxAbs = Math.max(...totals.map(Math.abs), 1);
  const x0 = diverging ? labelWidth + plotW / 2 : labelWidth;
  const scale = (diverging ? plotW / 2 : plotW) / maxAbs;
  const bh = Math.min(16, rowH - 8);
  const tip: Tip | null =
    hover === null
      ? null
      : {
          x: labelWidth,
          y: hover * rowH + rowH,
          title: rows[hover].label,
          rows:
            series.length > 1
              ? [
                  { label: 'Total', value: tipFmt(totals[hover]) },
                  ...keep(series.map((s, k) => ({ color: s.color, label: s.name, value: tipFmt(rows[hover].values[k]), v: rows[hover].values[k] }))),
                ]
              : [
                  { color: series[0].color, label: series[0].name, value: diverging ? aedDiff(totals[hover]) : tipFmt(totals[hover]) },
                  ...(rows[hover].note ? [{ label: noteLabel, value: rows[hover].note! }] : []),
                ],
        };
  return (
    <div ref={ref} className="relative" style={{ height: rows.length ? height : 80 }}>
      {!rows.length && <div className="py-8 text-center text-xs text-slate-500">No data for this selection</div>}
      {w > 0 && rows.length > 0 && (
        <svg width={w} height={height} role="img">
          <line x1={x0} x2={x0} y1={0} y2={height} style={{ stroke: BASE }} strokeWidth={diverging ? 1 : 2} shapeRendering="crispEdges" />
          {rows.map((r, i) => {
            const cy = i * rowH + rowH / 2;
            const t = totals[i];
            let acc = 0;
            const end = x0 + t * scale;
            const extra = note?.(r);
            return (
              <g key={r.label + i} opacity={hover === null || hover === i ? 1 : 0.55}>
                <text x={labelWidth - 10} y={cy} dy="0.32em" textAnchor="end" fontSize={12} style={{ fill: INK.secondary }}>
                  {r.label.length > 24 ? `${r.label.slice(0, 23)}…` : r.label}
                </text>
                {diverging ? (
                  <Bar x={t >= 0 ? x0 : end} y={cy - bh / 2} w={Math.abs(t) * scale} h={bh} color={series[0].color} />
                ) : (
                  series.map((s, k) => {
                    const v = Math.max(r.values[k], 0) * scale;
                    const xs = x0 + acc + (k > 0 && acc > 0 ? 2 : 0);
                    const width = Math.max(v - (k > 0 && acc > 0 ? 2 : 0), 0);
                    acc += v;
                    return <Bar key={s.name} x={xs} y={cy - bh / 2} w={width} h={bh} color={s.color} />;
                  })
                )}
                <text
                  x={diverging ? (t >= 0 ? end + 6 : end - 6) : end + 6}
                  y={cy}
                  dy="0.32em"
                  textAnchor={diverging && t < 0 ? 'end' : 'start'}
                  fontSize={11}
                  style={{ fill: INK.primary }}
                  className="tabular-nums"
                >
                  {fmt(t)}
                  {extra && <tspan style={{ fill: INK.muted }}> {extra}</tspan>}
                </text>
                <rect x={0} y={i * rowH} width={w} height={rowH} fill="transparent" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} width={w} />
    </div>
  );
}

// ---- ranked bar list (HTML, wraps on narrow cards) -------------------------------------------------

/**
 * One bar per row on its own scale (0 to max × 1.05), single colour, value at the bar end and a
 * note on the right. Rows are HTML, so on a narrow card the bar drops below the name. Shows the
 * first `limit` rows with a "Show all" toggle.
 */
export function BarList({
  rows,
  color,
  limit,
  diverging = false,
  valueFmt = (n) => String(Math.round(n)),
  noteWidth = 'w-14',
}: {
  /** `tip`: the tooltip, one labelled line per fact */
  rows: { key: string; label: string; value: number; note?: string; tip: { label: string; value: string }[] }[];
  color: string;
  limit?: number;
  /** bars either side of a centre rule (variances): position gives the direction, the colour stays one */
  diverging?: boolean;
  valueFmt?: (n: number) => string;
  /** width class of the note on the right */
  noteWidth?: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [all, setAll] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);
  const max = Math.max(...rows.map((r) => (diverging ? Math.abs(r.value) : r.value)), 0) * 1.05 || 1;
  // share of the track: from 0 (left edge) or from the centre when diverging
  const span = (v: number) => (diverging ? (Math.abs(v) / max) * 50 : (v / max) * 100);
  const shown = limit && !all ? rows.slice(0, limit) : rows;
  if (!rows.length) return <div className="py-6 text-center text-xs text-slate-500">No data for this selection</div>;
  return (
    <div ref={ref} className="relative @container">
      <ul className="space-y-1">
        {shown.map((r) => (
          <li
            key={r.key}
            className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-0.5 text-[12px] tabular-nums"
            onPointerEnter={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const host = ref.current!.getBoundingClientRect();
              setTip({ x: Math.min(box.width / 3, w - 220), y: box.bottom - host.top + 6, title: r.label, rows: r.tip });
            }}
            onPointerLeave={() => setTip(null)}
          >
            <span className="min-w-0 basis-full truncate text-[var(--ink-2)] @md:basis-48 @md:shrink-0" title={r.label}>
              {r.label}
            </span>
            {/* the track keeps room for the value label beyond the longest bar (both sides when diverging) */}
            <span className={`relative flex min-w-0 flex-1 items-center pr-12 ${diverging ? 'pl-12' : ''}`} aria-label={`${r.label}: ${valueFmt(r.value)}`}>
              <span className="relative block h-3.5 w-full">
                {diverging && <span className="absolute inset-y-[-3px] left-1/2 block w-px bg-[var(--line-strong)]" />}
                {diverging ? (
                  <span
                    className="absolute inset-y-0 block"
                    style={{ width: `${span(r.value)}%`, background: color, ...(r.value < 0 ? { right: '50%' } : { left: '50%' }) }}
                  />
                ) : (
                  <span className="absolute inset-y-0 left-0 block" style={{ width: `${span(r.value)}%`, background: color }} />
                )}
                <span
                  className={`absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-semibold text-[var(--ink)] ${diverging && r.value < 0 ? 'pr-1.5' : 'pl-1.5'}`}
                  style={diverging && r.value < 0 ? { right: `${50 + span(r.value)}%` } : { left: `${diverging ? 50 + span(r.value) : span(r.value)}%` }}
                >
                  {valueFmt(r.value)}
                </span>
              </span>
            </span>
            {r.note !== undefined && <span className={`${noteWidth} shrink-0 text-right text-[11px] text-[var(--ink-muted)]`}>{r.note}</span>}
          </li>
        ))}
      </ul>
      {limit !== undefined && rows.length > limit && (
        <button type="button" className="mt-1 text-xs text-[var(--ink-2)] underline" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
      <Tooltip tip={tip} width={w} />
    </div>
  );
}

// ---- KPI tile (.anh-kpi) --------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  delta,
  deltaDir,
  adverse,
  sub,
  spark,
}: {
  label: string;
  value: string;
  delta?: string;
  /** direction of the change: drives the ▲ / ▼ glyph */
  deltaDir?: 'up' | 'down';
  /** the change is bad news: underlined (.anh-var.is-adverse) */
  adverse?: boolean;
  sub?: string;
  spark?: number[];
}) {
  const max = spark ? Math.max(...spark, 1) : 1;
  return (
    <article className="anh-kpi anh-kpi--compact">
      <div className="anh-kpi__top">
        <span className="anh-eyebrow">{label}</span>
        {spark && (
          <svg width={72} height={20} className="shrink-0" aria-hidden="true">
            <polyline
              points={spark.map((v, i) => `${(i / (spark.length - 1)) * 70 + 1},${19 - (v / max) * 17}`).join(' ')}
              fill="none"
              style={{ stroke: 'var(--m-actual)' }}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      <div className="anh-kpi__value">{value}</div>
      {(sub || delta) && (
        <div className="anh-kpi__foot">
          <span>{sub}</span>
          {delta && <span className={`anh-var ${deltaDir ? `anh-var--${deltaDir}` : ''} ${adverse ? 'is-adverse' : ''}`}>{delta}</span>}
        </div>
      )}
    </article>
  );
}
