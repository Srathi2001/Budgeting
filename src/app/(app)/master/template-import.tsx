'use client';

// Upload of the Lease Budget input template: preview of every change, then apply.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ConflictList } from '@/components/template-buttons';
import { uploadTemplate, type TemplateUploadResult } from './actions';

export function TemplateImport({ versionId, onClose }: { versionId: number; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState<FormData | null>(null);
  const [res, setRes] = useState<TemplateUploadResult | null>(null);
  // conflicts the uploader takes from the file (the rest keep the tool's value)
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
    start(async () => setRes(await uploadTemplate(versionId, f, false)));
  };
  const apply = () =>
    form &&
    start(async () => {
      const r = await uploadTemplate(versionId, form, true, [...mine], conflicts.map((c) => c.id));
      setRes(r);
      if (!r.again) router.refresh();
    });

  return (
    <div className="border-b border-slate-200 bg-white px-4 py-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold text-slate-900">Import Excel</span>
        <input type="file" accept=".xlsx" onChange={choose} className="text-xs" disabled={pending} />
        {pending && <span className="text-slate-500">{form && res ? 'Saving…' : 'Reading…'}</span>}
        {res && !res.error && !done && (
          <span className="text-slate-600">
            {res.changes.length} change{res.changes.length === 1 ? '' : 's'}
            {conflicts.length ? ` · ${conflicts.length} changed in the tool too` : ''} · {res.errors.length} rejected
          </span>
        )}
        {done && (
          <span className="text-emerald-700">
            Saved {res!.saved!.lines} line{res!.saved!.lines === 1 ? '' : 's'}
            {res!.saved!.rera ? ` and ${res!.saved!.rera} RERA range${res!.saved!.rera === 1 ? '' : 's'}` : ''} · recalculated
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

      {res?.again && <p className="mt-2 text-red-600">Figures changed again in the tool since this preview. Nothing was saved: check the list and apply again.</p>}
      {conflicts.length > 0 && !done && (
        <ConflictList conflicts={conflicts.map((c) => ({ id: c.id, row: c.unit, header: c.field, from: c.from, to: c.to, by: c.by, at: c.at }))} mine={mine} setMine={setMine} />
      )}
      {(res?.kept?.length ?? 0) > 0 && !done && (
        <p className="mt-2 text-xs text-slate-600">
          {res!.kept!.length} field{res!.kept!.length === 1 ? '' : 's'} you left as downloaded {res!.kept!.length === 1 ? 'was' : 'were'} changed in the tool since: the tool’s value
          {res!.kept!.length === 1 ? ' stays' : 's stay'} ({res!.kept!.slice(0, 3).map((k) => `${k.unit} ${k.field}`).join(', ')}
          {res!.kept!.length > 3 ? ', …' : ''}).
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
                    <th>Unit</th>
                    <th>Field</th>
                    <th>From</th>
                    <th>To</th>
                  </tr>
                </thead>
                <tbody>
                  {res.changes.slice(0, 500).map((c, i) => (
                    <tr key={i}>
                      <td className="num">{c.excelRow}</td>
                      <td>{c.unit}</td>
                      <td>{c.field}</td>
                      <td>{c.from}</td>
                      <td>{c.to}</td>
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
                    <th>Unit</th>
                    <th>Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {res.errors.slice(0, 500).map((e, i) => (
                    <tr key={i}>
                      <td className="num">{e.excelRow || ''}</td>
                      <td>{e.unit}</td>
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
