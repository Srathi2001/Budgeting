'use client';

// Upload of the FM Budget template: preview of every change, then apply.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fmt } from '@/lib/format';
import { uploadFmTemplate, type FmUploadResult } from './actions';

export function FmImport({ versionId, onClose }: { versionId: number; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState<FormData | null>(null);
  const [res, setRes] = useState<FmUploadResult | null>(null);
  const [pending, start] = useTransition();
  const done = !!res?.saved;

  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRes(null);
    const file = e.target.files?.[0];
    if (!file) return setForm(null);
    const f = new FormData();
    f.set('file', file);
    setForm(f);
    start(async () => setRes(await uploadFmTemplate(versionId, f, false)));
  };
  const apply = () =>
    form &&
    start(async () => {
      setRes(await uploadFmTemplate(versionId, form, true));
      router.refresh();
    });

  return (
    <div className="border-b border-slate-200 px-4 py-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-bold">Import Excel</span>
        <input type="file" accept=".xlsx" onChange={choose} className="text-xs" disabled={pending} />
        {pending && <span>{form && res ? 'Saving…' : 'Reading…'}</span>}
        {res && !res.error && !done && (
          <span>
            {res.changes.length} change{res.changes.length === 1 ? '' : 's'} · {res.errors.length} rejected
          </span>
        )}
        {done && (
          <span className="font-bold">
            Saved {res!.saved!.changes} change{res!.saved!.changes === 1 ? '' : 's'} on {res!.saved!.facilities} facilit{res!.saved!.facilities === 1 ? 'y' : 'ies'}
            {res!.errors.length ? ` · ${res!.errors.length} rejected` : ''}
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

      {res && !res.error && (res.changes.length > 0 || res.errors.length > 0) && (
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          {res.changes.length > 0 && (
            <div className="frame max-h-64 overflow-auto">
              <table className="tbl tbl-compact">
                <thead>
                  <tr>
                    <th className="num">Row</th>
                    <th>Facility</th>
                    <th>Change</th>
                    <th>What</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {res.changes.slice(0, 500).map((c, i) => (
                    <tr key={i}>
                      <td className="num">{c.excelRow}</td>
                      <td>{c.facility}</td>
                      <td>{c.what}</td>
                      <td>{c.detail}</td>
                      <td className="num">{fmt(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {res.errors.length > 0 && (
            <div className="frame max-h-64 overflow-auto">
              <table className="tbl tbl-compact">
                <thead>
                  <tr>
                    <th className="num">Row</th>
                    <th>Facility</th>
                    <th>Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {res.errors.slice(0, 500).map((e, i) => (
                    <tr key={i}>
                      <td className="num">{e.excelRow || ''}</td>
                      <td>{e.facility}</td>
                      <td className="text-red-600">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
