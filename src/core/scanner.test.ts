import { describe, it, expect } from 'vitest';
import { parseScan, parseGS1, gs1Date, validateGtinCheckDigit, gtinVariants, ScanGate, WedgeDetector, GS } from './scanner';

describe('GTIN check digits', () => {
  it('accepts valid EAN-13 / GTIN-14 and rejects corrupted ones', () => {
    expect(validateGtinCheckDigit('4006381333931')).toBe(true);  // classic valid EAN-13
    expect(validateGtinCheckDigit('04006381333931')).toBe(true); // same as GTIN-14
    expect(validateGtinCheckDigit('4006381333932')).toBe(false);
    expect(validateGtinCheckDigit('12345')).toBe(false);
    expect(validateGtinCheckDigit('ABC123')).toBe(false);
  });
  it('gtinVariants bridges GTIN-14, EAN-13 and UPC-A padding', () => {
    expect(gtinVariants('04006381333931')).toContain('4006381333931');
    expect(gtinVariants('4006381333931')).toContain('04006381333931');
    expect(gtinVariants('MS-1001')).toEqual(['MS-1001']);
  });
});

describe('GS1 date conversion', () => {
  it('converts YYMMDD and treats day 00 as end of month', () => {
    expect(gs1Date('271231')).toBe('2027-12-31');
    expect(gs1Date('260200')).toBe('2026-02-28');
    expect(gs1Date('240229')).toBe('2024-02-29'); // leap year
    expect(gs1Date('271340')).toBeNull();
    expect(gs1Date('abcdef')).toBeNull();
  });
});

describe('GS1 DataMatrix parsing', () => {
  const GTIN = '08964001234500';
  it('parses the parenthesized human-readable format', () => {
    const g = parseGS1('(01)08964001234500(17)271231(10)PN-2401(21)SN001');
    expect(g).not.toBeNull();
    expect(g!.gtin).toBe(GTIN);
    expect(g!.expiryDate).toBe('2027-12-31');
    expect(g!.batchNo).toBe('PN-2401');
    expect(g!.serial).toBe('SN001');
  });
  it('parses the raw transmission format with FNC1 separators', () => {
    const g = parseGS1(`01${GTIN}1727123110PN-2401${GS}21SN001`);
    expect(g!.gtin).toBe(GTIN);
    expect(g!.expiryDate).toBe('2027-12-31');
    expect(g!.batchNo).toBe('PN-2401');
    expect(g!.serial).toBe('SN001');
  });
  it('parses batch-last codes without a serial', () => {
    const g = parseGS1(`01${GTIN}10250115LOT`);
    expect(g!.gtin).toBe(GTIN);
    expect(g!.batchNo).toBe('250115LOT');
    expect(g!.serial).toBeUndefined();
    expect(g!.expiryDate).toBeUndefined(); // never invented
  });
  it('does not mistake plain barcodes or text for GS1', () => {
    expect(parseGS1('4006381333931')).toBeNull();
    expect(parseGS1('hello world')).toBeNull();
    expect(parseGS1('')).toBeNull();
  });
});

describe('parseScan classification', () => {
  it('classifies a valid EAN-13', () => {
    const p = parseScan('4006381333931');
    expect(p.kind).toBe('barcode'); expect(p.format).toBe('EAN-13'); expect(p.checkDigitValid).toBe(true); expect(p.code).toBe('4006381333931');
  });
  it('flags an invalid check digit but still returns the code for lookup', () => {
    const p = parseScan('4006381333939');
    expect(p.kind).toBe('barcode'); expect(p.checkDigitValid).toBe(false); expect(p.errors.length).toBeGreaterThan(0);
  });
  it('treats random QR payloads as non-barcode text', () => {
    expect(parseScan('https://example.com/promo').kind).toBe('qr-text');
    expect(parseScan('BEGIN:VCARD\nFN:Someone').kind).toBe('qr-text');
  });
  it('rejects empty and corrupt scans', () => {
    expect(parseScan('').kind).toBe('invalid');
    expect(parseScan('12\x01\x0234').kind).toBe('invalid');
  });
  it('recognizes GS1 with an AIM ]d2 prefix from 2D scanners', () => {
    const p = parseScan(']d2010896400123450017271231');
    expect(p.kind).toBe('gs1');
    expect(p.gs1?.gtin).toBe('08964001234500');
    expect(p.gs1?.expiryDate).toBe('2027-12-31');
  });
  it('accepts internal alphanumeric codes (Code 128)', () => {
    const p = parseScan('MS-1001-A');
    expect(p.kind).toBe('barcode'); expect(p.code).toBe('MS-1001-A');
  });
});

describe('ScanGate — rapid duplicate handling', () => {
  it('collapses the same code arriving twice within the window (one physical scan)', () => {
    const gate = new ScanGate(350);
    expect(gate.accept('AAA', 1000)).toBe(true);
    expect(gate.accept('AAA', 1010)).toBe(false); // double-fire 10ms later
    expect(gate.accept('AAA', 1200)).toBe(false); // still within window of first accept? 200ms < 350 → blocked
  });
  it('counts deliberate repeat scans after the window', () => {
    const gate = new ScanGate(350);
    expect(gate.accept('AAA', 1000)).toBe(true);
    expect(gate.accept('AAA', 1600)).toBe(true);  // cashier scans second pack
    expect(gate.accept('AAA', 2200)).toBe(true);  // third pack
  });
  it('never blocks a different code', () => {
    const gate = new ScanGate(350);
    expect(gate.accept('AAA', 1000)).toBe(true);
    expect(gate.accept('BBB', 1005)).toBe(true);
  });
  it('window 0 disables the guard', () => {
    const gate = new ScanGate(0);
    expect(gate.accept('AAA', 1000)).toBe(true);
    expect(gate.accept('AAA', 1001)).toBe(true);
  });
});

describe('WedgeDetector — scanner bursts vs human typing', () => {
  const burst = (det: WedgeDetector, text: string, startMs: number, gapMs: number, suffix = 'Enter') => {
    let t = startMs;
    for (const ch of text) { det.feed(ch, t); t += gapMs; }
    return det.feed(suffix, t);
  };
  it('recognizes a fast scanner burst ending with Enter', () => {
    const det = new WedgeDetector();
    expect(burst(det, '4006381333931', 0, 5)).toBe('4006381333931');
  });
  it('recognizes a Tab-suffix scanner when configured', () => {
    const det = new WedgeDetector({ suffixKeys: ['Tab'] });
    expect(burst(det, '8964001234500', 0, 4, 'Tab')).toBe('8964001234500');
    expect(burst(det, '8964001234500', 5000, 4, 'Enter')).toBeNull(); // Enter not a suffix here
  });
  it('ignores slow human typing', () => {
    const det = new WedgeDetector();
    expect(burst(det, 'panadol', 0, 150)).toBeNull();
  });
  it('ignores bursts shorter than the minimum length', () => {
    const det = new WedgeDetector();
    expect(burst(det, '123', 0, 5)).toBeNull();
  });
  it('handles repeated scans back-to-back', () => {
    const det = new WedgeDetector();
    expect(burst(det, '11112222', 0, 5)).toBe('11112222');
    expect(burst(det, '11112222', 1000, 5)).toBe('11112222');
    expect(burst(det, '33334444', 2000, 5)).toBe('33334444');
  });
});
