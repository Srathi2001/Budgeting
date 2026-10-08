// Oracle Fusion purchase orders → the contract schedules of the building overheads (AMC tabs).
//
// Read through the Procurement REST API with the tool's Fusion login (read only): the POs raised in the
// year before the budget year, their lines and distributions. A distribution charged to a building and
// to an account of a schedule (security, cleaning, pest control, …) becomes a contract row with the PO's
// supplier, line description, quantity × price and terms. Contract lines (AMC categories, or recurring)
// are taken; one-off jobs (direct maintenance) are counted, not added. A sync adds the new PO lines and
// refreshes the PO figures of the rows already there; what the property team changed stays.
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { CONTRACT_KIND_OF } from '@/lib/budget/boh-types';
import { termsOf } from '@/lib/budget/boh-calc';
import { propertyKey } from './tenant-lease';

const base = () => (process.env.FUSION_URL ?? '').replace(/\/+$/, '');
const auth = () => `Basic ${Buffer.from(`${process.env.FUSION_USER}:${process.env.FUSION_PASSWORD}`).toString('base64')}`;

async function get<T = { items: Record<string, unknown>[]; hasMore?: boolean }>(path: string): Promise<T> {
  const res = await fetch(`${base()}/fscmRestApi/resources/11.13.18.05/${path}`, { headers: { Authorization: auth(), Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Oracle ${res.status} on ${path.split('?')[0]}`);
  return res.json() as Promise<T>;
}

type Json = Record<string, unknown>;
/** a child collection as the API returns it: { items: [...] } or a plain list */
const list = (x: unknown): Json[] => (Array.isArray(x) ? x : ((x as { items?: Json[] } | null)?.items ?? [])) as Json[];

export interface PoLine {
  poNumber: string;
  poLine: string;
  status: string;
  supplier: string;
  category: string | null;
  description: string;
  building: string;
  account: string;
  quantity: number | null;
  rate: number | null;
  amount: number;
}

/** Contract-type lines of the POs created from `since` (YYYY-MM-DD), charged to a schedule account. */
export async function readPurchaseOrders(since: string, onProgress?: (done: number, total: number) => void): Promise<{ lines: PoLine[]; pos: number; skippedOneOff: number }> {
  if (!process.env.FUSION_URL || !process.env.FUSION_USER) throw new Error('The Oracle Fusion login is not set up (FUSION_URL / FUSION_USER)');
  const heads: Record<string, unknown>[] = [];
  for (let off = 0; ; off += 200) {
    const r = await get(`purchaseOrders?q=CreationDate>='${since}'&limit=200&offset=${off}&fields=POHeaderId,OrderNumber,StatusCode,Supplier`);
    heads.push(...r.items.filter((h) => !/CANCEL/i.test(String(h.StatusCode))));
    if (!r.hasMore) break;
  }
  const lines: PoLine[] = [];
  let skippedOneOff = 0;
  let done = 0;
  // a few POs at a time
  const queue = [...heads];
  const work = async () => {
    for (let h = queue.shift(); h; h = queue.shift()) {
      const r = await get<{ items: Json[] }>(`purchaseOrders/${h.POHeaderId}/child/lines?expand=schedules.distributions&limit=100`);
      for (const l of r.items) {
        const dists = list(l.schedules).flatMap((s) => list(s.distributions));
        for (const d of dists) {
          const seg = String(d.POChargeAccount ?? '').split('-');
          const account = seg[4];
          if (!account || !CONTRACT_KIND_OF.has(account) || !seg[3] || seg[3] === '000000') continue;
          const quantity = typeof (d.Quantity ?? l.Quantity) === 'number' ? Number(d.Quantity ?? l.Quantity) : null;
          const rate = typeof (l.Price ?? l.BasePrice) === 'number' ? Number(l.Price ?? l.BasePrice) : null;
          const amount = quantity !== null && rate !== null ? quantity * rate : (rate ?? 0) / Math.max(dists.length, 1);
          const description = String(l.Description ?? '').replace(/\s+/g, ' ').trim();
          const category = l.Category ? String(l.Category) : null;
          const recurring = /^AMC/i.test(category ?? '') || termsOf(description, quantity) !== 'One-off';
          if (!recurring) {
            skippedOneOff++;
            continue;
          }
          lines.push({
            poNumber: String(h.OrderNumber),
            poLine: String(l.LineNumber ?? l.POLineId),
            status: String(h.StatusCode ?? ''),
            supplier: String(h.Supplier ?? '').trim(),
            category,
            description,
            building: seg[3],
            account,
            quantity,
            rate,
            amount,
          });
        }
      }
      onProgress?.(++done, heads.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, work));
  return { lines, pos: heads.length, skippedOneOff };
}

export interface PoSyncResult {
  pos: number;
  lines: number;
  added: number;
  refreshed: number;
  skippedOneOff: number;
  byKind: Record<string, number>;
  /** building codes on POs that are not in the budget */
  unmatched: string[];
}

/** Writes the PO lines into the version's contract schedules. */
export async function applyPurchaseOrders(versionId: number, read: Awaited<ReturnType<typeof readPurchaseOrders>>, userId: number | null): Promise<PoSyncResult> {
  const props = await db.select({ id: schema.properties.id, code: schema.properties.code }).from(schema.properties);
  const byKey = new Map(props.map((p) => [propertyKey(p.code), p.id]));
  const existing = await db
    .select()
    .from(schema.bohContracts)
    .where(and(eq(schema.bohContracts.versionId, versionId), eq(schema.bohContracts.source, 'PO')));
  const keyOf = (po: string | null, line: string | null, propertyId: number, account: string) => `${po}|${line}|${propertyId}|${account}`;
  const have = new Map(existing.map((r) => [keyOf(r.poNumber, r.poLine, r.propertyId, r.account), r]));
  const unmatched = new Set<string>();
  const byKind: Record<string, number> = {};
  let added = 0;
  let refreshed = 0;
  // the same PO line on one building and account (several distributions): one row
  const merged = new Map<string, PoLine & { propertyId: number }>();
  for (const l of read.lines) {
    const propertyId = byKey.get(propertyKey(l.building));
    if (!propertyId) {
      unmatched.add(l.building);
      continue;
    }
    const k = keyOf(l.poNumber, l.poLine, propertyId, l.account);
    const m = merged.get(k);
    if (m) {
      m.amount += l.amount;
      if (m.quantity !== null && l.quantity !== null) m.quantity += l.quantity;
    } else merged.set(k, { ...l, propertyId });
  }
  await db.transaction(async (tx) => {
    for (const [k, l] of merged) {
      const kind = CONTRACT_KIND_OF.get(l.account)!;
      byKind[kind] = (byKind[kind] ?? 0) + 1;
      const po = { poNumber: l.poNumber, poLine: l.poLine, poCategory: l.category, poStatus: l.status, poQuantity: l.quantity, poRate: l.rate, poAmount: Math.round(l.amount * 100) / 100 };
      const row = have.get(k);
      if (row) {
        await tx.update(schema.bohContracts).set(po).where(eq(schema.bohContracts.id, row.id));
        refreshed++;
        continue;
      }
      const quantity = l.quantity ?? 1;
      const rate = l.quantity !== null && l.rate !== null ? l.rate : l.amount;
      await tx.insert(schema.bohContracts).values({
        versionId,
        propertyId: l.propertyId,
        kind,
        account: l.account,
        supplier: l.supplier,
        description: l.description.slice(0, 1000),
        terms: termsOf(l.description, l.quantity),
        quantity,
        rate,
        source: 'PO',
        ...po,
        updatedBy: userId,
      });
      added++;
    }
    await tx.insert(schema.auditLog).values({
      userId,
      versionId,
      entity: 'po_sync',
      action: 'contracts_from_oracle',
      changes: { pos: read.pos, lines: merged.size, added, refreshed, skippedOneOff: read.skippedOneOff, unmatched: [...unmatched] },
    });
  });
  return { pos: read.pos, lines: merged.size, added, refreshed, skippedOneOff: read.skippedOneOff, byKind, unmatched: [...unmatched].sort() };
}
