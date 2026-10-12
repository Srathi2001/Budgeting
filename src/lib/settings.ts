// Mappings that apply to every version (app_settings), edited in Admin → Mappings (audit FIN-019). They
// used to be written into the code for 2026. Read through getSettings(): a short cache, refreshed on save.
import { db, schema } from '@/db';
import { setMallCodes } from '@/lib/budget/group';

export interface AppSettings {
  /** first year the tool reports (Oracle revenue actuals and GL imports start then) */
  firstReportYear: number;
  /** GL company → the business unit its company-level lines go to, per Oracle ledger */
  glCompanies: Record<string, Record<string, string>>;
  /** property code prefixes that make up the Mall (a group entity of its own inside REHL-MJN) */
  mallCodes: string[];
  /** properties let as a whole building (rent per sq ft groups them apart), by name */
  wholeBuildingNames: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  firstReportYear: 2024,
  glCompanies: {
    'MJN HOLDING': { '501': '501', '502': '502', '503': '522', '521': '521', '522': '522' },
    'MJN PRIVATE OFFICE': { '703': '703', '751': '751' },
  },
  mallCodes: ['10B131'],
  wholeBuildingNames: ['MIRDIFF SHOPPING MALL', 'MJN AL WARQAA SCHOOL', 'AL RAFA BUILDING (PLAZA 2)'],
};
export type SettingKey = keyof AppSettings;

let cached: { at: number; s: AppSettings } | null = null;

export async function getSettings(): Promise<AppSettings> {
  if (cached && Date.now() - cached.at < 30_000) return cached.s;
  const rows = await db.select().from(schema.appSettings);
  const s: AppSettings = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) (s as unknown as Record<string, unknown>)[r.key] = r.value;
  // the Mall's codes are read by pure functions (group.ts): set them there
  setMallCodes(s.mallCodes);
  cached = { at: Date.now(), s };
  return s;
}

export function settingsChanged() {
  cached = null;
}
