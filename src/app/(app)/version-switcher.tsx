'use client';

import { useTransition } from 'react';
import { setActiveVersion } from './actions';

export function VersionSwitcher({
  current,
  versions,
}: {
  current: number | null;
  versions: { id: number; name: string; status: string }[];
}) {
  const [pending, start] = useTransition();
  return (
    <label className="block">
      <span className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Budget version</span>
      <select
        className="input mt-1 w-full"
        value={current ?? ''}
        disabled={pending}
        onChange={(e) => start(() => setActiveVersion(Number(e.target.value)))}
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.status === 'LOCKED' ? ' 🔒' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
