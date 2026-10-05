import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireUser, getActiveVersion, visibleProperties, isFinance, editablePropertyIds } from '@/lib/auth/dal';
import { propertyRollups } from '@/lib/budget/reports';
import { sum } from '@/lib/format';
import { AnalysisTable, type AnalysisRow } from './analysis-table';

export const metadata = { title: 'Revenue Analysis · Budget' };

/** Order comparative labels: most recent year first; within a year B, F, A. */
function sortLabels(labels: string[]) {
  const rank = (l: string) => {
    const m = /^(\d{4})([A-Z]+)$/.exec(l);
    return m ? -Number(m[1]) * 10 + ({ B: 0, F: 1, A: 2 }[m[2]] ?? 3) : 0;
  };
  return [...labels].sort((a, b) => rank(a) - rank(b));
}

export default async function AnalysisPage(props: PageProps<'/analysis'>) {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  const v = version!;
  const sp = await props.searchParams;
  const visible = await visibleProperties(user);
  const rolls = await propertyRollups(v.id, visible.map((p) => p.id));
  const editable = await editablePropertyIds(user, v);

  const comps = await db.select().from(schema.comparatives).where(eq(schema.comparatives.versionId, v.id));
  const notes = await db.select().from(schema.propertyNotes).where(eq(schema.propertyNotes.versionId, v.id));
  const labels = sortLabels([...new Set(comps.map((c) => c.label))].filter((l) => l !== `${v.year}B`));

  const defaultBase = labels.includes(`${v.year - 1}F`) ? `${v.year - 1}F` : (labels[0] ?? null);
  const base = typeof sp.base === 'string' && labels.includes(sp.base) ? sp.base : defaultBase;

  const rows: AnalysisRow[] = rolls.map((r) => {
    const note = notes.find((n) => n.propertyId === r.propertyId);
    const values: Record<string, number | null> = {};
    for (const l of labels) values[l] = comps.find((c) => c.propertyId === r.propertyId && c.label === l)?.amount ?? null;
    return {
      propertyId: r.propertyId,
      code: r.code,
      name: r.name,
      bu: r.buName,
      kind: r.kind,
      units: r.kind === 'CAMP' ? 'Camps' : r.kind === 'MALL' ? 'Mall' : String(r.units),
      budget: sum(r.revenue),
      values,
      vacancyLossCalc: r.vacancyLoss,
      vacancyLossOverride: note?.vacancyLossOverride ?? null,
      comment: note?.comment ?? null,
      canComment: v.status === 'OPEN' && (isFinance(user) || editable.has(r.propertyId)),
    };
  });

  return (
    <AnalysisTable
      versionId={v.id}
      year={v.year}
      rows={rows}
      labels={labels}
      base={base}
      finance={isFinance(user) && v.status === 'OPEN'}
    />
  );
}
