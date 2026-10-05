import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getCurrentUser, getActiveVersion, isFinance } from '@/lib/auth/dal';
import { comparativeLabels } from '@/lib/budget/comparatives';
import { xlsxResponse } from '@/lib/export/xlsx';

/** Upload template for Admin → Comparatives, pre-filled with the current values. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isFinance(user)) return new Response('Forbidden', { status: 403 });
  const { version } = await getActiveVersion();
  if (!version) return new Response('No version', { status: 404 });
  const labels = await comparativeLabels(version);
  const props = await db.select().from(schema.properties).orderBy(asc(schema.properties.buCode), asc(schema.properties.code));
  const comps = await db.select().from(schema.comparatives).where(eq(schema.comparatives.versionId, version.id));
  const rows = [
    ['Code', 'Property', 'BU', ...labels],
    ...props.map((p) => [p.code, p.name, p.buCode, ...labels.map((l) => comps.find((c) => c.propertyId === p.id && c.label === l)?.amount ?? null)]),
  ];
  return xlsxResponse([{ name: 'Comparatives', rows, cols: [10, 36, 6, ...labels.map(() => 14)] }], `Comparatives ${version.name}.xlsx`);
}
