'use client';

// Labour allocation: FM staff by team (cost to company and overtime, entered by FMD; last year's for
// reference), the G&A share added pro rata, and each team spread over the facilities with the 2026 rules.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fmt, sum } from '@/lib/format';
import { STAFF_TEAMS } from '@/lib/budget/fm-types';
import type { FmPageData } from '@/lib/budget/fm-page';
import { saveFmStaff } from './actions';
import { TemplateButtons } from '@/components/template-buttons';

const parse = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ''));
  return s.trim() === '' ? 0 : Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const TEAM = new Map(STAFF_TEAMS.map((t) => [t.code, t]));

export function FmLabour({ data }: { data: FmPageData }) {
  const router = useRouter();
  const { version, facilities } = data;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const [rows, setRows] = useState(() => data.staff.map((s) => ({ team: s.team, ctc: s.ctc ? String(s.ctc) : '', ot: s.overtime ? String(s.overtime) : '' })));
  const [dirty, setDirty] = useState(false);
  const edit = data.canEditStaff;
  const prior = data.priorLabel;

  const save = () =>
    start(async () => {
      const parsed = rows.map((r) => ({ team: r.team, ctc: parse(r.ctc), overtime: r.team === 'GA' ? 0 : parse(r.ot) }));
      if (parsed.some((p) => p.ctc === null || p.overtime === null)) return setMsg({ error: 'Amounts must be numbers of 0 or more' });
      const r = await saveFmStaff(version.id, parsed);
      setMsg(r);
      if (!r.error) {
        setDirty(false);
        router.refresh();
      }
    });

  const zone = (f: (typeof facilities)[number]) => (f.staff.ZONE_1 ?? 0) + (f.staff.ZONE_2 ?? 0) + (f.staff.ZONE_3 ?? 0);
  const allocated = facilities.filter((f) => f.staffTotal >= 0.5 || (f.priorStaffTotal ?? 0) >= 0.5);
  const col = (get: (f: (typeof facilities)[number]) => number) => sum(allocated.map(get));

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-auto p-4">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold">FM staff by team</h2>
          {edit && (
            <button className="btn-primary" onClick={save} disabled={pending || !dirty}>
              {pending ? 'Saving…' : 'Save'}
            </button>
          )}
          {msg && <span className={`text-sm ${msg.error ? 'text-red-600' : ''}`}>{msg.error ?? msg.ok}</span>}
          {!edit && data.staffLockedReason && <span className="text-sm">{data.staffLockedReason}</span>}
          <TemplateButtons kind="fm-labour" versionId={version.id} canImport={edit} />
          <div className="anh-legend-cells ml-auto" aria-label="Cell legend">
            <span>
              <i className="input" />
              To enter
            </span>
            <span>
              <i className="locked" />
              Locked
            </span>
          </div>
        </div>
        <table className="anh-grid">
          <thead>
            <tr className="h2">
              <th colSpan={2} />
              {prior && (
                <th colSpan={3} style={{ textAlign: 'center' }}>
                  {prior}
                </th>
              )}
              <th colSpan={3} style={{ textAlign: 'center' }}>
                {version.year}B
              </th>
            </tr>
            <tr className="h1">
              <th>Team</th>
              <th>Spread over</th>
              {prior && (
                <>
                  <th className="anh-num">Cost to company</th>
                  <th className="anh-num">Overtime</th>
                  <th className="anh-num">With G&amp;A share</th>
                </>
              )}
              <th className="anh-num">Cost to company</th>
              <th className="anh-num">Overtime</th>
              <th className="anh-num">With G&amp;A share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const s = data.staff[i];
              const t = TEAM.get(r.team)!;
              const cell = (k: 'ctc' | 'ot', label: string) =>
                edit && !(k === 'ot' && r.team === 'GA') ? (
                  <td className={`input${parse(r[k]) === null ? ' is-error' : ''}`}>
                    <input
                      aria-label={`${t.label} ${label}`}
                      inputMode="decimal"
                      value={r[k]}
                      onChange={(e) => {
                        setRows((rs) => rs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
                        setDirty(true);
                      }}
                    />
                  </td>
                ) : (
                  <td className="anh-num locked">{k === 'ot' && r.team === 'GA' ? '' : fmt(parse(r[k]))}</td>
                );
              return (
                <tr key={r.team}>
                  <td className="font-bold">{t.label}</td>
                  <td>{t.hint}</td>
                  {prior && (
                    <>
                      <td className="anh-num locked">{fmt(s.prior?.ctc)}</td>
                      <td className="anh-num locked">{r.team === 'GA' ? '' : fmt(s.prior?.overtime)}</td>
                      <td className="anh-num locked">{r.team === 'GA' ? '' : fmt(s.prior?.cost)}</td>
                    </>
                  )}
                  {cell('ctc', 'cost to company')}
                  {cell('ot', 'overtime')}
                  <td className="anh-num calc">{r.team === 'GA' ? '' : fmt(s.cost)}</td>
                </tr>
              );
            })}
            <tr className="total">
              <td colSpan={2}>Total FM staff</td>
              {prior && (
                <>
                  <td className="anh-num">{fmt(sum(data.staff.map((s) => s.prior?.ctc ?? 0)))}</td>
                  <td className="anh-num">{fmt(sum(data.staff.map((s) => s.prior?.overtime ?? 0)))}</td>
                  <td className="anh-num">{fmt(sum(data.staff.map((s) => s.prior?.cost ?? 0)))}</td>
                </>
              )}
              <td className="anh-num">{fmt(sum(rows.map((r) => parse(r.ctc) ?? 0)))}</td>
              <td className="anh-num">{fmt(sum(rows.map((r) => parse(r.ot) ?? 0)))}</td>
              <td className="anh-num">{fmt(sum(data.staff.map((s) => s.cost)))}</td>
            </tr>
          </tbody>
        </table>
        {data.unallocated >= 1 && (
          <p className="text-sm">
            <b>Not allocated: AED {fmt(data.unallocated)}.</b> Part of the staff cost is spread by works of a type no facility has in the {version.year} budget yet;
            it is allocated once those costs are entered in the FM Budget Template.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold">Allocation by facility · {version.year}B</h2>
        <table className="anh-grid">
          <thead>
            <tr className="h1">
              <th>Facility</th>
              <th>BU</th>
              <th>Zone</th>
              <th className="anh-num">Office / supervisory</th>
              <th className="anh-num">Zone team</th>
              <th className="anh-num">Planned maintenance team</th>
              <th className="anh-num">Vacant unit team</th>
              <th className="anh-num">{version.year}B FM staff</th>
              {prior && <th className="anh-num">{prior} FM staff</th>}
            </tr>
          </thead>
          <tbody>
            {allocated.map((f) => (
              <tr key={f.id}>
                <td>
                  {f.code} · {f.name}
                </td>
                <td>{f.bu}</td>
                <td>{f.zone?.replace('ZONE_', 'Zone ') ?? ''}</td>
                <td className="anh-num calc">{fmt((f.staff.SUPERVISORY ?? 0) + (f.staff.GA ?? 0))}</td>
                <td className="anh-num calc">{fmt(zone(f))}</td>
                <td className="anh-num calc">{fmt(f.staff.PPM ?? 0)}</td>
                <td className="anh-num calc">{fmt(f.staff.VACANT ?? 0)}</td>
                <td className="anh-num calc">{fmt(f.staffTotal)}</td>
                {prior && <td className="anh-num locked">{fmt(f.priorStaffTotal)}</td>}
              </tr>
            ))}
            {allocated.length === 0 && (
              <tr>
                <td colSpan={prior ? 9 : 8}>Nothing allocated yet: enter the staff budget above and the costs in the FM Budget Template.</td>
              </tr>
            )}
            <tr className="total">
              <td colSpan={3}>Total · {allocated.length} facilities</td>
              <td className="anh-num">{fmt(col((f) => (f.staff.SUPERVISORY ?? 0) + (f.staff.GA ?? 0)))}</td>
              <td className="anh-num">{fmt(col(zone))}</td>
              <td className="anh-num">{fmt(col((f) => f.staff.PPM ?? 0))}</td>
              <td className="anh-num">{fmt(col((f) => f.staff.VACANT ?? 0))}</td>
              <td className="anh-num">{fmt(col((f) => f.staffTotal))}</td>
              {prior && <td className="anh-num">{fmt(col((f) => f.priorStaffTotal ?? 0))}</td>}
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
