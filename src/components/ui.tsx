import React, { useState } from 'react';
import { fmtPKR } from '../core/money';

export const money = fmtPKR;

export function Page({ title, sub, actions, children }: { title: string; sub?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto w-full">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-100">{title}</h1>
          {sub && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{sub}</p>}
        </div>
        {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm ${className}`}>
      {title && <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-200 text-sm">{title}</div>}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Stat({ label, value, hint, tone = 'teal' }: { label: string; value: string; hint?: string; tone?: 'teal' | 'red' | 'amber' | 'blue' | 'slate' }) {
  const tones: Record<string, string> = {
    teal: 'border-l-teal-500', red: 'border-l-red-500', amber: 'border-l-amber-500', blue: 'border-l-sky-500', slate: 'border-l-slate-400',
  };
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 border-l-4 ${tones[tone]} p-3 shadow-sm`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">{label}</div>
      <div className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 mt-0.5">{value}</div>
      {hint && <div className="text-xs text-slate-400 mt-0.5">{hint}</div>}
    </div>
  );
}

export const inputCls = 'w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500';
export const labelCls = 'block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className={labelCls}>{label}</span>{children}</label>;
}

export function Btn({ children, onClick, kind = 'primary', type = 'button', disabled, className = '' }: {
  children: React.ReactNode; onClick?: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'soft'; type?: 'button' | 'submit'; disabled?: boolean; className?: string;
}) {
  const kinds = {
    primary: 'bg-teal-600 hover:bg-teal-700 text-white',
    soft: 'bg-teal-50 hover:bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200',
    ghost: 'border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
  };
  return <button type={type} disabled={disabled} onClick={onClick} className={`px-3.5 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1 dark:focus:ring-offset-slate-900 transition ${kinds[kind]} ${className}`}>{children}</button>;
}

export function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[92vh] flex flex-col`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-700">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" title="Close"
            className="w-9 h-9 shrink-0 grid place-items-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 text-xl leading-none font-bold hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/50 active:scale-95 focus:outline-none focus:ring-2 focus:ring-teal-500 transition">×</button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-10 text-slate-400">
      <div className="text-3xl mb-2">🗂️</div>
      <p className="text-sm">{text}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

// Toast system (module-level, simple)
let toastFn: ((t: { msg: string; err?: boolean }) => void) | null = null;
export function toast(msg: string, err = false) { toastFn?.({ msg, err }); }
export function ToastHost() {
  const [items, setItems] = useState<{ id: number; msg: string; err?: boolean }[]>([]);
  toastFn = (t) => { const id = Date.now() + Math.random(); setItems(x => [...x, { id, ...t }]); setTimeout(() => setItems(x => x.filter(i => i.id !== id)), 4500); };
  return (
    <div className="fixed bottom-4 right-4 z-[100] space-y-2 w-[340px] max-w-[90vw]">
      {items.map(i => (
        <div key={i.id} className={`rounded-xl px-4 py-3 text-sm font-medium shadow-lg text-white ${i.err ? 'bg-red-600' : 'bg-teal-600'}`}>{i.msg}</div>
      ))}
    </div>
  );
}

export function run(fn: () => void, okMsg?: string) {
  try { fn(); if (okMsg) toast(okMsg); return true; }
  catch (e: any) { toast(e?.message ?? 'Something went wrong.', true); return false; }
}

export function Confirm({ text, onYes, onNo }: { text: string; onYes: () => void; onNo: () => void }) {
  return (
    <Modal title="Please confirm" onClose={onNo}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-5">{text}</p>
      <div className="flex justify-end gap-2"><Btn kind="ghost" onClick={onNo}>Cancel</Btn><Btn kind="danger" onClick={onYes}>Yes, continue</Btn></div>
    </Modal>
  );
}

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-sm min-w-[560px]">
        <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-700">
          {head.map(h => <th key={h} className="py-2 pr-3 font-semibold whitespace-nowrap">{h}</th>)}
        </tr></thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-slate-50 dark:[&>tr]:border-slate-700/60 [&>tr:hover]:bg-slate-50 dark:[&>tr:hover]:bg-slate-700/30 [&_td]:py-2 [&_td]:pr-3 [&_td]:align-top text-slate-700 dark:text-slate-200">{children}</tbody>
      </table>
    </div>
  );
}

export function Badge({ children, color = 'slate' }: { children: React.ReactNode; color?: 'slate' | 'red' | 'amber' | 'green' | 'blue' }) {
  const c: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200',
    blue: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200',
  };
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${c[color]}`}>{children}</span>;
}

export function downloadFile(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function toCSV(rows: Record<string, string | number>[]): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '\ufeff' + [keys.join(','), ...rows.map(r => keys.map(k => esc(r[k])).join(','))].join('\n');
}

/** CSV export button with clear feedback: hover/pressed states come from Btn,
 *  plus a success toast with row count and an inline ✓ flash. Disabled with an
 *  explanatory title when there is nothing to export. */
export function ExportBtn({ filename, rows, label = 'Export CSV', headerLine }: {
  filename: string; rows: Record<string, string | number>[]; label?: string; headerLine?: string;
}) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = () => {
    if (!rows.length) { toast('Nothing to export for the current filters.', true); return; }
    setBusy(true);
    try {
      downloadFile(filename, (headerLine ? headerLine + '\n' : '') + toCSV(rows), 'text/csv');
      toast(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'} to ${filename}${' (check your Downloads folder)'}`);
      setDone(true); setTimeout(() => setDone(false), 2500);
    } catch (e: any) { toast('Export failed: ' + (e?.message ?? e), true); }
    setBusy(false);
  };
  return <Btn kind={done ? 'primary' : 'ghost'} disabled={busy} onClick={go}>{busy ? 'Exporting…' : done ? '✓ Exported' : `⬇ ${label}`}</Btn>;
}

/** "Name 500mg" without duplicating the strength when the name already ends with
 *  it (e.g. a medicine typed as "Calpol 500mg" with strength "500mg"). Display
 *  only — the stored record is never changed. */
export function medLabel(m: { name: string; strength: string }): string {
  const name = m.name.trim(); const st = (m.strength ?? '').trim();
  if (!st) return name;
  return name.toLowerCase().includes(st.toLowerCase()) ? name : `${name} ${st}`;
}

export const fmtDate = (iso: string) => iso ? new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (iso: string) => iso ? new Date(iso).toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
