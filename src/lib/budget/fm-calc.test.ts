import { describe, expect, it } from 'vitest';
import { computeFm } from './fm-calc';

const facilities = [
  { id: 1, bu: '501', zone: 'ZONE_1' },
  { id: 2, bu: '502', zone: 'ZONE_1' },
  { id: 3, bu: '522', zone: 'ZONE_2' },
];

describe('FM budget calculation', () => {
  it('spreads recurring work over 12 months and books projects in their month', () => {
    const r = computeFm(facilities, [
      { propertyId: 1, workType: 'M01', amount: 12000, month: null },
      { propertyId: 1, workType: 'R04', amount: 50000, month: 3 },
      { propertyId: 1, workType: 'R01', amount: 24000, month: null },
    ], []);
    const p = r.byProperty.get(1)!;
    expect(p.monthly.maintenance).toEqual(Array(12).fill(1000));
    expect(p.monthly.capex[2]).toBe(52000); // 50,000 in March + 2,000 of the spread R01
    expect(p.monthly.capex[0]).toBe(2000);
    expect(p.works.R04).toBe(50000);
  });

  it('vacant unit preparation is maintenance cost, as in the 2026 Building P&L', () => {
    const p = computeFm(facilities, [{ propertyId: 2, workType: 'R03', amount: 12000, month: 5 }], []).byProperty.get(2)!;
    expect(p.monthly.maintenance).toEqual(Array(12).fill(1000));
    expect(p.monthly.capex).toEqual(Array(12).fill(0));
  });

  it('allocates staff with the 2026 rules (G&A pro rata, supervision split, zones, vacant team)', () => {
    const r = computeFm(
      facilities,
      [
        { propertyId: 1, workType: 'M02', amount: 3000, month: null },
        { propertyId: 2, workType: 'M02', amount: 1000, month: null },
        { propertyId: 3, workType: 'M02', amount: 2000, month: null },
        { propertyId: 2, workType: 'R03', amount: 5000, month: null },
      ],
      [
        { team: 'SUPERVISORY', ctc: 1000, overtime: 0 },
        { team: 'ZONE_1', ctc: 800, overtime: 0 },
        { team: 'VACANT', ctc: 200, overtime: 0 },
        { team: 'GA', ctc: 200, overtime: 0 }, // 10% on top of the 2,000 of teams
      ],
    );
    expect(r.teamCost.SUPERVISORY).toBeCloseTo(1100);
    const p1 = r.byProperty.get(1)!, p2 = r.byProperty.get(2)!, p3 = r.byProperty.get(3)!;
    // supervision: M2–M4 part (30%) over 501/502 by M02 (3:1); R3 part (9%) all to property 2; the rest has no works
    expect(p1.staff.SUPERVISORY).toBeCloseTo(1100 * 0.3 * 0.75);
    expect(p2.staff.SUPERVISORY).toBeCloseTo(1100 * 0.3 * 0.25 + 1100 * 0.09);
    expect(p3.staff.SUPERVISORY ?? 0).toBe(0); // PMC: no supervision
    // zone 1 team over properties 1 and 2 by maintain cost (3:1)
    expect(p1.staff.ZONE_1).toBeCloseTo(880 * 0.75);
    expect(p2.staff.VACANT).toBeCloseTo(220);
    // M1 (19%) and R1/R2/R4 (42%) parts have no works to go to
    expect(r.unallocated).toBeCloseTo(1100 * 0.61);
    expect(p1.monthly.fmStaff[0]).toBeCloseTo(p1.staffTotal / 12);
  });
});
