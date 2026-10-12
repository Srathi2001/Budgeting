// Reads an uploaded Account Analysis Report as a stream (the full-ledger export is hundreds of MB)
// and returns what the import would write; nothing is saved here (Admin → Account Analysis Report applies it).
// The MJN HOLDING report also carries the FM cost actuals (627xx / 117xx), returned as `fm`, and the
// building overhead actuals, returned as `boh`, and the G&A actuals by department, returned as `ga`.
// A data set the file does not carry is left as it is (and listed in `kept`); for each one replaced, the
// preview says how many rows it replaces with how many (`replace`).
// `ledger`: the ledger the upload is for (MJN HOLDING / MJN PRIVATE OFFICE); the report must be that ledger's.
// Not behind the proxy: the proxy buffers request bodies and cuts them at 10 MB.
import { getCurrentUser, isAdmin } from '@/lib/auth/dal';
import { db, schema } from '@/db';
import { scanAccountAnalysis } from '@/lib/import/gl-analysis';
import { isAdminAccount, planAdminActuals } from '@/lib/import/gl-admin';
import { isBohAccount, planBohActuals } from '@/lib/import/gl-boh';
import { isFmAccount, planFmActuals } from '@/lib/import/gl-fm';
import { countInScope } from '@/lib/import/gl-history';
import { glOtherIncomeScope, isGlLedger, isOtherIncome, planGlImport } from '@/lib/import/gl-other-income';

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return Response.json({ error: 'Admin access required' }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const versionId = Number(params.get('v'));
  const ledger = params.get('ledger');
  if (!versionId || !request.body) return Response.json({ error: 'Choose the Account Analysis Report' }, { status: 400 });
  if (ledger !== null && !isGlLedger(ledger)) return Response.json({ error: `Unknown ledger ${ledger}` }, { status: 400 });
  try {
    // one read for all: other income (52xxx), FM costs (627xx / 117xx) and building overheads
    const scan = await scanAccountAnalysis(request.body as unknown as AsyncIterable<Uint8Array>, (a) => isOtherIncome(a) || isFmAccount(a) || isBohAccount(a) || isAdminAccount(a));
    const holding = scan.ledger?.trim().toUpperCase() === 'MJN HOLDING';
    const fm = await planFmActuals(scan);
    const boh = await planBohActuals(scan);
    const ga = await planAdminActuals(scan);
    scan.months = scan.months.filter((m) => isOtherIncome(m.account));
    const oi = await planGlImport(versionId, scan, ledger ?? undefined);
    // what each part replaces, now (the apply counts again)
    const replace = {
      oi: { existing: isGlLedger(oi.preview.ledger) ? await countInScope('other_income', glOtherIncomeScope(versionId, oi.preview.ledger)) : 0, incoming: oi.values.length },
      fm: fm ? { existing: await countInScope('fm_actuals', { from: fm.preview.from, to: fm.preview.to }), incoming: fm.rows.length } : null,
      boh: boh ? { existing: await countInScope('boh_actuals', { from: boh.preview.from, to: boh.preview.to, accounts: boh.preview.accounts }), incoming: boh.rows.length } : null,
      ga: ga ? { existing: await countInScope('admin_actuals', { from: ga.preview.from, to: ga.preview.to, accounts: ga.preview.accounts }), incoming: ga.rows.length } : null,
    };
    const kept = holding
      ? [
          ...(fm ? [] : ['FM cost actuals: the file does not carry both the 627xx and the 117xx accounts, so they are kept as they are']),
          ...(boh ? [] : ['Building overhead actuals: no building overhead account in the file, kept as they are']),
          ...(ga ? [] : ['G&A actuals: no payroll or admin overhead account in the file, kept as they are']),
        ]
      : [];
    const file = params.get('file');
    // the rows stay on the server: the apply reads this plan back, never what the browser posts
    const [plan] = await db
      .insert(schema.importPlans)
      .values({ kind: 'gl', versionId, userId: user.id, file, payload: { values: oi.values, preview: oi.preview, fm, boh, ga } })
      .returning({ id: schema.importPlans.id });
    return Response.json({ planId: plan.id, preview: oi.preview, fm: fm && { preview: fm.preview }, boh: boh && { preview: boh.preview }, ga: ga && { preview: ga.preview }, replace, kept });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
