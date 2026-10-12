// Reading a locked version's snapshot (version_snapshots, audit FIN-004). The loaders of the parts that are
// otherwise worked out live from shared data use it when the version is locked; see snapshot.ts for writing.
import 'server-only';
import { cache } from 'react';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';

export type SnapshotPart = 'comparatives' | 'forecast' | 'boh' | 'fees';

const read = cache(async (versionId: number, part: SnapshotPart): Promise<unknown | null> => {
  const [row] = await db
    .select({ data: schema.versionSnapshots.data })
    .from(schema.versionSnapshots)
    .where(and(eq(schema.versionSnapshots.versionId, versionId), eq(schema.versionSnapshots.part, part)));
  return row?.data ?? null;
});

/** The frozen part of a locked version (null: open, or locked before snapshots existed). */
export async function frozen<T>(version: { id: number; status: string }, part: SnapshotPart): Promise<T | null> {
  if (version.status !== 'LOCKED') return null;
  return (await read(version.id, part)) as T | null;
}
