// FMD budget file (FMD_Budget_<year>_….xlsx, Facilities Management Department): the year's FM budget
// lines (sheet "<year>_Budget_Template"), the facility master (FM zone, in service since, gross area,
// HVAC assets) and the staff budget (Labor_Allocation). Imported as that year's budget (e.g. 2026B), the
// reference FMD budgets the next year against; the next year itself is entered by FMD in the tool.
import { eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { db, schema } from '@/db';
import { elementOfGl, isWorkType, type FmKind, type StaffTeam, type WorkType } from '@/lib/budget/fm-types';
import { propertyKey } from './tenant-lease';

export interface FmdLine {
  facility: string;
  bu: string;
  workType: WorkType;
  element: string;
  subElement: string | null;
  description: string | null;
  businessNeed: string | null;
  remarks: string | null;
  amounts: Partial<Record<FmKind, number>>;
}
export interface FmdFacility {
  code: string;
  name: string;
  bu: string;
  zone: string | null;
  activeSince: string | null;
  grossArea: number | null;
  assets: Record<string, number> | null;
}
export interface FmdFile {
  year: number;
  lines: FmdLine[];
  facilities: FmdFacility[];
  staff: { team: StaffTeam; ctc: number; overtime: number }[];
}

const str = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' || String(v).trim() === 'N/A' ? null : String(v).trim());
const num = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,\s]/g, '')) || 0);
const dayOf = (v: unknown): string | null => {
  if (typeof v === 'number' && v > 0) {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null;
  }
  return null;
};

export function parseFmdFile(data: Buffer): FmdFile {
  const names = XLSX.read(data, { type: 'buffer', bookSheets: true }).SheetNames;
  const tpl = names.find((n) => /^\d{4}_Budget_Template$/.test(n));
  if (!tpl) throw new Error('This does not look like the FMD budget file (no "<year>_Budget_Template" sheet)');
  const year = Number(tpl.slice(0, 4));
  const labour = names.find((n) => /^Labor_Allocation/i.test(n));
  const wb = XLSX.read(data, { type: 'buffer', sheets: [tpl, 'Building Information', 'AC_ASSET', ...(labour ? [labour] : [])] });

  // ---- budget lines
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[tpl], { header: 1, raw: true, defval: null });
  const hi = rows.findIndex((r) => r.some((c) => c === 'WBS'));
  if (hi < 0) throw new Error(`${tpl}: no "WBS" header`);
  const h = rows[hi].map((c) => String(c ?? '').trim());
  const col = (re: RegExp) => h.findIndex((x) => re.test(x));
  const C = {
    bu: col(/^Business Unit$/), name: col(/^Facility Name$/), code: col(/^Facility Code$/), zone: col(/^FM Zone$/), sub: col(/^LCC Sub-Category$/),
    element: col(/^Building Element$/), subEl: col(/^Sub_Element/), desc: col(/^Description of Works$/), need: col(/^Business Need$/),
    base: col(new RegExp(`^${year}_Baseline$`)), prov: col(new RegExp(`^${year}-Provisional$`)), oc: col(new RegExp(`^${year}_OC$`)), remarks: col(/^Remarks$/),
  };
  for (const [k, i] of Object.entries(C)) if (i < 0) throw new Error(`${tpl}: column for "${k}" not found`);
  const data_ = rows.slice(hi + 1).filter((r) => typeof r[h.indexOf('WBS')] === 'string');
  const lines: FmdLine[] = [];
  const zones = new Map<string, { name: string; bu: string; zone: string | null }>();
  for (const r of data_) {
    const code = String(r[C.code]).trim();
    zones.set(code, { name: String(r[C.name] ?? '').trim(), bu: String(r[C.bu] ?? '').replace(/^_/, ''), zone: str(r[C.zone]) });
    const amounts: Partial<Record<FmKind, number>> = {};
    if (num(r[C.base])) amounts.PLANNED = num(r[C.base]);
    if (num(r[C.prov])) amounts.PROVISIONAL = num(r[C.prov]);
    if (num(r[C.oc])) amounts.COMMITTED = num(r[C.oc]);
    if (!Object.keys(amounts).length) continue;
    const wt = /(M0\d|R0\d)/.exec(String(r[C.sub]))?.[1] ?? '';
    const gl = /_(\d{5})_/.exec(`${r[C.element]}`)?.[1] ?? '';
    if (!isWorkType(wt) || !gl) continue;
    lines.push({
      facility: code,
      bu: String(r[C.bu] ?? '').replace(/^_/, ''),
      workType: wt,
      element: elementOfGl(gl),
      subElement: str(r[C.subEl]),
      description: str(r[C.desc]),
      businessNeed: str(r[C.need]),
      remarks: str(r[C.remarks]),
      amounts,
    });
  }

  // ---- facility master
  const info = new Map<string, Record<string, unknown>>();
  if (wb.Sheets['Building Information']) {
    for (const r of XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Building Information'], { raw: true, defval: null })) {
      const code = str(r['FACILITY NUMBER']);
      if (code) info.set(code, r);
    }
  }
  const assets = new Map<string, Record<string, number>>();
  if (wb.Sheets.AC_ASSET) {
    const ac = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.AC_ASSET, { header: 1, raw: true, defval: null });
    const ah = ac.findIndex((r) => r.some((c) => c === 'Facility Code'));
    const head = (ac[ah] ?? []).map((c) => String(c ?? '').trim());
    for (const r of ac.slice(ah + 1)) {
      const code = str(r[head.indexOf('Facility Code')]);
      if (!code) continue;
      const a: Record<string, number> = {};
      head.forEach((k, i) => {
        if (k && k !== 'Facility Code' && k !== 'Grand Total' && num(r[i])) a[k] = num(r[i]);
      });
      assets.set(code, a);
    }
  }
  const facilities: FmdFacility[] = [...zones].map(([code, z]) => {
    const i = info.get(code);
    const area = i ? Object.entries(i).find(([k]) => /GROSS AREA/i.test(k))?.[1] : null;
    return { code, name: z.name, bu: z.bu, zone: z.zone, activeSince: i ? dayOf(i['FACILITY ACTIVE SINCE']) : null, grossArea: area ? num(area) || null : null, assets: assets.get(code) ?? null };
  });

  // ---- staff (Labor_Allocation): cost to company and overtime per team, and the G&A allocation
  const staff: FmdFile['staff'] = [];
  if (labour) {
    const lr = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[labour], { header: 1, raw: true, defval: null });
    const pick = (re: RegExp) => lr.find((r) => re.test(String(r[0] ?? '').trim()));
    const add = (team: StaffTeam, re: RegExp) => {
      const r = pick(re);
      if (r) staff.push({ team, ctc: num(r[1]), overtime: num(r[2]) });
    };
    add('SUPERVISORY', /^OFFICE\/SUPERVISORY CTC/i);
    add('ZONE_1', /^ZONE 1 CTC/i);
    add('ZONE_2', /^ZONE 2 CTC/i);
    add('ZONE_3', /^ZONE 3 CTC/i);
    add('PPM', /^PPM CTC/i);
    add('VACANT', /^VACANT UNIT TEAMS/i);
    const ga = pick(/^G&A ALLOCATION/i);
    if (ga) staff.push({ team: 'GA', ctc: num(ga[1]), overtime: 0 });
  }
  return { year, lines, facilities, staff };
}

export interface FmdPreview {
  year: number;
  budgetVersion: string | null;
  lines: number;
  total: number;
  byWorkType: Record<string, number>;
  facilities: number;
  unmatched: { code: string; name: string; amount: number }[];
  staff: number;
}

async function plan(file: FmdFile) {
  const props = await db.select().from(schema.properties);
  const byKey = new Map(props.map((p) => [propertyKey(p.code), p]));
  const versions = await db.select().from(schema.budgetVersions);
  const budgetV = versions.filter((v) => v.year === file.year).sort((a, b) => b.id - a.id)[0] ?? null;
  const unmatched = new Map<string, { code: string; name: string; amount: number }>();
  const matched: (FmdLine & { propertyId: number })[] = [];
  for (const l of file.lines) {
    const p = byKey.get(propertyKey(l.facility));
    const amt = Object.values(l.amounts).reduce((s, v) => s + (v ?? 0), 0);
    if (!p) {
      const e = unmatched.get(l.facility) ?? { code: l.facility, name: file.facilities.find((f) => f.code === l.facility)?.name ?? '', amount: 0 };
      e.amount += amt;
      unmatched.set(l.facility, e);
      continue;
    }
    matched.push({ ...l, propertyId: p.id });
  }
  const total = (ls: FmdLine[]) => ls.reduce((s, l) => s + Object.values(l.amounts).reduce((x, v) => x + (v ?? 0), 0), 0);
  const byWorkType: Record<string, number> = {};
  for (const l of matched) byWorkType[l.workType] = (byWorkType[l.workType] ?? 0) + total([l]);
  const preview: FmdPreview = {
    year: file.year,
    budgetVersion: budgetV?.name ?? null,
    lines: matched.length,
    total: Math.round(total(matched)),
    byWorkType: Object.fromEntries(Object.entries(byWorkType).map(([k, v]) => [k, Math.round(v)])),
    facilities: new Set(matched.map((l) => l.propertyId)).size,
    unmatched: [...unmatched.values()].map((u) => ({ ...u, amount: Math.round(u.amount) })),
    staff: Math.round(file.staff.reduce((s, x) => s + x.ctc + x.overtime, 0)),
  };
  return { preview, matched, byKey, budgetV };
}

export async function previewFmdImport(file: FmdFile) {
  return (await plan(file)).preview;
}

export async function applyFmdImport(file: FmdFile, userId: number | null, fileName: string | null) {
  const { preview, matched, byKey, budgetV } = await plan(file);
  if (!budgetV) throw new Error(`No ${file.year} budget version to import the FM budget into`);
  const rowsOf = (versionId: number, ls: typeof matched, source: string) =>
    ls.flatMap((l) =>
      (Object.entries(l.amounts) as [FmKind, number][]).map(([kind, amount]) => ({
        versionId,
        propertyId: l.propertyId,
        workType: l.workType,
        element: l.element,
        subElement: l.subElement,
        description: l.description,
        businessNeed: l.businessNeed,
        kind,
        amount,
        month: null,
        remarks: l.remarks,
        source,
        updatedBy: userId,
      })),
    );
  await db.transaction(async (tx) => {
    // facility master: fixed for FMD
    for (const f of file.facilities) {
      const p = byKey.get(propertyKey(f.code));
      if (!p) continue;
      await tx.update(schema.properties).set({ fmZone: f.zone, fmActiveSince: f.activeSince, fmGrossArea: f.grossArea, fmAssets: f.assets }).where(eq(schema.properties.id, p.id));
    }
    // the file's year: its FM budget, replaced
    await tx.delete(schema.fmLines).where(eq(schema.fmLines.versionId, budgetV.id));
    const budgetRows = rowsOf(budgetV.id, matched, `FMD_${file.year}`);
    for (let i = 0; i < budgetRows.length; i += 500) await tx.insert(schema.fmLines).values(budgetRows.slice(i, i + 500));
    await tx.delete(schema.fmStaff).where(eq(schema.fmStaff.versionId, budgetV.id));
    if (file.staff.length) await tx.insert(schema.fmStaff).values(file.staff.map((s) => ({ versionId: budgetV.id, ...s, updatedBy: userId })));
    await tx.insert(schema.auditLog).values({ userId, versionId: budgetV.id, entity: 'fmd_import', action: 'fm_budget_file', changes: { file: fileName, ...preview } });
  });
  return preview;
}
