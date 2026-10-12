import { describe, expect, it } from 'vitest';
import { oiCell, oiLabel, type OiBlock } from './other-income-types';

const block = (over: Partial<OiBlock> = {}): OiBlock => ({
  scope: 'P:1',
  kind: 'P',
  propertyId: 1,
  buCode: '501',
  buName: 'REHL',
  code: '30B101',
  name: 'Al Qusais',
  pm: null,
  editable: true,
  values: { '52401': { B: 30000 } },
  mfBudget: 0,
  ...over,
});

describe('2026B reference on Other Income', () => {
  it('shows last year’s budget and the change against it', () => {
    const b = block({ prior: { '52401': 25000, '52703': 8000 } });
    expect(oiCell(b, '52401', 'PB')).toBe(25000);
    expect(oiCell(b, '52401', 'CH')).toBe(5000);
    // budgeted last year only: the change is the whole of it, negative
    expect(oiCell(b, '52703', 'CH')).toBe(-8000);
    expect(oiCell(b, '52101', 'CH')).toBeNull();
  });
  it('is empty without a reference', () => {
    expect(oiCell(block(), '52401', 'PB')).toBeNull();
    expect(oiCell(block(), '52401', 'CH')).toBe(30000);
  });
  it('labels the columns by year', () => {
    expect(oiLabel('PB', 2027)).toBe('2026B');
    expect(oiLabel('CH', 2027)).toBe('2027B vs 2026B');
  });
});
