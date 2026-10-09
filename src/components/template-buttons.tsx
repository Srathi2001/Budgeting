'use client';

// Download template / Import Excel for an input page: the upload shows every change (and what can't be
// taken) before anything is saved.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { count, fmt, pct } from '@/lib/format';
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

  const summary = res?.error ? null : done ? `Saved ${res!.saved} · ${rejected} rejected` : res ? `${res.changes.length} change${res.changes.length === 1 ? '' : 's'} · ${rejected} rejected` : null;
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
            <Button variant="primary" disabled={!res.changes.length} loading={pending} onClick={apply}>
              Apply {res.changes.length} change{res.changes.length === 1 ? '' : 's'}
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
