// Back-up schedules of the admin overheads, as the sheets of the 2026 department G&A templates
// (GA Budget Template _<Dept>_2026): Vehicles, Telephone, Training Plan, Staff Welfare, IT Cost, OH CAPEX,
// and other items (employee relations, subscriptions…). Each item is entered in a form and posts to GL
// accounts; office and IT capex is paid, not expensed (cash flow only). Shared by server and browser.

import { DEPTS } from './admin-types';

export type ItemKind = 'vehicle' | 'phone' | 'training' | 'event' | 'it' | 'capex' | 'other';

export type FieldType = 'text' | 'amount' | 'int' | 'month' | 'select' | 'account' | 'paxByDept';
export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  options?: readonly string[];
  /** the GL account an amount field posts to */
  account?: string;
  wide?: boolean;
  required?: boolean;
  hint?: string;
}

/** posts to the office & IT capex line (cash flow only), not to a GL expense account */
export const CAPEX = 'CAPEX';

export interface Posting {
  dept: string;
  /** GL account, or CAPEX */
  account: string;
  amount: number;
  /** month paid (1–12); null = evenly over the year */
  month: number | null;
}

export interface ItemKindSpec {
  kind: ItemKind;
  label: string;
  /** one item, for buttons ("Add vehicle") */
  one: string;
  /** the 2026 template sheet it replaces */
  sheet: string;
  fields: FieldSpec[];
  /** list columns: field keys */
  columns: string[];
  /** what the item posts, given its owner department */
  postings: (data: ItemData, dept: string) => Posting[];
}

export type ItemData = Record<string, string | number | null | Record<string, number>>;

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const m = (v: unknown) => (typeof v === 'number' && v >= 1 && v <= 12 ? v : null);

export const CAPEX_CATEGORIES = ['Vehicles', 'Furniture & fixtures', 'IT equipment', 'Time & attendance', 'Tools & equipment', 'Office renovation', 'Others'] as const;
export const PHONE_LINES = [
  { label: 'Telephone', account: '64251' },
  { label: 'Mobile / GSM', account: '64252' },
  { label: 'Internet', account: '64253' },
  { label: 'Telephone - other', account: '64255' },
] as const;

const VEHICLE_COSTS: FieldSpec[] = [
  { key: 'insurance', label: 'Insurance', type: 'amount', account: '64602' },
  { key: 'registration', label: 'Registration & renewal', type: 'amount', account: '64655' },
  { key: 'fuel', label: 'Fuel', type: 'amount', account: '64651' },
  { key: 'salik', label: 'Salik & parking', type: 'amount', account: '64653' },
  { key: 'repairs', label: 'Repairs & maintenance', type: 'amount', account: '64652' },
  { key: 'rental', label: 'Rental', type: 'amount', account: '64851' },
  { key: 'cleaning', label: 'Cleaning', type: 'amount', account: '64654' },
  { key: 'hire', label: 'Hire', type: 'amount', account: '64656' },
  { key: 'otherCost', label: 'Other vehicle costs', type: 'amount', account: '64658' },
];
const IT_COSTS: FieldSpec[] = [
  { key: 'laptop', label: 'Laptop', type: 'amount' },
  { key: 'monitor', label: 'Monitor', type: 'amount' },
  { key: 'hub', label: 'USB hub', type: 'amount' },
  { key: 'keyboard', label: 'Keyboard / mouse', type: 'amount' },
];

export const ITEM_KINDS: ItemKindSpec[] = [
  {
    kind: 'vehicle',
    label: 'Vehicles',
    one: 'vehicle',
    sheet: 'Vehicles',
    fields: [
      { key: 'name', label: 'Vehicle', type: 'text', required: true },
      { key: 'reg', label: 'Reg no', type: 'text' },
      { key: 'user', label: 'User', type: 'text' },
      { key: 'type', label: 'Rental / owned / personal', type: 'select', options: ['Rental', 'Owned', 'Personal'], required: true },
      ...VEHICLE_COSTS,
    ],
    columns: ['name', 'reg', 'user', 'type'],
    postings: (d, dept) => VEHICLE_COSTS.filter((f) => n(d[f.key])).map((f) => ({ dept, account: f.account!, amount: n(d[f.key]), month: null })),
  },
  {
    kind: 'phone',
    label: 'Telephone',
    one: 'number',
    sheet: 'Telephone',
    fields: [
      { key: 'number', label: 'Number', type: 'text', required: true },
      { key: 'user', label: 'User', type: 'text' },
      { key: 'line', label: 'Line', type: 'select', options: PHONE_LINES.map((l) => l.label), required: true },
      { key: 'monthly', label: 'Monthly charge', type: 'amount', required: true, hint: '× 12 for the year' },
    ],
    columns: ['number', 'user', 'line'],
    postings: (d, dept) => {
      const acct = PHONE_LINES.find((l) => l.label === d.line)?.account ?? '64251';
      return n(d.monthly) ? [{ dept, account: acct, amount: n(d.monthly) * 12, month: null }] : [];
    },
  },
  {
    kind: 'training',
    label: 'Training plan',
    one: 'training',
    sheet: 'Training Plan',
    fields: [
      { key: 'subject', label: 'Training', type: 'text', required: true, wide: true },
      { key: 'provider', label: 'Provider / comments', type: 'text', wide: true },
      { key: 'month', label: 'Month', type: 'month', hint: 'blank = evenly over the year' },
      { key: 'costPerPax', label: 'Cost per attendee', type: 'amount', required: true },
      { key: 'pax', label: 'Attendees by department', type: 'paxByDept', wide: true, required: true, hint: 'each department is charged its attendees × the cost' },
    ],
    columns: ['subject', 'provider', 'month'],
    postings: (d) => {
      const pax = (d.pax ?? {}) as Record<string, number>;
      return Object.entries(pax)
        .filter(([, p]) => n(p) > 0)
        .map(([dept, p]) => ({ dept, account: '63602', amount: n(p) * n(d.costPerPax), month: m(d.month) }));
    },
  },
  {
    kind: 'event',
    label: 'Staff welfare',
    one: 'event',
    sheet: 'G&A (Staff Welfare)',
    fields: [
      { key: 'name', label: 'Event', type: 'text', required: true, wide: true },
      { key: 'amount', label: 'Amount', type: 'amount', required: true },
      { key: 'month', label: 'Month', type: 'month', hint: 'blank = evenly over the year' },
    ],
    columns: ['name', 'month'],
    postings: (d, dept) => (n(d.amount) ? [{ dept, account: '63601', amount: n(d.amount), month: m(d.month) }] : []),
  },
  {
    kind: 'it',
    label: 'IT equipment',
    one: 'IT request',
    sheet: 'IT Cost',
    fields: [
      { key: 'employee', label: 'Employee', type: 'text', hint: 'or "New position"' },
      { key: 'position', label: 'Position', type: 'text', required: true },
      { key: 'type', label: 'New / replacement', type: 'select', options: ['Replacement', 'New'], required: true },
      { key: 'month', label: 'Month', type: 'month', hint: 'blank = evenly over the year' },
      ...IT_COSTS,
      { key: 'remarks', label: 'Remarks', type: 'text', wide: true },
    ],
    columns: ['employee', 'position', 'type'],
    postings: (d, dept) => {
      const total = IT_COSTS.reduce((s, f) => s + n(d[f.key]), 0);
      return total ? [{ dept, account: CAPEX, amount: total, month: m(d.month) }] : [];
    },
  },
  {
    kind: 'capex',
    label: 'Office capex',
    one: 'capex item',
    sheet: 'OH CAPEX',
    fields: [
      { key: 'category', label: 'Category', type: 'select', options: CAPEX_CATEGORIES, required: true },
      { key: 'description', label: 'Description', type: 'text', required: true, wide: true },
      { key: 'location', label: 'Asset location, owner', type: 'text', wide: true },
      { key: 'amount', label: 'Amount', type: 'amount', required: true },
      { key: 'month', label: 'Month', type: 'month', hint: 'blank = evenly over the year' },
    ],
    columns: ['category', 'description', 'location'],
    postings: (d, dept) => (n(d.amount) ? [{ dept, account: CAPEX, amount: n(d.amount), month: m(d.month) }] : []),
  },
  {
    kind: 'other',
    label: 'Other items',
    one: 'item',
    sheet: 'Employee relations, subscriptions and other lines',
    fields: [
      { key: 'description', label: 'Description', type: 'text', required: true, wide: true },
      { key: 'account', label: 'GL account', type: 'account', required: true, wide: true },
      { key: 'amount', label: 'Amount (year)', type: 'amount', required: true },
      { key: 'month', label: 'Month', type: 'month', hint: 'blank = evenly over the year' },
    ],
    columns: ['description', 'account', 'month'],
    postings: (d, dept) => (n(d.amount) && typeof d.account === 'string' ? [{ dept, account: d.account, amount: n(d.amount), month: m(d.month) }] : []),
  },
];
export const ITEM_KIND = new Map(ITEM_KINDS.map((k) => [k.kind, k]));

/**
 * GL accounts that have their own back-up schedule: their budget is entered only there (the Overview
 * shows the schedule's total, locked). Other items can't post to them.
 */
export const SCHEDULE_ACCOUNT = new Map<string, ItemKind>([
  ...VEHICLE_COSTS.map((f) => [f.account!, 'vehicle'] as [string, ItemKind]),
  ...PHONE_LINES.map((l) => [l.account, 'phone'] as [string, ItemKind]),
  ['63602', 'training'],
  ['63601', 'event'],
]);
export const isItemKind = (s: string): s is ItemKind => ITEM_KIND.has(s as ItemKind);

export interface AdminItem {
  id: number;
  kind: ItemKind;
  dept: string;
  payer: string;
  data: ItemData;
}

/** an item's year total */
export const itemTotal = (it: Pick<AdminItem, 'kind' | 'dept' | 'data'>) => ITEM_KIND.get(it.kind)!.postings(it.data, it.dept).reduce((s, p) => s + p.amount, 0);

/** Checks and cleans an item's fields; returns the error or the data to store. */
export function cleanItem(kind: ItemKind, data: ItemData, accounts: Set<string>): { error: string } | { data: ItemData } {
  const spec = ITEM_KIND.get(kind)!;
  const out: ItemData = {};
  const deptCodes = new Set(DEPTS.map((d) => d.code));
  for (const f of spec.fields) {
    const v = data[f.key];
    if (v === undefined || v === null || v === '') {
      if (f.required) return { error: `${f.label}: required` };
      out[f.key] = null;
      continue;
    }
    switch (f.type) {
      case 'text':
        out[f.key] = String(v).trim().slice(0, 200);
        break;
      case 'amount':
      case 'int':
      case 'month': {
        const x = Number(v);
        if (!Number.isFinite(x) || x < 0 || (f.type !== 'amount' && !Number.isInteger(x)) || (f.type === 'month' && (x < 1 || x > 12)) || x > 1e10)
          return { error: `${f.label}: ${f.type === 'month' ? 'a month 1–12' : 'a number of 0 or more'}` };
        out[f.key] = f.type === 'amount' ? Math.round(x * 100) / 100 : x;
        break;
      }
      case 'select':
        if (!f.options?.includes(String(v))) return { error: `${f.label}: choose one` };
        out[f.key] = String(v);
        break;
      case 'account': {
        const tab = SCHEDULE_ACCOUNT.get(String(v));
        if (tab) return { error: `${f.label}: ${v} is entered in the ${ITEM_KIND.get(tab)!.label} tab` };
        if (!accounts.has(String(v))) return { error: `${f.label}: choose an admin overhead account` };
      }
        out[f.key] = String(v);
        break;
      case 'paxByDept': {
        const pax: Record<string, number> = {};
        for (const [d, p] of Object.entries(typeof v === 'object' ? v : {})) {
          const x = Number(p);
          if (!deptCodes.has(d) || !Number.isInteger(x) || x < 0) return { error: `${f.label}: whole numbers per department` };
          if (x > 0) pax[d] = x;
        }
        if (f.required && !Object.keys(pax).length) return { error: `${f.label}: required` };
        out[f.key] = pax;
        break;
      }
    }
  }
  if (!spec.postings(out, DEPTS[0].code).some((p) => p.amount > 0)) return { error: 'Enter an amount' };
  return { data: out };
}
