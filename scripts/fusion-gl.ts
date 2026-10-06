// Read-only probe of Fusion General Ledger data visible to this login: ledgers, and account
// balances for a ledger / period / account pattern.
//
//   npx tsx scripts/fusion-gl.ts ledgers
//   npx tsx scripts/fusion-gl.ts balances "<ledger name>" <period e.g. Sep-26> "<account combination pattern>"
import 'dotenv/config';

const base = (process.env.FUSION_URL ?? '').replace(/\/+$/, '');
const auth = `Basic ${Buffer.from(`${process.env.FUSION_USER}:${process.env.FUSION_PASSWORD}`).toString('base64')}`;
const api = `${base}/fscmRestApi/resources/11.13.18.05`;

async function get(path: string) {
  const res = await fetch(`${api}/${path}`, { headers: { Authorization: auth, Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)}`);
  return JSON.parse(text) as { items: Record<string, unknown>[]; hasMore?: boolean };
}

async function main() {
  const [cmd, ledger, period, account] = process.argv.slice(2);
  if (cmd === 'ledgers') {
    const r = await get('ledgersLOV?limit=100&onlyData=true&fields=Name,Description,CurrencyCode,ChartOfAccountsId,LedgerCategoryCode');
    for (const l of r.items) console.log(`${String(l.Name).padEnd(28)} ${String(l.CurrencyCode).padEnd(4)} COA ${l.ChartOfAccountsId}  ${l.LedgerCategoryCode}  ${l.Description}`);
    return;
  }
  if (cmd === 'balances') {
    const finder = `AccountBalanceFinder;ledgerName=${ledger},accountingPeriod=${period},accountCombination=${account},currency=AED,mode=Detail`;
    const r = await get(`ledgerBalances?finder=${encodeURIComponent(finder)}&limit=500&onlyData=true`);
    console.log(`${r.items.length} balance rows${r.hasMore ? ' (more)' : ''}`);
    for (const b of r.items.slice(0, 40)) console.log('  ', JSON.stringify(b).slice(0, 260));
    return;
  }
  console.log('usage: fusion-gl.ts ledgers | balances <ledger> <period> <account pattern>');
}

main().catch((e) => {
  console.error('FAILED', (e as Error).message);
  process.exit(1);
});
