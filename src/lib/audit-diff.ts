// What an audit row records about a change: the fields that changed, each with its value before and
// after (null and missing alike; a number stored as text equals the number).

export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

export function changedFields(old: Record<string, unknown>, next: Record<string, unknown>, ignore: string[] = []): FieldChanges {
  const out: FieldChanges = {};
  const same = (a: unknown, b: unknown) => {
    if ((a ?? null) === (b ?? null)) return true;
    if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b) && a !== null && b !== null;
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  };
  for (const [k, v] of Object.entries(next)) if (!ignore.includes(k) && !same(old[k], v)) out[k] = { from: old[k] ?? null, to: v ?? null };
  return out;
}

/** the listed fields of a row (for the "from" of a delete or the "to" of an insert) */
export const pick = <T extends Record<string, unknown>>(row: T, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
