import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseRevenueRecognition } from './revenue-recognition';

// the report's layout: parameters, a band over the month columns, the header, one row per property
function report() {
  const rows: unknown[][] = [
    [null, null, null, null, 'Revenue Recognition Summary '],
    [null, 'Business Unit', 'REHL', null, 'Accounting Periods', 'Jan-2025 - Feb-2025', null, 'Forecast Period', 'Mar-2025 - Mar-2025'],
    [null, null, null, null, null, null, null, 'Accounting Period', null, null, 'Forecast Period', null],
    ['Business Unit', 'Property Code', 'Property Name', 'Actual Lease Amount', 'Previous Recognized Amount', 'Jan-2025', 'Feb-2025', 'Accounted Period Total', 'Mar-2025', 'Forecast Period Total'],
    ['REHL', '30B101', 'AL QUSAIS', '12,000.00', '0.00', '1,000.00', '900.50', '1,900.50', '1,000.00', '1,000.00'],
    ['REHL', '10B114N', 'SHOWROOM', '500.00', '0.00', '250.00', null, '250.00', null, null],
    [null, null, '12,500.00', '0.00'],
    ['** End of Report **'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Report');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('Revenue Recognition Summary', () => {
  it('splits accounted months from the forecast and reads the parameters', () => {
    const r = parseRevenueRecognition(report());
    expect(r.accountingPeriods).toBe('Jan-2025 - Feb-2025');
    expect(r.forecastPeriod).toBe('Mar-2025 - Mar-2025');
    expect([r.from, r.to]).toEqual(['2025-01', '2025-02']);
    expect(r.properties).toHaveLength(2);
    expect(r.properties[0]).toMatchObject({ code: '30B101', actual: { '2025-01': 1000, '2025-02': 900.5 }, forecast: { '2025-03': 1000 } });
    // a lease that ended: blank months are zero, still counted as covered
    expect(r.properties[1].actual).toEqual({ '2025-01': 250, '2025-02': 0 });
  });
  it('rejects another report', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Unit No', 'Lease Number']]), 'x');
    expect(() => parseRevenueRecognition(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)).toThrow(/Revenue Recognition Summary/);
  });
});
