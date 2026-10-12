'use client';

// Download template / Import Excel for an input page: the upload shows every change (and what can't be
// taken) before anything is saved.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { count, fmt, fmtDateTime, pct } from '@/lib/format';
import { uploadInputTemplate, type TemplateUploadResult } from '@/app/(app)/template-actions';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/status';

const show = (v: string | number | null, column: string) =>
  v === null ? '—' : typeof v === 'number' ? (/pct/i.test(column) ? pct(v) : Number.isInteger(v) ? count(v) : fmt(v)) : v;

export function TemplateButtons({ kind, versionId, canImport }: { kind: string; versionId: number; canImport: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a className="ui-btn ui-btn--secondary ui-btn--sm" href={`/api/export/input-template?kind=${kind}`} title="Excel template: instructions, the lines in view with their reference figures, the cells to fill in">
        Download template
      </a>
      {canImport && (
        <Button size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
          Import Excel
        </Button>
      )}
      {open && <ImportDialog kind={kind} versionId={versionId} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Figures changed both in the file and in the tool since the download: who changed them in the tool and
 * when, both values, and a tick to take the file's (unticked: the tool's value stays).
 */
export function ConflictList({
  conflicts,
  mine,
  setMine,
}: {
  conflicts: { id: string; row: string; header: string; column?: string; from: string | number | null; to: string | number | null; by?: string | null; at?: string | null }[];
  mine: Set<string>;
  setMine: (s: Set<string>) => void;
}) {
  const all = conflicts.every((c) => mine.has(c.id));
  const toggle = (id: string) => {
    const n = new Set(mine);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setMine(n);
  };
  return (
    <div className="mt-3">
      <div className="mb-1 font-bold">Changed in the tool since you downloaded the file</div>
      <div className="frame max-h-[40vh] overflow-auto">
        <table className="tbl tbl-compact">
          <thead>
            <tr>
              <th>Line</th>
              <th>Field</th>
              <th>Changed by</th>
              <th className="num">In the tool</th>
              <th className="num">In your file</th>
              <th>
                <label className="flex items-center gap-1 whitespace-nowrap">
                  <input type="checkbox" checked={all} onChange={() => setMine(all ? new Set() : new Set(conflicts.map((c) => c.id)))} /> Use my value for all
                </label>
              </th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((c) => (
              <tr key={c.id}>
                <td>{c.row}</td>
                <td>{c.header}</td>
                <td className="whitespace-nowrap">{[c.by ?? 'Someone else', c.at ? fmtDateTime(c.at) : null].filter(Boolean).join(' · ')}</td>
                <td className="num">{show(c.from, c.column ?? c.header)}</td>
                <td className="num">{show(c.to, c.column ?? c.header)}</td>
                <td>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={mine.has(c.id)} onChange={() => toggle(c.id)} /> Use my value
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImportDialog({ kind, versionId, onClose }: { kind: string; versionId: number; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState<FormData | null>(null);
  const [res, setRes] = useState<TemplateUploadResult | null>(null);
  // conflicts the uploader takes from the file (the rest keep the tool's value)
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const done = res?.saved !== undefined;
  const rejected = (res?.errors.length ?? 0) + (res?.refused?.length ?? 0);
  const multiSheet = new Set(res?.changes.map((c) => c.sheet)).size > 1;
  const conflicts = res?.conflicts ?? [];
  const toApply = (res?.changes.length ?? 0) + conflicts.filter((c) => mine.has(c.id)).length;

  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRes(null);
    setMine(new Set());
    const file = e.target.files?.[0];
    if (!file) return setForm(null);
    const f = new FormData();
    f.set('file', file);
    setForm(f);
    start(async () => setRes(await uploadInputTemplate(kind, versionId, f, false)));
  };
  const apply = () =>
    form &&
    start(async () => {
      const r = await uploadInputTemplate(kind, versionId, form, true, [...mine], conflicts.map((c) => c.id));
      setRes(r);
      if (!r.again) router.refresh();
    });

  const summary = res?.error ? null : done ? `Saved ${res!.saved} · ${rejected} rejected` : res ? `${res.changes.length} change${res.changes.length === 1 ? '' : 's'}${conflicts.length ? ` · ${conflicts.length} changed in the tool too` : ''} · ${rejected} rejected` : null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !pending && onClose()}
      title="Import Excel"
      description="The filled-in template. Every change is listed before anything is saved; rows that cannot be taken are listed with the reason."
      width={960}
      footer={
        <>
          {summary && <span className={`mr-auto text-sm ${done ? 'font-bold' : ''}`}>{summary}</span>}
          <Button variant="tertiary" onClick={onClose} disabled={pending}>
            {done ? 'Close' : 'Cancel'}
          </Button>
          {res && !res.error && !done && (
            <Button variant="primary" disabled={!toApply} loading={pending} onClick={apply}>
              Apply {toApply} change{toApply === 1 ? '' : 's'}
            </Button>
          )}
        </>
      }
    >
      <div className="text-[13px]">
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".xlsx" onChange={choose} className="text-xs" disabled={pending} aria-label="Template file (.xlsx)" />
          {pending && <span className="anh-muted">{form && res ? 'Saving…' : 'Reading…'}</span>}
        </div>
        {res?.error && (
          <Banner kind="error" className="mt-3">
            {res.error}
          </Banner>
        )}
        {res?.again && (
          <Banner kind="error" className="mt-3">
            Figures changed again in the tool since this preview. Nothing was saved: check the list and apply again.
          </Banner>
        )}
        {conflicts.length > 0 && !done && <ConflictList conflicts={conflicts} mine={mine} setMine={setMine} />}
        {(res?.kept?.length ?? 0) > 0 && !done && (
          <p className="mt-3 text-xs text-slate-600">
            {res!.kept!.length} figure{res!.kept!.length === 1 ? '' : 's'} you left as downloaded {res!.kept!.length === 1 ? 'was' : 'were'} changed in the tool since: the tool’s value{res!.kept!.length === 1 ? ' stays' : 's stay'} (
            {res!.kept!.slice(0, 3).map((k) => `${k.row} ${k.header}`).join(', ')}
            {res!.kept!.length > 3 ? ', …' : ''}).
          </p>
        )}
        {res && !res.error && (res.changes.length > 0 || rejected > 0) && (
          <div className="mt-3 grid min-h-0 gap-3 overflow-auto xl:grid-cols-2">
            {res.changes.length > 0 && (
              <div className="frame max-h-[60vh] overflow-auto">
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th className="num">Row</th>
                      <th>Line</th>
                      <th>Field</th>
                      <th className="num">From</th>
                      <th className="num">To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.changes.slice(0, 1000).map((c, i) => (
                      <tr key={i}>
                        <td className="num">
                          {multiSheet ? `${c.sheet} ` : ''}
                          {c.excelRow}
                        </td>
                        <td>{c.row}</td>
                        <td>{c.header}</td>
                        <td className="num">{show(c.from, c.column)}</td>
                        <td className="num">{show(c.to, c.column)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rejected > 0 && (
              <div className="frame max-h-[60vh] overflow-auto">
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th className="num">Row</th>
                      <th>Line</th>
                      <th>Rejected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.errors.map((e, i) => (
                      <tr key={i}>
                        <td className="num">{e.excelRow}</td>
                        <td>{e.row}</td>
                        <td className="text-red-600">{e.message}</td>
                      </tr>
                    ))}
                    {res.refused?.map((m, i) => (
                      <tr key={`r${i}`}>
                        <td />
                        <td />
                        <td className="text-red-600">{m}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
