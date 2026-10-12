// Permission rules, independent of the request (usable from server actions and scripts).
//
// Who does what (user decision, 11-Oct-2026): each department enters its own data, everything else is
// Admin's.
// - Property managers: the inputs of their own properties (Lease Budget, RERA, Other Income property rows,
//   their building overhead accounts and service contracts), and submit them.
// - Facilities management: the FM budget (works and labour), and submit the facilities.
// - Finance: Finance's inputs (Admin overheads and fees, the Finance building overhead accounts, insurance
//   and security allocation, Other Income General rows), and comments.
// - Admin: approves and returns, locks and reopens versions, assumptions, imports, comparatives,
//   properties and users; it may also enter any data.
// Nobody changes a submitted or approved property or facility: Admin returns it first (Finance's own inputs
// on a property stay open until Admin approves it).
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Exec } from '@/lib/write-guard';
import { perRequest } from '@/lib/request-memo';

export type Actor = Pick<schema.User, 'id' | 'name' | 'email' | 'role' | 'coordinator'>;

/** Finance or Admin: sees everything, enters Finance's data. */
export function isFinance(user: Actor) {
  return user.role === 'ADMIN' || user.role === 'FINANCE';
}

export function isAdmin(user: Actor) {
  return user.role === 'ADMIN';
}

export function isFm(user: Actor) {
  return user.role === 'FM';
}

/** whose data an input is: the property manager's or Finance's */
export type InputOwner = 'PM' | 'FIN';

/** May the user enter this department's data at all? Admin may enter everything. */
export function entersData(user: Actor, owner: InputOwner | 'FM'): boolean {
  if (isAdmin(user)) return true;
  if (owner === 'PM') return user.role === 'PM';
  if (owner === 'FIN') return user.role === 'FINANCE';
  return user.role === 'FM';
}

const OWNER_NAME: Record<InputOwner, string> = { PM: 'the property manager', FIN: 'Finance' };
const frozen = (status: string, what: string) => `This ${what} is ${status.toLowerCase()}; Admin returns it for changes`;

/** Properties the user may see. PMs see their own (coordinator); finance and FM (facilities management) see all. (Once per request.) */
export const visibleProperties = perRequest('visibleProperties', (user: Actor) => `${user.id}|${user.role}|${user.coordinator}`, visiblePropertiesNow);

async function visiblePropertiesNow(user: Actor) {
  const p = schema.properties;
  const rows = await db.select().from(p).where(eq(p.active, true)).orderBy(p.buCode, p.code);
  return isFinance(user) || isFm(user) ? rows : rows.filter((r) => r.coordinator === user.coordinator);
}

/**
 * Property ids whose inputs the user may change in a version: open version, property neither submitted
 * nor approved, and (with `owner`) the user enters that department's data. Without `owner`: any input
 * of the property (the page then decides per input).
 */
export async function editablePropertyIds(user: Actor, version: schema.BudgetVersion, owner?: InputOwner): Promise<Set<number>> {
  if (version.status === 'LOCKED' || isFm(user)) return new Set();
  if (owner && !entersData(user, owner)) return new Set();
  const visible = await visibleProperties(user);
  const subs = await db.select().from(schema.submissions).where(eq(schema.submissions.versionId, version.id));
  const held = new Set(subs.filter((s) => s.status === 'APPROVED' || (s.status === 'SUBMITTED' && owner !== 'FIN')).map((s) => s.propertyId));
  return new Set(visible.filter((p) => !held.has(p.id)).map((p) => p.id));
}

export type EditCheck = { ok: true } | { ok: false; reason: string };

/**
 * Can the user change the FM budget of this facility? FM (and Admin) until it is submitted. `on`: the save's
 * transaction (after writeGuard), so the answer holds until the save commits.
 */
export async function canEditFm(user: Actor, versionId: number, propertyId: number, on: Exec = db): Promise<EditCheck> {
  const [version] = await on.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version) return { ok: false, reason: 'Version not found' };
  if (version.status === 'LOCKED') return { ok: false, reason: 'This budget version is locked' };
  if (!entersData(user, 'FM')) return { ok: false, reason: 'The FM budget is entered by facilities management' };
  const [sub] = await on.select().from(schema.fmSubmissions).where(and(eq(schema.fmSubmissions.versionId, versionId), eq(schema.fmSubmissions.propertyId, propertyId)));
  if (sub && (sub.status === 'SUBMITTED' || sub.status === 'APPROVED')) return { ok: false, reason: frozen(sub.status, 'facility') };
  return { ok: true };
}

/**
 * Can the user change this input of a property in this version? `owner`: whose input it is (the property
 * manager's by default; Finance's for the Finance building overhead accounts). `on`: the save's transaction
 * (after writeGuard), so the answer holds until the save commits.
 */
export async function canEditProperty(user: Actor, versionId: number, propertyId: number, owner: InputOwner = 'PM', on: Exec = db): Promise<EditCheck> {
  const [version] = await on.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version) return { ok: false, reason: 'Version not found' };
  if (version.status === 'LOCKED') return { ok: false, reason: 'This budget version is locked' };
  if (isFm(user)) return { ok: false, reason: 'Facilities management enters the FM budget only' };
  if (!entersData(user, owner)) return { ok: false, reason: `Entered by ${OWNER_NAME[owner]}` };
  const [prop] = await on.select().from(schema.properties).where(eq(schema.properties.id, propertyId));
  if (!prop) return { ok: false, reason: 'Property not found' };
  if (user.role === 'PM' && prop.coordinator !== user.coordinator) return { ok: false, reason: 'Not your property' };
  const [sub] = await on
    .select()
    .from(schema.submissions)
    .where(and(eq(schema.submissions.versionId, versionId), eq(schema.submissions.propertyId, propertyId)));
  // the property manager's submission freezes their inputs; Finance's inputs on the property stay open
  // until Admin approves the property
  const held = owner === 'FIN' ? sub?.status === 'APPROVED' : sub?.status === 'SUBMITTED' || sub?.status === 'APPROVED';
  if (sub && held) return { ok: false, reason: frozen(sub.status, 'property') };
  return { ok: true };
}

