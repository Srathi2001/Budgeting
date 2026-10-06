import { describe, expect, it } from 'vitest';
import { defaultMfRenewal } from './master-types';
import { oiCell, oiInput, type OiBlock } from './other-income-types';

const block = (over: Partial<OiBlock> = {}): OiBlock => ({
  scope: 'P:1', kind: 'P', propertyId: 1, buCode: '501', buName: 'REHL', code: '30B101', name: 'X', pm: null, editable: true, values: {}, mfBudget: 0, ...over,
});

describe('other income cells', () => {
  it('forecast = Jan–Sep actual + Oct–Dec', () => {
    const b = block({ values: { '52703': { YTD: 6000, OD: 2000 } } });
    expect(oiCell(b, '52703', 'F')).toBe(8000);
    expect(oiCell(b, '52704', 'F')).toBeNull();
  });
  it('maintenance service fee budget comes from the leases on property rows', () => {
    const b = block({ mfBudget: 12500, values: { '52702': { B: 999 } } });
    expect(oiCell(b, '52702', 'B')).toBe(12500);
    expect(oiInput(b, '52702', 'B')).toBe(false);
    expect(oiInput(b, '52702', 'OD')).toBe(true);
    expect(oiInput(b, '52702', 'YTD')).toBe(false);
  });
});

describe('MF on renewal default', () => {
  const row = { rc: 'R', renew1: true, noRenewal: false, mfCurrent: true, vacant: false };
  it('renewal follows the current lease', () => {
    expect(defaultMfRenewal(row)).toBe('YES');
    expect(defaultMfRenewal({ ...row, mfCurrent: false })).toBe('NO');
  });
  it('new tenant and vacant units: Yes', () => {
    expect(defaultMfRenewal({ ...row, renew1: false, mfCurrent: false })).toBe('YES');
    expect(defaultMfRenewal({ ...row, vacant: true, mfCurrent: null })).toBe('YES');
  });
  it('commercial: No', () => expect(defaultMfRenewal({ ...row, rc: 'C' })).toBe('NO'));
});
