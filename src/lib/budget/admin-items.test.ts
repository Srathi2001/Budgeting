import { describe, expect, it } from 'vitest';
import { CAPEX, ITEM_KIND, SCHEDULE_ACCOUNT, cleanItem, itemTotal } from './admin-items';
import { ADMIN_ACCOUNTS } from './admin-types';

const accounts = new Set(['63603', '64504']);
const post = (kind: Parameters<typeof ITEM_KIND.get>[0], data: Record<string, unknown>, dept = '207') => ITEM_KIND.get(kind)!.postings(data as never, dept);

describe('admin overhead back-up schedules (2026 template sheets)', () => {
  it('a vehicle posts each cost to its GL account, evenly over the year', () => {
    const p = post('vehicle', { name: 'Nissan Sunny', type: 'Rental', fuel: 7032, salik: 336, rental: 14994 }, '201');
    expect(p).toEqual([
      { dept: '201', account: '64651', amount: 7032, month: null },
      { dept: '201', account: '64653', amount: 336, month: null },
      { dept: '201', account: '64851', amount: 14994, month: null },
    ]);
    expect(itemTotal({ kind: 'vehicle', dept: '201', data: { fuel: 7032, salik: 336, rental: 14994 } })).toBe(22362); // the 2026 Finance car
  });

  it('a telephone is the monthly charge × 12 on its line', () => {
    expect(post('phone', { number: '0562190341', line: 'Telephone', monthly: 945 })).toEqual([{ dept: '207', account: '64251', amount: 11340, month: null }]);
    expect(post('phone', { number: 'x', line: 'Internet', monthly: 100 })[0].account).toBe('64253');
  });

  it('training charges each department its attendees × the cost per attendee', () => {
    // 2026: Microsoft BI Data Analyst, 840 per attendee: Finance 5, HR 3, FM 2
    const p = post('training', { subject: 'BI', costPerPax: 840, month: 4, pax: { '201': 5, '207': 3, '206': 2 } });
    expect(p).toEqual([
      { dept: '201', account: '63602', amount: 4200, month: 4 },
      { dept: '206', account: '63602', amount: 1680, month: 4 },
      { dept: '207', account: '63602', amount: 2520, month: 4 },
    ]);
  });

  it('staff welfare events fall in their month; IT and office capex are capex (cash only)', () => {
    expect(post('event', { name: 'Iftar', amount: 35000, month: 3 })).toEqual([{ dept: '207', account: '63601', amount: 35000, month: 3 }]);
    expect(post('it', { position: 'PC', type: 'New', laptop: 3800, monitor: 550, keyboard: 150 })[0]).toEqual({ dept: '207', account: CAPEX, amount: 4500, month: null });
    expect(post('capex', { category: 'Office renovation', description: 'Pantry', amount: 30000 })[0].account).toBe(CAPEX);
  });

  it('every vehicle and telephone account, training and staff welfare are entered only in their tabs', () => {
    const vehicles = ADMIN_ACCOUNTS.filter((a) => a.group === 'Vehicles').map((a) => a.code);
    expect(vehicles.every((c) => SCHEDULE_ACCOUNT.get(c) === 'vehicle')).toBe(true);
    expect(['64251', '64252', '64253', '64255'].every((c) => SCHEDULE_ACCOUNT.get(c) === 'phone')).toBe(true);
    expect(SCHEDULE_ACCOUNT.get('63602')).toBe('training');
    expect(SCHEDULE_ACCOUNT.get('63601')).toBe('event');
    // stationery, audit… stay typed in the Overview
    expect(SCHEDULE_ACCOUNT.has('64501')).toBe(false);
    expect(SCHEDULE_ACCOUNT.has('64301')).toBe(false);
  });

  it('checks the fields: required, numbers, choices, accounts', () => {
    expect(cleanItem('vehicle', { type: 'Rental', fuel: 100 }, accounts)).toEqual({ error: 'Vehicle: required' });
    expect(cleanItem('vehicle', { name: 'Car', type: 'Leased', fuel: 100 }, accounts)).toEqual({ error: 'Rental / owned / personal: choose one' });
    expect(cleanItem('vehicle', { name: 'Car', type: 'Owned' }, accounts)).toEqual({ error: 'Enter an amount' });
    expect(cleanItem('other', { description: 'Job portal', account: '99999', amount: 30000 }, accounts)).toEqual({ error: 'GL account: choose an admin overhead account' });
    const ok = cleanItem('other', { description: 'Job portal', account: '64504', amount: '30000' as never }, accounts);
    expect(ok).toEqual({ data: { description: 'Job portal', account: '64504', amount: 30000, month: null } });
    expect(cleanItem('event', { name: 'Day', amount: 100, month: 13 }, accounts)).toEqual({ error: 'Month: a month 1–12' });
  });
});
