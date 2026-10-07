// Reads an uploaded Account Analysis Report as a stream (the full-ledger export is hundreds of MB)
// and returns what the import would write; nothing is saved here (Admin → Account Analysis Report applies it).
// The MJN HOLDING report also carries the FM cost actuals (627xx / 117xx), returned as `fm`.
// `ledger`: the ledger the upload is for (MJN HOLDING / MJN PRIVATE OFFICE); the report must be that ledger's.
// Not behind the proxy: the proxy buffers request bodies and cuts them at 10 MB.
import { getCurrentUser, isFinance } from '@/lib/auth/dal';
import { scanAccountAnalysis } from '@/lib/import/gl-analysis';
import { isFmAccount, planFmActuals } from '@/lib/import/gl-fm';
import { isGlLedger, isOtherIncome, planGlImport } from '@/lib/import/gl-other-income';

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isFinance(user)) return Response.json({ error: 'Finance access required' }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const versionId = Number(params.get('v'));
  const ledger = params.get('ledger');
  if (!versionId || !request.body) return Response.json({ error: 'Choose the Account Analysis Report' }, { status: 400 });
  if (ledger !== null && !isGlLedger(ledger)) return Response.json({ error: `Unknown ledger ${ledger}` }, { status: 400 });
  try {
    // one read for both: other income (52xxx) and FM costs (627xx / 117xx)
    const scan = await scanAccountAnalysis(request.body as unknown as AsyncIterable<Uint8Array>, (a) => isOtherIncome(a) || isFmAccount(a));
    const fm = await planFmActuals(scan);
    scan.months = scan.months.filter((m) => isOtherIncome(m.account));
    return Response.json({ ...(await planGlImport(versionId, scan, ledger ?? undefined)), fm });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
