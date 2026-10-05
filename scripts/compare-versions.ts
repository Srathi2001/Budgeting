// Prints revenue by property for two versions side by side. Usage: npx tsx scripts/compare-versions.ts 1 2
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../src/db';

async function main() {
  const [a, b] = process.argv.slice(2).map(Number);
  const { rows } = await db.execute(sql`
    select p.code, p.name,
      coalesce(sum(m.revenue) filter (where m.version_id = ${a}), 0)::float as a,
      coalesce(sum(m.revenue) filter (where m.version_id = ${b}), 0)::float as b,
      coalesce(sum(m.cash) filter (where m.version_id = ${b}), 0)::float as cash_b
    from properties p left join line_monthly m on m.property_id = p.id
    group by p.code, p.name order by p.code`);
  let ta = 0, tb = 0, tc = 0;
  for (const r of rows as { code: string; name: string; a: number; b: number; cash_b: number }[]) {
    ta += r.a; tb += r.b; tc += r.cash_b;
    const pct = r.a ? ((r.b - r.a) / r.a) * 100 : 0;
    console.log(`${r.code.padEnd(9)} ${r.name.slice(0, 30).padEnd(30)} ${r.a.toFixed(0).padStart(12)} ${r.b.toFixed(0).padStart(12)} ${pct.toFixed(1).padStart(7)}%  cash ${r.cash_b.toFixed(0).padStart(12)}`);
  }
  console.log(`TOTAL${' '.repeat(36)}${ta.toFixed(0).padStart(12)} ${tb.toFixed(0).padStart(12)} ${(((tb - ta) / ta) * 100).toFixed(1).padStart(7)}%  cash ${tc.toFixed(0).padStart(12)}`);
  const { rows: w } = await db.execute(sql`
    select jsonb_array_elements_text(calc->'warnings') as w, count(*)::int as n
    from lease_lines where version_id = ${b} group by 1 order by 2 desc`);
  console.log('\nWarnings in version', b, w);
  process.exit(0);
}
main();
