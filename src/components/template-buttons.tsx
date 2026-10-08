'use client';

// Download template / Import Excel for an input page: the upload shows every change (and what can't be
// taken) before anything is saved.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadInputTemplate, type TemplateUploadResult } from '@/app/(app)/template-actions';

const show = (v: string | number | null, column: string) =>
  v === null ? '—' : typeof v === 'number' ? (/pct/i.test(column) ? `${Math.round(v * 1000) / 10}%` : v.toLocaleString('en-US', { maximumFractionDigits: 2 })) : v;

export function TemplateButtons({ kind, versionId, canImport }: { kind: string; versionId: number; canImport: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a className="btn" href={`/api/export/input-template?kind=${kind}`} title="Excel template: instructions, the lines in view with their reference figures, the cells to fill in">
        Download template
      </a>
      {canImport && (
        <button className="btn" onClick={() => setOpen(true)}>
          Import Excel
        </button>
      )}
      {open && <ImportDialog kind={kind} versionId={versionId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ImportDialog({ kind, versionId, onClose }: { kind: string; versionId: number; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState<FormData | null>(null);
  const [res, setRes] = useState<TemplateUploadResult | null>(null);
  const [pending, start] = useTransition();
  const done = res?.saved !== undefined;
  const rejected = (res?.errors.length ?? 0) + (res?.refused?.length ?? 0);
  const multiSheet = new Set(res?.changes.map((c) => c.sheet)).size > 1;

  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRes(null);
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
      setRes(await uploadInputTemplate(kind, versionId, form, true));
      router.refresh();
    });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-8" role="dialog" aria-modal="true" aria-label="Import Excel" onClick={onClose}>
      <div className="card flex max-h-full w-full max-w-5xl flex-col bg-white p-4 text-[13px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold">Import Excel</span>
          <input type="file" accept=".xlsx" onChange={choose} className="text-xs" disabled={pending} />
          {pending && <span>{form && res ? 'Saving…' : 'Reading…'}</span>}
          {res && !res.error && !done && (
            <span>
              {res.changes.length} change{res.changes.length === 1 ? '' : 's'} · {rejected} rejected
            </span>
          )}
          {done && (
            <span className="font-bold">
              Saved {res!.saved} · {rejected} rejected
            </span>
          )}
          {res?.error && <span className="text-red-600">{res.error}</span>}
          <span className="ml-auto" />
          {res && !res.error && !done && (
            <button className="btn-primary" disabled={pending || !res.changes.length} onClick={apply}>
              Apply {res.changes.length} change{res.changes.length === 1 ? '' : 's'}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
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
    </div>
  );
}
