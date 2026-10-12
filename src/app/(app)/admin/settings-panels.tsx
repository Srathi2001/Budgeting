'use client';

// Admin → Yearly rules (per version: G&A payroll rules, FM supervision split) and Admin → Mappings (every
// version: first reporting year, GL company → business unit, the Mall's codes, whole-building leases).
// They used to be written into the code for 2026 (audit FIN-019).

import { useState, useTransition } from 'react';
import type { FmSupervision, PayrollRule } from '@/lib/engine/assumptions';
import type { AppSettings } from '@/lib/settings';
import { DEPTS, deptName } from '@/lib/budget/admin-types';
import { ASRE_LINES } from '@/lib/budget/asre-types';
import { saveAsre, saveMappings, saveYearlyRules } from './actions';

type Msg = { error?: string; ok?: string } | null;
const MsgLine = ({ msg }: { msg: Msg }) => (msg ? <span className={`text-sm ${msg.error ? 'text-red-600' : ''}`}>{msg.error ?? msg.ok}</span> : null);
const toPct = (v: number) => String(Math.round(v * 10000) / 100);
const fromPct = (s: string) => {
  const n = Number(s.replace(/[%\s,]/g, ''));
  return Number.isFinite(n) ? n / 100 : NaN;
};

export function YearlyRulesPanel({ versionId, versionName, locked, rules, supervision }: { versionId: number; versionName: string; locked: boolean; rules: Record<string, PayrollRule>; supervision: FmSupervision }) {
  const depts = DEPTS.filter((d) => !d.elsewhere).map((d) => d.code);
  const [r, setR] = useState(() => Object.fromEntries(depts.map((d) => [d, { cap: toPct(rules[d]?.cap ?? 0), mjnh: toPct(rules[d]?.mjnh ?? 0), asre: toPct(rules[d]?.asre ?? 0.05), whole: !!rules[d]?.asreWhole }])));
  const [split, setSplit] = useState(() => supervision.split.map((s) => ({ share: toPct(s.share), workTypes: s.workTypes.join(', ') })));
  const [bus, setBus] = useState(supervision.bus.join(', '));
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const edit = !locked;
  const total = split.reduce((s, x) => s + (fromPct(x.share) || 0), 0);

  const save = () =>
    start(async () => {
      const payrollRules: Record<string, PayrollRule> = {};
      for (const d of depts) {
        const x = r[d];
        const rule = { cap: fromPct(x.cap), mjnh: fromPct(x.mjnh), asre: fromPct(x.asre), ...(x.whole ? { asreWhole: true } : {}) };
        if ([rule.cap, rule.mjnh, rule.asre].some((v) => !Number.isFinite(v))) return setMsg({ error: `${deptName(d)}: shares must be numbers` });
        payrollRules[d] = rule;
      }
      const res = await saveYearlyRules(versionId, {
        payrollRules,
        fmSupervision: {
          split: split.map((s) => ({ share: fromPct(s.share), workTypes: s.workTypes.split(/[,\s]+/).map((w) => w.trim().toUpperCase()).filter(Boolean) })),
          bus: bus.split(/[,\s]+/).map((b) => b.trim()).filter(Boolean),
        },
      });
      setMsg(res);
    });

  const cell = (d: string, k: 'cap' | 'mjnh' | 'asre', label: string) =>
    edit ? (
      <td className="anh-num input">
        <input aria-label={`${deptName(d)} ${label}`} inputMode="decimal" className="w-full" value={r[d][k]} onChange={(e) => setR((x) => ({ ...x, [d]: { ...x[d], [k]: e.target.value } }))} />
      </td>
    ) : (
      <td className="anh-num locked">{r[d][k]}</td>
    );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">Yearly rules · {versionName}</h2>
        {edit && (
          <button className="btn-primary" onClick={save} disabled={pending}>
            Save
          </button>
        )}
        <MsgLine msg={msg} />
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-bold">G&amp;A payroll rules by department</h3>
        <p className="text-xs text-slate-500">
          Shares of payroll plus the admin overheads ANPM pays for the department: capitalised to projects (PDD) and recharged to ASRE; MJNH of payroll only. ASRE takes its share of the senior
          staff cost, or of the whole department. A department can still override these in Admin overheads.
        </p>
        <table className="anh-grid">
          <thead>
            <tr className="h1">
              <th>Department</th>
              <th className="anh-num">Capitalised %</th>
              <th className="anh-num">To MJNH %</th>
              <th className="anh-num">To ASRE %</th>
              <th>ASRE on the whole department</th>
            </tr>
          </thead>
          <tbody>
            {depts.map((d) => (
              <tr key={d} className="child">
                <td>
                  <span className="anh-code mr-2">{d}</span>
                  {deptName(d)}
                </td>
                {cell(d, 'cap', 'capitalised %')}
                {cell(d, 'mjnh', 'to MJNH %')}
                {cell(d, 'asre', 'to ASRE %')}
                <td>
                  <input type="checkbox" aria-label={`${deptName(d)} ASRE on the whole department`} checked={r[d].whole} disabled={!edit} onChange={(e) => setR((x) => ({ ...x, [d]: { ...x[d], whole: e.target.checked } }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-bold">FM supervisory staff</h3>
        <p className="text-xs text-slate-500">How the office and supervisory staff cost is spread over work types (shares add up to 100%), and the business units it is spread over.</p>
        <table className="anh-grid">
          <thead>
            <tr className="h1">
              <th>Work types</th>
              <th className="anh-num">Share %</th>
            </tr>
          </thead>
          <tbody>
            {split.map((s, i) => (
              <tr key={i} className="child">
                {edit ? (
                  <>
                    <td className="input">
                      <input aria-label={`Work types ${i + 1}`} className="w-full" value={s.workTypes} onChange={(e) => setSplit((x) => x.map((y, j) => (j === i ? { ...y, workTypes: e.target.value } : y)))} />
                    </td>
                    <td className="anh-num input">
                      <input aria-label={`Share ${i + 1}`} inputMode="decimal" className="w-full" value={s.share} onChange={(e) => setSplit((x) => x.map((y, j) => (j === i ? { ...y, share: e.target.value } : y)))} />
                    </td>
                  </>
                ) : (
                  <>
                    <td className="locked">{s.workTypes}</td>
                    <td className="anh-num locked">{s.share}</td>
                  </>
                )}
              </tr>
            ))}
            <tr className="total">
              <td>Total</td>
              <td className="anh-num">{Math.round(total * 10000) / 100}%</td>
            </tr>
          </tbody>
        </table>
        <label className="flex items-center gap-2 text-sm">
          Business units supervised
          <input className="input w-40" value={bus} disabled={!edit} onChange={(e) => setBus(e.target.value)} />
        </label>
      </section>
    </div>
  );
}

const pairs = (m: Record<string, string>) =>
  Object.entries(m)
    .map(([k, v]) => `${k} = ${v}`)
    .join('\n');
const parsePairs = (s: string) =>
  Object.fromEntries(
    s
      .split('\n')
      .map((l) => l.split('=').map((x) => x.trim()))
      .filter((x) => x.length === 2 && x[0] && x[1]),
  );

export function MappingsPanel({ settings }: { settings: AppSettings }) {
  const [first, setFirst] = useState(String(settings.firstReportYear));
  const [gl, setGl] = useState(() => Object.fromEntries(Object.entries(settings.glCompanies).map(([l, m]) => [l, pairs(m)])));
  const [mall, setMall] = useState(settings.mallCodes.join(', '));
  const [whole, setWhole] = useState(settings.wholeBuildingNames.join('\n'));
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () =>
      setMsg(
        await saveMappings({
          firstReportYear: Number(first),
          glCompanies: Object.fromEntries(Object.entries(gl).map(([l, s]) => [l, parsePairs(s)])),
          mallCodes: mall.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean),
          wholeBuildingNames: whole.split('\n').map((x) => x.trim()).filter(Boolean),
        }),
      ),
    );
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">Mappings · every version</h2>
        <button className="btn-primary" onClick={save} disabled={pending}>
          Save
        </button>
        <MsgLine msg={msg} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        First reporting year
        <input className="input w-24" inputMode="numeric" value={first} onChange={(e) => setFirst(e.target.value)} />
        <span className="text-xs text-slate-500">Oracle actuals and comparatives start this year</span>
      </label>
      <section className="space-y-2">
        <h3 className="text-sm font-bold">GL company → business unit</h3>
        <p className="text-xs text-slate-500">One per line, &ldquo;company = business unit&rdquo;: where the GL import puts each company&apos;s lines (e.g. 503 = 522).</p>
        <div className="flex flex-wrap gap-4">
          {Object.keys(gl).map((l) => (
            <label key={l} className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{l}</span>
              <textarea className="input h-32 w-48 font-mono" value={gl[l]} onChange={(e) => setGl((x) => ({ ...x, [l]: e.target.value }))} />
            </label>
          ))}
        </div>
      </section>
      <label className="flex flex-col gap-1 text-sm">
        The Mall&apos;s property codes (starting with)
        <input className="input w-64" value={mall} onChange={(e) => setMall(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Whole-building leases (property names, one per line; rent per sq ft groups them apart)
        <textarea className="input h-28 w-96" value={whole} onChange={(e) => setWhole(e.target.value)} />
      </label>
    </div>
  );
}

export function AsrePanel({ versionId, versionName, locked, values }: { versionId: number; versionName: string; locked: boolean; values: Record<string, number | null> }) {
  const [v, setV] = useState(() => Object.fromEntries(ASRE_LINES.map((l) => [l.key, values[l.key] === null || values[l.key] === undefined ? '' : String(values[l.key])])));
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const out: Record<string, number | null> = {};
      for (const l of ASRE_LINES) {
        const s = v[l.key].replace(/[,\s]/g, '');
        const n = s === '' ? null : Number(s);
        if (n !== null && !Number.isFinite(n)) return setMsg({ error: `${l.label}: not a number` });
        out[l.key] = n;
      }
      setMsg(await saveAsre(versionId, out));
    });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">ASRE · Arabian Spaces Real Estate · {versionName}</h2>
        {!locked && (
          <button className="btn-primary" onClick={save} disabled={pending}>
            Save
          </button>
        )}
        <MsgLine msg={msg} />
      </div>
      <p className="max-w-3xl text-xs text-slate-500">
        The mall operator, in the group as in the 2026 budget. Its budget comes from its own finance team: one amount for the year per line, spread evenly over the months. Blank until it arrives. The mall lease it pays
        REHL-MJN is eliminated against the Mall&apos;s rent in the group view.
      </p>
      <table className="anh-grid">
        <thead>
          <tr className="h1">
            <th>Line</th>
            <th className="anh-num">Year (AED)</th>
          </tr>
        </thead>
        <tbody>
          {ASRE_LINES.map((l) => (
            <tr key={l.key} className="child">
              <td>{l.label}</td>
              {locked ? (
                <td className="anh-num locked">{v[l.key]}</td>
              ) : (
                <td className="anh-num input">
                  <input aria-label={l.label} inputMode="decimal" className="w-full" value={v[l.key]} onChange={(e) => setV((x) => ({ ...x, [l.key]: e.target.value }))} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
