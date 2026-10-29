import { useEffect, useMemo, useRef, useState } from 'react';
import { engine, uid } from '../lib/store';
import { Page, Card, Btn, Modal, Field, inputCls, money, toast, fmtDate, Badge, Confirm } from '../components/ui';
import { toPaisa, percentOf } from '../core/money';
import type { Medicine, Sale, SessionUser } from '../core/types';
import { Receipt } from '../components/Receipt';

interface CartLine { medicineId: number; qty: number; unitPricePaisa: number; discountPaisa: number; }

export function POS({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [cart, setCart] = useState<CartLine[]>([]);
  const [barcode, setBarcode] = useState('');
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState<number>(db.customers[0]?.id ?? 1);
  const [method, setMethod] = useState('Cash');
  const [paidRs, setPaidRs] = useState('');
  const [billDiscRs, setBillDiscRs] = useState('');
  const [idemKey, setIdemKey] = useState(uid());
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { barcodeRef.current?.focus(); }, [lastSale]);

  const results = useMemo(() => engine.searchMedicines(search), [search, db]);

  const addMed = (m: Medicine) => {
    const stock = engine.saleableStock(m.id);
    if (stock <= 0) { toast(`"${m.name}" has no saleable stock (out of stock or all batches expired).`, true); return; }
    setCart(c => {
      const ex = c.find(l => l.medicineId === m.id);
      const nextQty = (ex?.qty ?? 0) + 1;
      if (nextQty > stock) { toast(`Only ${stock} saleable units of "${m.name}" available.`, true); return c; }
      if (ex) return c.map(l => l.medicineId === m.id ? { ...l, qty: nextQty } : l);
      const firstBatch = engine.eligibleBatches(m.id)[0];
      return [...c, { medicineId: m.id, qty: 1, unitPricePaisa: firstBatch?.sellPricePaisa || m.retailPricePaisa, discountPaisa: 0 }];
    });
  };

  const onBarcode = () => {
    const code = barcode.trim(); if (!code) return;
    const m = engine.findByBarcode(code);
    if (m) { addMed(m); toast(`Added: ${m.name}`); }
    else toast(`Unknown barcode "${code}". Search by name or register the medicine first.`, true);
    setBarcode(''); barcodeRef.current?.focus();
  };

  const subtotal = cart.reduce((s, l) => s + l.qty * l.unitPricePaisa, 0);
  const lineDisc = cart.reduce((s, l) => s + l.discountPaisa, 0);
  const billDisc = toPaisa(billDiscRs || 0);
  const discountTotal = lineDisc + billDisc;
  const tax = percentOf(Math.max(0, subtotal - discountTotal), db.settings.taxRatePct);
  const total = Math.max(0, subtotal - discountTotal) + tax;
  const paid = paidRs === '' ? total : toPaisa(paidRs);
  const change = Math.max(0, paid - total);
  const balance = Math.max(0, total - paid);

  const fefoPreview = (l: CartLine): string => {
    let rem = l.qty; const parts: string[] = [];
    for (const b of engine.eligibleBatches(l.medicineId)) { if (rem <= 0) break; const take = Math.min(b.qtyRemaining, rem); parts.push(`${b.batchNo}×${take} (exp ${fmtDate(b.expiryDate)})`); rem -= take; }
    return parts.join(' + ') || '—';
  };

  const checkout = () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const sale = engine.createSale(user, {
        customerId, items: cart, billDiscountPaisa: billDisc,
        payments: paid > 0 ? [{ method, amountPaisa: Math.min(paid, total) }] : [], idempotencyKey: idemKey,
      });
      setLastSale(sale);
      setCart([]); setPaidRs(''); setBillDiscRs(''); setIdemKey(uid());
      toast(`Sale complete — ${sale.invoiceNo}`);
    } catch (e: any) { toast(e.message, true); }
    setSubmitting(false);
    barcodeRef.current?.focus();
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); barcodeRef.current?.focus(); }
      if (e.key === 'F9') { e.preventDefault(); if (cart.length) checkout(); }
      if (e.key === 'F4') { e.preventDefault(); document.getElementById('pos-search')?.focus(); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  return (
    <Page title="Point of Sale" sub="Scan barcode (F2) · Search (F4) · Complete sale (F9). USB scanners work as keyboards — just scan.">
      <div className="grid lg:grid-cols-5 gap-4 items-start">
        <div className="lg:col-span-3 space-y-4">
          <Card>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="🔫 Barcode scanner input">
                <input ref={barcodeRef} className={inputCls} placeholder="Scan or type barcode + Enter" value={barcode}
                  onChange={e => setBarcode(e.target.value)} onKeyDown={e => e.key === 'Enter' && onBarcode()} autoFocus />
              </Field>
              <Field label="🔍 Search medicine (name / generic / brand)">
                <input id="pos-search" className={inputCls} placeholder="e.g. Panadol, paracetamol…" value={search} onChange={e => setSearch(e.target.value)} />
              </Field>
            </div>
            {search && (
              <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-700 max-h-64 overflow-y-auto">
                {results.length === 0 && <p className="text-sm text-slate-400 py-3">No matching medicine. Check spelling or register it under Medicines.</p>}
                {results.map(m => {
                  const st = engine.saleableStock(m.id);
                  return (
                    <button key={m.id} onClick={() => { addMed(m); setSearch(''); barcodeRef.current?.focus(); }}
                      className="w-full flex items-center justify-between py-2 px-1 text-left hover:bg-teal-50 dark:hover:bg-slate-700/40 rounded">
                      <span><span className="font-semibold text-slate-800 dark:text-slate-100">{m.name} {m.strength}</span>
                        <span className="block text-xs text-slate-400">{m.genericName} · {m.packSize} · {m.barcode || 'no barcode'}</span></span>
                      <span className="text-right"><span className="font-bold text-teal-700 dark:text-teal-300">{money(m.retailPricePaisa)}</span>
                        <span className="block text-xs">{st > 0 ? <Badge color="green">{st} in stock</Badge> : <Badge color="red">Out of stock</Badge>}</span></span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title={`Cart (${cart.length} item${cart.length === 1 ? '' : 's'}) — FEFO batch allocation preview`}>
            {cart.length === 0 ? <p className="text-sm text-slate-400 py-6 text-center">Cart is empty. Scan a barcode or search a medicine to begin billing.</p> : (
              <div className="space-y-2">
                {cart.map(l => {
                  const m = engine.medicine(l.medicineId);
                  return (
                    <div key={l.medicineId} className="flex flex-wrap items-center gap-2 border border-slate-100 dark:border-slate-700 rounded-xl p-2.5">
                      <div className="flex-1 min-w-[160px]">
                        <div className="font-semibold text-sm text-slate-800 dark:text-slate-100">{m.name} {m.strength}</div>
                        <div className="text-[11px] text-slate-400">Batch: {fefoPreview(l)}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-700 font-bold" onClick={() => setCart(c => c.map(x => x.medicineId === l.medicineId ? { ...x, qty: Math.max(1, x.qty - 1) } : x))}>−</button>
                        <input className={inputCls + ' !w-16 text-center'} type="number" min={1} value={l.qty}
                          onChange={e => setCart(c => c.map(x => x.medicineId === l.medicineId ? { ...x, qty: Math.max(1, parseInt(e.target.value) || 1) } : x))} />
                        <button className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-700 font-bold" onClick={() => addMed(m)}>+</button>
                      </div>
                      <input className={inputCls + ' !w-24'} type="number" min={0} title="Unit price Rs" value={l.unitPricePaisa / 100}
                        onChange={e => setCart(c => c.map(x => x.medicineId === l.medicineId ? { ...x, unitPricePaisa: toPaisa(e.target.value) } : x))} />
                      <input className={inputCls + ' !w-20'} type="number" min={0} placeholder="Disc Rs" title="Line discount Rs" value={l.discountPaisa ? l.discountPaisa / 100 : ''}
                        onChange={e => setCart(c => c.map(x => x.medicineId === l.medicineId ? { ...x, discountPaisa: toPaisa(e.target.value) } : x))} />
                      <div className="w-24 text-right font-bold text-sm">{money(l.qty * l.unitPricePaisa - l.discountPaisa)}</div>
                      <button className="text-red-500 font-bold px-1" onClick={() => setCart(c => c.filter(x => x.medicineId !== l.medicineId))} title="Remove">✕</button>
                    </div>
                  );
                })}
                <div className="text-right"><button className="text-xs text-red-500 font-semibold" onClick={() => setConfirmClear(true)}>Clear cart</button></div>
              </div>
            )}
          </Card>
        </div>

        <Card title="Bill summary" className="lg:col-span-2 lg:sticky lg:top-4">
          <div className="space-y-3 text-sm">
            <Field label="Customer">
              <select className={inputCls} value={customerId} onChange={e => setCustomerId(Number(e.target.value))}>
                {db.customers.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}{engine.customerBalance(c.id) > 0 ? ` (owes ${money(engine.customerBalance(c.id))})` : ''}</option>)}
              </select>
            </Field>
            <div className="space-y-1.5 border-t border-dashed border-slate-200 dark:border-slate-600 pt-3">
              <div className="flex justify-between"><span>Subtotal</span><span>{money(subtotal)}</span></div>
              <div className="flex justify-between items-center"><span>Bill discount (Rs)</span>
                <input className={inputCls + ' !w-28 text-right'} type="number" min={0} value={billDiscRs} onChange={e => setBillDiscRs(e.target.value)} placeholder="0" /></div>
              <div className="flex justify-between"><span>Total discount</span><span className="text-red-500">−{money(discountTotal)}</span></div>
              {db.settings.taxRatePct > 0 && <div className="flex justify-between"><span>Tax ({db.settings.taxRatePct}%)</span><span>{money(tax)}</span></div>}
              <div className="flex justify-between text-lg font-bold border-t border-slate-200 dark:border-slate-600 pt-2"><span>Total payable</span><span>{money(total)}</span></div>
            </div>
            <Field label="Payment method">
              <select className={inputCls} value={method} onChange={e => setMethod(e.target.value)}>
                {db.settings.paymentMethods.map(m => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Amount paid (Rs) — leave empty for full payment">
              <input className={inputCls} type="number" min={0} value={paidRs} onChange={e => setPaidRs(e.target.value)} placeholder={String(total / 100)} />
            </Field>
            {change > 0 && <div className="flex justify-between font-semibold text-teal-600"><span>Change due</span><span>{money(change)}</span></div>}
            {balance > 0 && <div className="flex justify-between font-semibold text-amber-600"><span>Balance (udhaar)</span><span>{money(balance)}</span></div>}
            <Btn className="w-full !py-3 !text-base" disabled={cart.length === 0 || submitting} onClick={checkout}>
              {submitting ? 'Processing…' : '✓ Complete Sale (F9)'}
            </Btn>
            <p className="text-[11px] text-slate-400">Stock is re-checked at checkout. Expired batches can never be sold. Credit sales need a registered customer.</p>
          </div>
        </Card>
      </div>

      {lastSale && (
        <Modal title={`Receipt — ${lastSale.invoiceNo}`} onClose={() => setLastSale(null)}>
          <Receipt sale={lastSale} />
          <div className="flex justify-end gap-2 mt-4 no-print">
            <Btn kind="ghost" onClick={() => setLastSale(null)}>Close</Btn>
            <Btn onClick={() => window.print()}>🖨 Print / Save PDF</Btn>
          </div>
        </Modal>
      )}
      {confirmClear && <Confirm text="Clear the current cart? Items will be removed (no sale is recorded)." onNo={() => setConfirmClear(false)} onYes={() => { setCart([]); setConfirmClear(false); }} />}
    </Page>
  );
}
