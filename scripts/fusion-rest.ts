// Read-only probe of Fusion REST resources: what this user can see, and which fields come back.
//
//   npx tsx scripts/fusion-rest.ts <resource> [query]       e.g.  receivablesInvoices "q=BusinessUnit='MJN'"
import 'dotenv/config';

const base = (process.env.FUSION_URL ?? '').replace(/\/+$/, '');
const auth = `Basic ${Buffer.from(`${process.env.FUSION_USER}:${process.env.FUSION_PASSWORD}`).toString('base64')}`;

async function probe(resource: string, query = '') {
  const url = `${base}/fscmRestApi/resources/11.13.18.05/${resource}?limit=3&totalResults=true${query ? `&${query}` : ''}`;
  const t0 = Date.now();
  const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
  const ms = Date.now() - t0;
  const text = await res.text();
  if (!res.ok) return console.log(`✗ ${resource}  HTTP ${res.status}  ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}`);
  const json = JSON.parse(text) as { totalResults?: number; count: number; items: Record<string, unknown>[] };
  console.log(`✓ ${resource}  total ${json.totalResults ?? '?'}  (${ms} ms)`);
  const first = json.items[0];
  if (!first) return;
  const fields = Object.entries(first).filter(([k, v]) => k !== 'links' && v !== null && v !== '');
  for (const [k, v] of fields.slice(0, 60)) console.log(`     ${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80)}`);
}

const [resource, query] = process.argv.slice(2);
(resource
  ? probe(resource, query)
  : (async () => {
      for (const r of ['receivablesInvoices', 'standardReceipts', 'receivablesCustomerAccountActivities', 'accounts', 'ledgerBalances']) await probe(r);
    })()
).catch((e) => {
  console.error('FAILED', (e as Error).message);
  process.exit(1);
});
