import { describe, it, expect } from 'vitest';
import { toCSV } from './ui';

// The shared CSV writer behind every Export CSV button (reports included).
describe('toCSV (all report/list exports)', () => {
  it('writes a UTF-8 BOM and a header row so Excel opens it correctly', () => {
    const csv = toCSV([{ Name: 'Panadol', Qty: 5 }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Name,Qty');
    expect(csv).toContain('Panadol,5');
  });
  it('escapes commas, quotes and newlines (Excel-compatible quoting)', () => {
    const csv = toCSV([{ Name: 'Syrup, "Special"\n120ml', AmountPKR: 12.5 }]);
    expect(csv).toContain('"Syrup, ""Special""\n120ml",12.5');
  });
  it('keeps numeric values numeric (no quotes) and handles empty input', () => {
    expect(toCSV([{ A: 0, B: -3.25 }])).toContain('0,-3.25');
    expect(toCSV([])).toBe('');
  });
});
