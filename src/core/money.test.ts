import { describe, it, expect } from 'vitest';
import { normalizePercentInput, parsePercent, billDiscountPaisa, toPaisa } from './money';

describe('percentage discount input normalization (POS)', () => {
  it('the field itself clamps to 0–100 (displayed value, not just the math)', () => {
    expect(normalizePercentInput('0')).toBe('0');
    expect(normalizePercentInput('10')).toBe('10');
    expect(normalizePercentInput('100')).toBe('100');
    expect(normalizePercentInput('110')).toBe('100'); // was: calculated 100 but showed 110
    expect(normalizePercentInput('-10')).toBe('0');   // was: calculated 0 but showed -10
    expect(normalizePercentInput('')).toBe('');        // cleared field stays cleared
    expect(normalizePercentInput('12.5')).toBe('12.5'); // decimals allowed
    expect(normalizePercentInput('99.9')).toBe('99.9');
  });
  it('parsePercent always yields a number in [0,100]', () => {
    expect(parsePercent('')).toBe(0);
    expect(parsePercent('abc')).toBe(0);
    expect(parsePercent('-5')).toBe(0);
    expect(parsePercent('250')).toBe(100);
    expect(parsePercent('7.25')).toBe(7.25);
  });
  it('discount calculation matches QA cases and never exceeds the base (payable ≥ 0)', () => {
    const base = toPaisa(135);
    expect(billDiscountPaisa('pct', '10', base)).toBe(toPaisa(13.5));  // payable 121.50
    expect(base - billDiscountPaisa('pct', '10', base)).toBe(toPaisa(121.5));
    expect(billDiscountPaisa('fixed', '10', base)).toBe(toPaisa(10));  // payable 125
    expect(base - billDiscountPaisa('fixed', '10', base)).toBe(toPaisa(125));
    expect(billDiscountPaisa('pct', '0', base)).toBe(0);
    expect(billDiscountPaisa('pct', '100', base)).toBe(base);
    expect(billDiscountPaisa('pct', '110', base)).toBe(base);          // capped
    expect(billDiscountPaisa('pct', '-10', base)).toBe(0);
    expect(billDiscountPaisa('pct', '', base)).toBe(0);
    expect(billDiscountPaisa('fixed', '99999', base)).toBe(base);      // fixed capped at base
    expect(billDiscountPaisa('pct', '12.5', toPaisa(200))).toBe(toPaisa(25));
    expect(billDiscountPaisa('pct', '50', -100)).toBe(0);              // negative base safe
  });
});
