'use client';

// Upload of the FM Budget template: preview of every change, then apply.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fmt } from '@/lib/format';
import { ConflictList } from '@/components/template-buttons';
import { uploadFmTemplate, type FmUploadResult } from './actions';

export function FmImport({ versionId, onClose }: { versionId: number; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState<FormData | null>(null);
  const [res, setRes] = useState<FmUploadResult | null>(null);
  // conflicting lines the uploader takes from the file (the rest keep the tool's values)
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const done = !!res?.saved;
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
    start(async () => setRes(await uploadFmTemplate(versionId, f, false)));
  };
  const apply = () =>
    form &&
    start(async () => {
      const r = await uploadFmTemplate(versionId, form, true, [...mine], conflicts.map((c) => c.id));
      setRes(r);
      if (!r.again) router.refresh();
    });

  return (
    <div className="border-b border-slate-200 px-4 py-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-bold">Import Excel</span>
        <input type="file" accept=".xlsx" onChange={choose} className="text-xs" disabled={pending} />
        {pending && <span>{form && res ? 'Saving…' : 'Reading…'}</span>}
        {res && !res.error && !done && (
          <span>
            {res.changes.length} change{res.changes.length === 1 ? '' : 's'}
            {conflicts.length ? ` · ${conflicts.length} changed in the tool too` : ''} · {res.errors.length} rejected
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
          <button className="btn-primary" disabled={pending || !toApply} onClick={apply}>
            Apply {toApply} change{toApply === 1 ? '' : 's'}
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>

      {res?.again && <p className="mt-2 text-red-600">Lines changed again in the tool since this preview. Nothing was saved: check the list and apply again.</p>}
      {conflicts.length > 0 && !done && (
        <ConflictList conflicts={conflicts.map((c) => ({ id: c.id, row: c.facility, header: c.detail, from: c.from, to: c.to, by: c.by, at: c.at }))} mine={mine} setMine={setMine} />
      )}
      {(res?.kept ?? 0) > 0 && !done && (
        <p className="mt-2 text-xs text-slate-600">
          {res!.kept} line{res!.kept === 1 ? '' : 's'} had fields you left as downloaded that were changed in the tool since: the tool’s values stay.
        </p>
      )}

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
