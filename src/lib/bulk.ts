// Writing many rows in a few statements instead of one round trip per row (each round trip costs 1–2 ms
// once the database is across the network, e.g. Azure).
import { getTableColumns, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Tx } from '@/lib/write-guard';

/**
 * Updates rows of a table by id: `set` as drizzle's .set() takes it (undefined = left as it is). Rows that set
 * the same columns go in one statement (up to `chunk` rows each).
 */
export async function bulkUpdate(tx: Tx, table: PgTable, rows: { id: number; set: Record<string, unknown> }[], chunk = 200) {
  const cols = getTableColumns(table) as Record<string, PgColumn>;
  const groups = new Map<string, { keys: string[]; rows: typeof rows }>();
  for (const r of rows) {
    const keys = Object.keys(r.set)
      .filter((k) => r.set[k] !== undefined)
      .sort();
    if (!keys.length) continue;
    for (const k of keys) if (!cols[k]) throw new Error(`bulkUpdate: no column ${k}`);
    const sig = keys.join(',');
    const g = groups.get(sig) ?? { keys, rows: [] };
    g.rows.push(r);
    groups.set(sig, g);
  }
  for (const { keys, rows: list } of groups.values()) {
    const names = keys.map((k) => sql.identifier(cols[k].name));
    for (let i = 0; i < list.length; i += chunk) {
      const values = list.slice(i, i + chunk).map((r) => {
        const cells = keys.map((k) => {
          const c = cols[k];
          const v = r.set[k];
          return sql`${v === null ? null : c.mapToDriverValue(v)}::${sql.raw(c.getSQLType())}`;
        });
        return sql`(${r.id}::int, ${sql.join(cells, sql`, `)})`;
      });
      await tx.execute(sql`
        update ${table} as t set ${sql.join(
          keys.map((k, j) => sql`${names[j]} = v.${names[j]}`),
          sql`, `,
        )}
        from (values ${sql.join(values, sql`, `)}) as v(id, ${sql.join(names, sql`, `)})
        where t.id = v.id`);
    }
  }
}
