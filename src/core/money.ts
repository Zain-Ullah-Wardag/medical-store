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
export const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + days); return todayStr(d);
};
export const daysBetween = (from: string, to: string): number =>
  Math.round((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86400000);
