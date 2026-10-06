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
    <div className="anh-field">
      <label htmlFor="budget-version">Budget version</label>
      <select
        id="budget-version"
        className="anh-select w-full"
        value={current ?? ''}
        disabled={pending}
        onChange={(e) => start(() => setActiveVersion(Number(e.target.value)))}
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.status === 'LOCKED' ? ' · locked' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
