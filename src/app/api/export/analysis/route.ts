import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getCurrentUser, getActiveVersion, visibleProperties } from '@/lib/auth/dal';
import { propertyRollups } from '@/lib/budget/reports';
import { xlsxResponse, r2 } from '@/lib/export/xlsx';
import { sum } from '@/lib/format';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { version } = await getActiveVersion();
  if (!version) return new Response('No version', { status: 404 });
  const rolls = await propertyRollups(version.id, (await visibleProperties(user)).map((p) => p.id));
  const comps = await db.select().from(schema.comparatives).where(eq(schema.comparatives.versionId, version.id));
  const notes = await db.select().from(schema.propertyNotes).where(eq(schema.propertyNotes.versionId, version.id));
  const labels = [...new Set(comps.map((c) => c.label))].filter((l) => l !== `${version.year}B`).sort().reverse();

  const header = ['S.N.', 'Units', 'BU', 'CODE', 'PROPERTY NAME', `${version.year}B`, ...labels.flatMap((l) => [l, `vs ${l}`, `vs ${l} %`]), 'VACANCY LOSS', `% of ${version.year}B`, 'COMMENTS'];
  const body = rolls.map((r, i) => {
    const budget = sum(r.revenue);
    const note = notes.find((n) => n.propertyId === r.propertyId);
    const vl = note?.vacancyLossOverride ?? r.vacancyLoss;
    return [
      i + 1,
      r.kind === 'CAMP' ? 'Camps' : r.kind === 'MALL' ? 'Mall' : r.units,
      r.buName,
      r.code,
      r.name,
      r2(budget),
      ...labels.flatMap((l) => {
        const v = comps.find((c) => c.propertyId === r.propertyId && c.label === l)?.amount ?? null;
        return [v, v === null ? null : r2(budget - v), v ? r2((budget - v) / v) : null];
      }),
      r2(vl),
      budget ? r2(vl / budget) : null,
      note?.comment ?? null,
    ];
  });
  return xlsxResponse([{ name: 'Revenue Analysis', rows: [header, ...body], cols: [5, 7, 7, 10, 34] }], `Revenue Analysis ${version.year}.xlsx`);
}
