// Building overheads base data from the 2026 budget files, into a version (editable afterwards in the tool):
//   insurance: insured value, PAR rate and public liability premium per building
//     ("REHL Property Insurance (PAR & General Liabilty) - Budget 2026.xlsx", sheet Properties: N, V, X)
//   watchmen: the share of a watchman per building = charge ÷ cost per watchman
//     ("Security Allocation_ANZ.xlsx", Sheet1: Property Code, Charges)
//
//   npx tsx scripts/boh-base-import.ts <versionId> insurance <file> [--apply]
//   npx tsx scripts/boh-base-import.ts <versionId> watchmen <file> [--apply]
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { withDefaults } from '../src/lib/engine/assumptions';
import { propertyKey } from '../src/lib/import/tenant-lease';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [versionId, what, file] = args.filter((a) => a !== '--apply');
  const [v] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, Number(versionId)));
  if (!v || !file || !['insurance', 'watchmen'].includes(what)) throw new Error('usage: boh-base-import.ts <versionId> insurance|watchmen <file> [--apply]');
  const props = await db.select({ id: schema.properties.id, code: schema.properties.code }).from(schema.properties);
  const byKey = new Map(props.map((p) => [propertyKey(p.code), p]));
  const wb = XLSX.read(readFileSync(file));
  const unmatched: string[] = [];

  if (what === 'insurance') {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Properties, { header: 1, raw: true, defval: null }).slice(3);
    const out = new Map<number, { insuredValue: number; parRate: number; plPremium: number | null }>();
    for (const r of rows) {
      const code = typeof r[2] === 'string' ? r[2].trim() : null;
      if (!code || typeof r[13] !== 'number' || typeof r[21] !== 'number') continue;
      const p = byKey.get(propertyKey(code));
      if (!p) {
        unmatched.push(code);
        continue;
      }
      out.set(p.id, { insuredValue: r[13] as number, parRate: r[21] as number, plPremium: typeof r[23] === 'number' ? (r[23] as number) : null });
    }
    const a = withDefaults(v.assumptions);
    const par = [...out.values()].reduce((s, x) => s + x.insuredValue * x.parRate, 0);
    const pl = [...out.values()].reduce((s, x) => s + (x.plPremium ?? 0), 0);
    console.log(`insurance: ${out.size} buildings · last year PAR ${Math.round(par).toLocaleString('en-US')} + liability ${Math.round(pl).toLocaleString('en-US')} → ${v.year}B at +${a.insParPct * 100}% / +${a.insPlPct * 100}%: ${Math.round(par * (1 + a.insParPct)).toLocaleString('en-US')} + ${Math.round(pl * (1 + a.insPlPct)).toLocaleString('en-US')}`);
    if (apply)
      await db.transaction(async (tx) => {
        for (const [propertyId, x] of out)
          await tx
            .insert(schema.bohInsurance)
            .values({ versionId: v.id, propertyId, ...x })
            .onConflictDoUpdate({ target: [schema.bohInsurance.versionId, schema.bohInsurance.propertyId], set: { ...x, updatedAt: new Date() } });
        await tx.insert(schema.auditLog).values({ versionId: v.id, entity: 'boh_insurance', action: 'import', changes: { file, buildings: out.size } });
      });
  } else {
    const cost = withDefaults(v.assumptions).watchmanCost;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Sheet1);
    const out = new Map<number, number>();
    for (const r of rows) {
      const code = String(r['Property Code'] ?? '').trim();
      const charge = Number(r.Charges);
      if (!code || !charge) continue;
      const p = byKey.get(propertyKey(code));
      if (!p) {
        unmatched.push(code);
        continue;
      }
      out.set(p.id, (out.get(p.id) ?? 0) + Math.round((charge / cost) * 100) / 100);
    }
    const total = [...out.values()].reduce((s, x) => s + x, 0);
    console.log(`watchmen: ${out.size} buildings, ${total.toFixed(2)} watchmen × ${cost.toLocaleString('en-US')} = ${Math.round(total * cost).toLocaleString('en-US')}`);
    if (apply)
      await db.transaction(async (tx) => {
        for (const [propertyId, share] of out)
          await tx
            .insert(schema.bohWatchmen)
            .values({ versionId: v.id, propertyId, share })
            .onConflictDoUpdate({ target: [schema.bohWatchmen.versionId, schema.bohWatchmen.propertyId], set: { share, updatedAt: new Date() } });
        await tx.insert(schema.auditLog).values({ versionId: v.id, entity: 'boh_watchmen', action: 'import', changes: { file, buildings: out.size } });
      });
  }
  if (unmatched.length) console.log('not in the budget:', unmatched.join(', '));
  if (apply) console.log('Imported');
}

// close the pool before exiting: an abrupt disconnect can jam the PGlite dev server
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
