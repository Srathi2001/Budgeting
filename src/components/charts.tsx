'use client';

// Small SVG chart kit for the dark dashboard.
// Specs: bars <= 24px with a 4px rounded data-end, square at the baseline; 2px surface gap between
// touching marks; 2px lines; solid hairline grid; text in ink tokens (never the series colour);
// legend for >= 2 series; hover tooltip on every chart; table view on every card.

import { useEffect, useRef, useState, type ReactNode } from 'react';

// Categorical slots (dark steps), validated on the #121821 surface: all checks pass.
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];
export const MUTED_SERIES = '#5b6b80';
export const DIVERGING = { up: '#3987e5', down: '#e66767' };
const INK = { primary: '#ebeff4', secondary: '#c3ccd7', muted: '#8b98a9' };
const GRID = '#202b38';
const AXIS = '#34445a';
const SURFACE = '#121821';

export function compact(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M` : a >= 1e3 ? `${Math.round(a / 1e3)}K` : `${Math.round(a)}`;
  return n < 0 ? `−${s}` : s;
}
const full = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);

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

/** Bar path: rounded 4px at the data end, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number, dir: 'up' | 'right' | 'left') {
  const r = Math.min(4, (dir === 'up' ? w : h) / 2, dir === 'up' ? h : w);
  if (h <= 0 || w <= 0) return '';
  if (dir === 'up')
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  if (dir === 'right') return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
}

interface Tip {
  x: number;
  y: number;
  title: string;
  rows: { color?: string; label: string; value: string }[];
}

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x + 14, 4), Math.max(width - 210, 4));
  return (
    <div
      className="pointer-events-none absolute z-20 min-w-44 rounded-md border px-3 py-2 text-xs shadow-lg"
      style={{ left, top: Math.max(tip.y - 10, 0), background: '#0d141c', borderColor: AXIS }}
    >
      <div className="mb-1 text-[11px]" style={{ color: INK.muted }}>
        {tip.title}
      </div>
      {tip.rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 py-0.5">
          {r.color && <span className="inline-block h-0.5 w-3" style={{ background: r.color }} />}
          <span className="font-semibold tabular-nums" style={{ color: INK.primary }}>
            {r.value}
          </span>
          <span style={{ color: INK.secondary }}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items, shape = 'rect' }: { items: { label: string; color: string }[]; shape?: 'rect' | 'line' }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: INK.secondary }}>
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          {shape === 'rect' ? (
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          ) : (
            <span className="inline-block h-0.5 w-4" style={{ background: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Card with a chart / table toggle (every chart has a table twin). */
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
    <section className={`card flex flex-col p-4 ${className}`}>
      <header className="mb-3 flex items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {sub && <p className="text-xs text-slate-500">{sub}</p>}
        </div>
        <div className="seg ml-auto shrink-0 text-xs">
          <button className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')}>
            Chart
          </button>
          <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>
            Table
          </button>
        </div>
      </header>
      {view === 'chart' ? (
        <>
          {legend && <div className="mb-2">{legend}</div>}
          {children}
        </>
      ) : (
        <div className="frame max-h-80">
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                {table.head.map((h, i) => (
                  <th key={h} className={i ? 'num' : ''}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={j ? 'num' : ''}>
                      {typeof c === 'number' ? full(c) : c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const PAD = { l: 52, r: 16, t: 10, b: 26 };

function YAxis({ ys, y, w, fmt = compact }: { ys: number[]; y: (v: number) => number; w: number; fmt?: (n: number) => string }) {
  return (
    <g>
      {ys.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? AXIS : GRID} strokeWidth={1} />
          <text x={PAD.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK.muted} className="tabular-nums">
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
  min,
}: {
  labels: string[];
  series: { name: string; color: string; values: (number | null)[]; width?: number }[];
  height?: number;
  fmt?: (n: number) => string;
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
          rows: series.map((s) => ({ color: s.color, label: s.name, value: s.values[hover] === null ? '–' : full(s.values[hover]!) })),
        };
  return (
    <div ref={ref} className="relative" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={series.map((s) => s.name).join(' vs ')}>
          <YAxis ys={ys} y={y} w={w} fmt={fmt} />
          {labels.map((l, i) => (
            <text key={l} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill={INK.muted}>
              {l}
            </text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={height - PAD.b} stroke={AXIS} strokeWidth={1} />}
          {series.map((s) => {
            const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
            return <polyline key={s.name} points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeLinejoin="round" strokeLinecap="round" />;
          })}
          {hover !== null &&
            series.map((s) =>
              s.values[hover] === null ? null : <circle key={s.name} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />,
            )}
          {/* end labels on the last point */}
          {series.map((s) => {
            const i = s.values.length - 1;
            const v = s.values[i];
            return v === null ? null : <circle key={`e-${s.name}`} cx={x(i)} cy={y(v)} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />;
          })}
          <rect
            x={PAD.l}
            y={PAD.t}
            width={Math.max(w - PAD.l - PAD.r, 0)}
            height={height - PAD.t - PAD.b}
            fill="transparent"
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
  stacked = false,
  height = 220,
  fmt = compact,
  tipFmt = full,
}: {
  labels: string[];
  series: { name: string; color: string; values: number[] }[];
  stacked?: boolean;
  height?: number;
  fmt?: (n: number) => string;
  /** value format in the tooltip (default: whole numbers) */
  tipFmt?: (n: number) => string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const totals = labels.map((_, i) => series.reduce((s, x) => s + Math.max(x.values[i], 0), 0));
  const max = stacked ? Math.max(...totals, 1) : Math.max(...series.flatMap((s) => s.values), 1);
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
            ...series.map((s) => ({ color: s.color, label: s.name, value: tipFmt(s.values[hover]) })),
            ...(stacked && series.length > 1 ? [{ label: 'Total', value: tipFmt(totals[hover]) }] : []),
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
                    const top = k === series.length - 1 || series.slice(k + 1).every((q) => q.values[i] <= 0);
                    // 2px surface gap between stacked segments
                    const h = Math.max(y0 - y1 - (k > 0 ? 2 : 0), 0);
                    return top ? (
                      <path key={s.name} d={barPath(cx - bw / 2, y1, bw, h, 'up')} fill={s.color} />
                    ) : (
                      <rect key={s.name} x={cx - bw / 2} y={y1} width={bw} height={h} fill={s.color} />
                    );
                  }
                  const x0 = cx - groupW / 2 + k * (bw + 2);
                  return <path key={s.name} d={barPath(x0, y(v), bw, y(0) - y(v), 'up')} fill={s.color} />;
                })}
                <text x={cx} y={height - 8} textAnchor="middle" fontSize={11} fill={INK.muted}>
                  {l}
                </text>
                <rect
                  x={PAD.l + band * i}
                  y={PAD.t}
                  width={band}
                  height={height - PAD.t - PAD.b}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                />
              </g>
            );
          })}
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
  tipFmt = full,
  note,
}: {
  rows: { label: string; values: number[]; note?: string }[];
  series: { name: string; color: string }[];
  diverging?: boolean;
  labelWidth?: number;
  fmt?: (n: number) => string;
  /** value format in the tooltip (default: whole numbers) */
  tipFmt?: (n: number) => string;
  note?: (row: { label: string; values: number[]; note?: string }) => string | undefined;
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
              ? [...series.map((s, k) => ({ color: s.color, label: s.name, value: tipFmt(rows[hover].values[k]) })), { label: 'Total', value: tipFmt(totals[hover]) }]
              : [
                  { color: diverging ? (totals[hover] < 0 ? DIVERGING.down : DIVERGING.up) : series[0].color, label: series[0].name, value: tipFmt(totals[hover]) },
                  ...(rows[hover].note ? [{ label: rows[hover].note!, value: '' }] : []),
                ],
        };
  return (
    <div ref={ref} className="relative" style={{ height: rows.length ? height : 80 }}>
      {!rows.length && <div className="py-8 text-center text-xs text-slate-500">No data for this selection</div>}
      {w > 0 && rows.length > 0 && (
        <svg width={w} height={height} role="img">
          {diverging && <line x1={x0} x2={x0} y1={0} y2={height} stroke={AXIS} strokeWidth={1} />}
          {!diverging && <line x1={x0} x2={x0} y1={0} y2={height} stroke={AXIS} strokeWidth={1} />}
          {rows.map((r, i) => {
            const cy = i * rowH + rowH / 2;
            const t = totals[i];
            let acc = 0;
            const end = x0 + t * scale;
            const extra = note?.(r);
            return (
              <g key={r.label + i} opacity={hover === null || hover === i ? 1 : 0.55}>
                <text x={labelWidth - 10} y={cy} dy="0.32em" textAnchor="end" fontSize={12} fill={INK.secondary}>
                  {r.label.length > 24 ? `${r.label.slice(0, 23)}…` : r.label}
                </text>
                {diverging ? (
                  <path
                    d={t >= 0 ? barPath(x0, cy - bh / 2, t * scale, bh, 'right') : barPath(end, cy - bh / 2, -t * scale, bh, 'left')}
                    fill={t >= 0 ? DIVERGING.up : DIVERGING.down}
                  />
                ) : (
                  series.map((s, k) => {
                    const v = Math.max(r.values[k], 0) * scale;
                    const xs = x0 + acc + (k > 0 && acc > 0 ? 2 : 0);
                    const width = Math.max(v - (k > 0 && acc > 0 ? 2 : 0), 0);
                    acc += v;
                    const last = r.values.slice(k + 1).every((q) => q <= 0);
                    return last ? (
                      <path key={s.name} d={barPath(xs, cy - bh / 2, width, bh, 'right')} fill={s.color} />
                    ) : (
                      <rect key={s.name} x={xs} y={cy - bh / 2} width={width} height={bh} fill={s.color} />
                    );
                  })
                )}
                <text
                  x={diverging ? (t >= 0 ? end + 6 : end - 6) : end + 6}
                  y={cy}
                  dy="0.32em"
                  textAnchor={diverging && t < 0 ? 'end' : 'start'}
                  fontSize={11}
                  fill={INK.primary}
                  className="tabular-nums"
                >
                  {fmt(t)}
                  {extra && <tspan fill={INK.muted}> {extra}</tspan>}
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

// ---- stat tile -----------------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  delta,
  deltaGood,
  sub,
  spark,
}: {
  label: string;
  value: string;
  delta?: string;
  /** true = this change is good news, false = bad, undefined = neutral */
  deltaGood?: boolean;
  sub?: string;
  spark?: number[];
}) {
  const tone = deltaGood === undefined ? INK.muted : deltaGood ? '#34d399' : '#f87171';
  const max = spark ? Math.max(...spark, 1) : 1;
  return (
    <div className="card px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 flex items-end gap-2">
        <div className="text-xl font-semibold text-slate-900">{value}</div>
        {delta && (
          <div className="pb-0.5 text-xs font-medium" style={{ color: tone }}>
            {deltaGood === undefined ? '' : deltaGood ? '▲ ' : '▼ '}
            {delta}
          </div>
        )}
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
        {spark && (
          <svg width={72} height={20} className="shrink-0">
            <polyline
              points={spark.map((v, i) => `${(i / (spark.length - 1)) * 70 + 1},${19 - (v / max) * 17}`).join(' ')}
              fill="none"
              stroke={SERIES[0]}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  );
}
