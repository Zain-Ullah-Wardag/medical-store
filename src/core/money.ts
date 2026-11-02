/**
 * Money handling — ALL monetary values in MedStore Manager are stored and
 * calculated as integer PAISA (1 PKR = 100 paisa). Floating-point numbers are
 * NEVER used for stored amounts; they only appear transiently when a user
 * types a rupee value, which is immediately converted with round-half-up.
 */
export const toPaisa = (rupees: number | string): number => {
  const n = typeof rupees === 'string' ? parseFloat(rupees) : rupees;
  if (!isFinite(n) || isNaN(n)) return 0;
  return Math.round(n * 100);
};

export const toRupees = (paisa: number): number => Math.round(paisa) / 100;

export const fmtPKR = (paisa: number): string => {
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paisa));
  const rupees = Math.floor(abs / 100).toLocaleString('en-PK');
  const p = abs % 100;
  return `${sign}PKR ${rupees}${p ? '.' + String(p).padStart(2, '0') : ''}`;
};

/** Percent of an amount, rounded half-up to nearest paisa. */
export const percentOf = (amountPaisa: number, pct: number): number =>
  Math.round((amountPaisa * pct) / 100);

export const todayStr = (d = new Date()): string => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};
export const nowISO = (): string => new Date().toISOString();
/**
 * The LOCAL calendar date (YYYY-MM-DD) of a stored timestamp.
 * dateTime values are stored as UTC ISO strings; slicing the first 10 chars
 * gives the UTC date, which in Pakistan (UTC+5) wrongly attributes anything
 * recorded between midnight and 05:00 to the previous business day.
 * ALWAYS use this for day-level filtering/grouping. Plain YYYY-MM-DD inputs
 * pass through unchanged.
 */
export const localDateOf = (iso: string): string => {
  if (!iso) return '';
  if (iso.length === 10) return iso;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso.slice(0, 10) : todayStr(d);
};
export const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + days); return todayStr(d);
};
export const daysBetween = (from: string, to: string): number =>
  Math.round((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86400000);
/**
 * Normalize a percentage input string so the FIELD ITSELF only ever shows a
 * value in [0, 100] (not just the calculation). Empty stays empty (field
 * cleared); partial entries like "10." are preserved while typing; complete
 * out-of-range numbers clamp ("110" -> "100", "-10" -> "0").
 */
export const normalizePercentInput = (raw: string): string => {
  if (raw === '' || raw === '-') return raw === '-' ? '' : raw;
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return '';
  if (n > 100) return '100';
  if (n < 0) return '0';
  return raw;
};
/** Parse a (possibly un-normalized) percentage string to a number in [0,100]. */
export const parsePercent = (raw: string): number => {
  const n = parseFloat(raw);
  return Number.isNaN(n) ? 0 : Math.max(0, Math.min(100, n));
};
/** Bill discount in paisa for either input mode. Percentage applies to the
 *  base amount (subtotal − line discounts); fixed parses rupees. Never
 *  negative, never above the base. */
export const billDiscountPaisa = (type: 'fixed' | 'pct', raw: string, basePaisa: number): number => {
  const base = Math.max(0, basePaisa);
  if (type === 'pct') return percentOf(base, parsePercent(raw));
  return Math.max(0, Math.min(base, toPaisa(raw || 0)));
};

