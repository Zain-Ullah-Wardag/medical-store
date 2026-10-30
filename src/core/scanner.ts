/**
 * Scanner input interpretation — pure logic, no DOM, no engine dependency.
 *
 * A "scan" is just a string delivered by a keyboard-wedge scanner (USB HID),
 * typed manually, or produced by the camera. This module answers:
 *   1. What KIND of code is it? (plain barcode / GS1 DataMatrix / random QR text)
 *   2. Is its format valid? (GTIN check digits, GS1 AI structure)
 *   3. If GS1: what are GTIN (01), expiry (17), batch (10), serial (21)?
 *   4. Was this physical scan already counted? (rapid-duplicate gate)
 *   5. Is this fast keyboard burst a scanner, or a human typing? (wedge detector)
 *
 * It NEVER invents data: fields absent from the code stay absent.
 */

export const GS = '\x1d'; // FNC1 group separator used between variable-length GS1 AIs

export interface GS1Data {
  gtin?: string;          // AI 01 — 14 digits
  expiryDate?: string;    // AI 17 — converted to YYYY-MM-DD
  productionDate?: string;// AI 11 — converted to YYYY-MM-DD
  batchNo?: string;       // AI 10
  serial?: string;        // AI 21
  ais: Record<string, string>;
}

export type ScanKind = 'gs1' | 'barcode' | 'qr-text' | 'invalid';

export interface ParsedScan {
  kind: ScanKind;
  raw: string;
  /** Normalized code used for medicine lookup (GTIN for GS1, the code itself otherwise). */
  code: string;
  gs1?: GS1Data;
  /** Symbology guess for plain codes: EAN-13, EAN-8, UPC-A, GTIN-14, Code128/other. */
  format: string;
  checkDigitValid: boolean | null; // null = not applicable / not checkable
  errors: string[];
}

/** GS1 mod-10 check digit validation for GTIN-8/12/13/14 (EAN-8, UPC-A, EAN-13, GTIN-14). */
export function validateGtinCheckDigit(digits: string): boolean {
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  // Weight 3,1,3,1… starting from the rightmost body digit.
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits[digits.length - 1]);
}

/** GTIN-14 ↔ EAN-13/UPC equivalence helpers for tolerant lookup. */
export function gtinVariants(code: string): string[] {
  const out = new Set<string>([code]);
  if (/^\d{14}$/.test(code) && code.startsWith('0')) out.add(code.slice(1)); // GTIN-14 → EAN-13
  if (/^\d{13}$/.test(code)) out.add('0' + code);                            // EAN-13 → GTIN-14
  if (/^\d{12}$/.test(code)) { out.add('0' + code); out.add('00' + code); }        // UPC-A → EAN-13/GTIN-14
  if (/^\d{14}$/.test(code) && code.startsWith('00')) out.add(code.slice(2));      // GTIN-14 → UPC-A
  return [...out];
}

/** GS1 YYMMDD → YYYY-MM-DD. Day "00" means the last day of the month (GS1 rule). */
export function gs1Date(yymmdd: string): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  let dd = Number(yymmdd.slice(4, 6));
  const year = yy >= 51 ? 1900 + yy : 2000 + yy; // GS1 sliding window convention
  if (mm < 1 || mm > 12) return null;
  const lastDay = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  if (dd === 0) dd = lastDay;
  if (dd < 1 || dd > lastDay) return null;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// Fixed-length AIs we understand; 10/21 (and anything else variable) end at GS or string end.
const FIXED_AI: Record<string, number> = { '01': 14, '11': 6, '13': 6, '15': 6, '17': 6 };
const KNOWN_AI = new Set(['01', '10', '11', '13', '15', '17', '21', '30', '37', '240', '241']);

/**
 * Parse a GS1 element string in either transmission format:
 *  - raw:   01089640012345011727123110LOT42<GS>21SN123
 *  - human: (01)08964001234501(17)271231(10)LOT42(21)SN123
 * Returns null if it is not recognizably GS1.
 */
export function parseGS1(rawIn: string): GS1Data | null {
  let raw = rawIn.trim();
  if (!raw) return null;
  // Human-readable parenthesized format → convert to raw with GS separators
  // before each AI so variable-length fields terminate correctly.
  if (raw.startsWith('(')) {
    const parts = [...raw.matchAll(/\((\d{2,4})\)([^(]*)/g)];
    if (parts.length === 0) return null;
    raw = parts.map((p, i) => (i === 0 ? '' : GS) + p[1] + p[2]).join('');
  }
  if (!/^(01|10|11|17|21|240|241)/.test(raw)) return null;

  const ais: Record<string, string> = {};
  let i = 0;
  let guard = 0;
  while (i < raw.length && guard++ < 32) {
    if (raw[i] === GS) { i++; continue; }
    // AI can be 2–4 digits; prefer the longest known prefix.
    let ai = '';
    for (const len of [4, 3, 2]) {
      const cand = raw.slice(i, i + len);
      if (/^\d+$/.test(cand) && KNOWN_AI.has(cand)) { ai = cand; break; }
    }
    if (!ai) {
      const two = raw.slice(i, i + 2);
      if (!/^\d{2}$/.test(two)) break;
      ai = two; // unknown AI: treat as variable-length, capture and move on
    }
    i += ai.length;
    if (FIXED_AI[ai] !== undefined) {
      const val = raw.slice(i, i + FIXED_AI[ai]);
      if (val.length < FIXED_AI[ai]) return null; // truncated fixed field → not valid GS1
      ais[ai] = val;
      i += FIXED_AI[ai];
    } else {
      const end = raw.indexOf(GS, i);
      const val = (end === -1 ? raw.slice(i) : raw.slice(i, end)).slice(0, 20);
      ais[ai] = val;
      i = end === -1 ? raw.length : end + 1;
    }
  }
  if (Object.keys(ais).length === 0) return null;
  const out: GS1Data = { ais };
  if (ais['01']) out.gtin = ais['01'];
  if (ais['17']) out.expiryDate = gs1Date(ais['17']) ?? undefined;
  if (ais['11']) out.productionDate = gs1Date(ais['11']) ?? undefined;
  if (ais['10']) out.batchNo = ais['10'];
  if (ais['21']) out.serial = ais['21'];
  return out.gtin || out.batchNo || out.expiryDate ? out : null;
}

/** Interpret any scanned string. Never throws. */
export function parseScan(rawIn: string): ParsedScan {
  const raw = (rawIn ?? '').replace(/[\r\n\t]+$/g, '').trim();
  const base: ParsedScan = { kind: 'invalid', raw, code: '', format: 'unknown', checkDigitValid: null, errors: [] };
  if (!raw) { base.errors.push('Empty scan.'); return base; }
  // Control characters other than the GS1 separator suggest corrupt input.
  if (/[\x00-\x08\x0b\x0c\x0e-\x1c\x7f]/.test(raw)) { base.errors.push('Scan contains invalid control characters.'); return base; }

  const gs1Raw = raw.replace(/^\]d2/, ''); // AIM symbology identifier some 2D scanners prefix for DataMatrix
  const gs1 = parseGS1(gs1Raw);
  if (gs1 && (gs1.gtin || gs1.batchNo)) {
    const errs: string[] = [];
    let check: boolean | null = null;
    if (gs1.gtin) {
      check = validateGtinCheckDigit(gs1.gtin);
      if (!check) errs.push('GTIN check digit is invalid — possible mis-scan or counterfeit code.');
    }
    if (gs1.ais['17'] && !gs1.expiryDate) errs.push('GS1 expiry date (17) is malformed and was ignored.');
    return { kind: 'gs1', raw, code: gs1.gtin ?? '', gs1, format: 'GS1 DataMatrix', checkDigitValid: check, errors: errs };
  }

  const plain = raw.replace(/^\](e0|E0|C1|c1)/, ''); // strip AIM ids for EAN/Code128 if present
  if (/^\d+$/.test(plain)) {
    const lenMap: Record<number, string> = { 8: 'EAN-8', 12: 'UPC-A', 13: 'EAN-13', 14: 'GTIN-14' };
    const format = lenMap[plain.length] ?? 'Numeric barcode';
    const check = lenMap[plain.length] ? validateGtinCheckDigit(plain) : null;
    return { kind: 'barcode', raw, code: plain, format, checkDigitValid: check, errors: check === false ? ['Check digit is invalid — possible mis-scan.'] : [] };
  }
  // URLs / free text from random QR codes are NOT medicine barcodes.
  if (/^(https?:|www\.|mailto:|tel:|BEGIN:)/i.test(plain) || /\s{2,}/.test(plain)) {
    return { ...base, kind: 'qr-text', format: 'QR (non-GS1 text)', errors: ['This QR code does not contain a medicine barcode.'] };
  }
  if (/^[A-Za-z0-9\-_.*\/+ ]{4,48}$/.test(plain)) {
    return { kind: 'barcode', raw, code: plain, format: 'Code 128 / alphanumeric', checkDigitValid: null, errors: [] };
  }
  return { ...base, errors: ['Unrecognized barcode format.'] };
}

/**
 * Rapid-duplicate gate. One physical scan can arrive twice (scanner double-fire,
 * a global wedge listener + the input's Enter handler both firing). Identical
 * codes within `windowMs` are treated as the SAME scan. Deliberate repeat scans
 * (slower than the window) each count, so quantity increments correctly.
 */
export class ScanGate {
  private lastCode = '';
  private lastTime = 0;
  constructor(private windowMs: number) {}
  setWindow(ms: number) { this.windowMs = ms; }
  /** Returns true if this scan should be processed. */
  accept(code: string, nowMs: number): boolean {
    if (this.windowMs > 0 && code === this.lastCode && nowMs - this.lastTime < this.windowMs) return false;
    this.lastCode = code; this.lastTime = nowMs;
    return true;
  }
  reset() { this.lastCode = ''; this.lastTime = 0; }
}

/**
 * Keyboard-wedge burst detector. Scanners "type" 10–30 chars with a few ms
 * between keys; humans take 50–200ms. Feed every keydown (char or suffix);
 * returns the scanned string when a fast burst ends with the configured
 * suffix, otherwise null. Pure & deterministic for testing.
 */
export class WedgeDetector {
  private buf: { ch: string; t: number }[] = [];
  constructor(private opts: { maxInterKeyMs?: number; minLength?: number; suffixKeys?: string[] } = {}) {}
  feed(key: string, nowMs: number): string | null {
    const maxGap = this.opts.maxInterKeyMs ?? 40;
    const minLen = this.opts.minLength ?? 4;
    const suffixes = this.opts.suffixKeys ?? ['Enter', 'Tab'];
    if (suffixes.includes(key)) {
      const burst = this.buf; this.buf = [];
      if (burst.length < minLen) return null;
      for (let i = 1; i < burst.length; i++) if (burst[i].t - burst[i - 1].t > maxGap) return null;
      return burst.map(b => b.ch).join('');
    }
    if (key.length === 1) {
      // Long pause since last char → previous partial typing was human; restart.
      if (this.buf.length && nowMs - this.buf[this.buf.length - 1].t > 120) this.buf = [];
      this.buf.push({ ch: key, t: nowMs });
      if (this.buf.length > 128) this.buf = this.buf.slice(-64);
    } else if (key !== 'Shift') {
      this.buf = [];
    }
    return null;
  }
  reset() { this.buf = []; }
}
