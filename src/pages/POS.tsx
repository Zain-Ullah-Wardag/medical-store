import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { engine, uid } from '../lib/store';
import { Page, Card, Btn, Modal, Field, inputCls, money, toast, fmtDate, Badge, Confirm, run, medLabel } from '../components/ui';
import { toPaisa, percentOf } from '../core/money';
import type { Medicine, PackagingLevel, Sale, SessionUser } from '../core/types';
import { can } from '../core/types';
import { Receipt } from '../components/Receipt';
import { ScanGate, WedgeDetector } from '../core/scanner';
import { beepSuccess, beepError } from '../lib/beep';
import { CameraScan } from '../components/CameraScan';

interface CartLine {
  key: string; medicineId: number; qty: number; unitPricePaisa: number; discountPaisa: number;
  preferredBatchId?: number; packaging?: string; scannedBatchNo?: string;
  barcodeRecordId?: number | null; priceOverrideId?: number | null; overrideNote?: string;
}
const lineKey = (medicineId: number, batchId?: number, packaging?: string) => `${medicineId}|${batchId ?? ''}|${packaging ?? ''}`;

interface ScanBanner { ok: boolean; text: string; sub: string; }

export function POS({ user }: { user: SessionUser }) {
  const db = engine.db;
  const scanner = db.settings.scanner;
  const [cart, setCart] = useState<CartLine[]>([]);
  const [barcode, setBarcode] = useState('');
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState<number>(db.customers[0]?.id ?? 1);
  const [method, setMethod] = useState('Cash');
  const [paidRs, setPaidRs] = useState('');
  const [billDiscRs, setBillDiscRs] = useState('');
  const [billDiscType, setBillDiscType] = useState<'fixed' | 'pct'>('fixed');
  const [idemKey, setIdemKey] = useState(uid());
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [overrideFor, setOverrideFor] = useState<CartLine | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<ScanBanner | null>(null);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const modalOpenRef = useRef(false);
  modalOpenRef.current = !!(unknownCode || cameraOpen || lastSale);
  const gateRef = useRef(new ScanGate(scanner.rapidDuplicateWindowMs));
  const wedgeRef = useRef(new WedgeDetector());
  gateRef.current.setWindow(scanner.rapidDuplicateWindowMs);

  useEffect(() => { barcodeRef.current?.focus(); }, [lastSale]);
  const results = useMemo(() => engine.searchMedicines(search), [search, db]);

  /** Adds base-units to the cart. Stock is NOT touched here — only at checkout. */
  const addToCart = useCallback((m: Medicine, baseQty: number, unitPricePaisa: number, opts: { preferredBatchId?: number; packaging?: string; scannedBatchNo?: string; barcodeRecordId?: number | null } = {}): boolean => {
    const stock = engine.saleableStock(m.id);
    if (stock <= 0) { toast(`"${m.name}" has no saleable stock (out of stock or all batches expired).`, true); return false; }
    let added = true;
    setCart(c => {
      const inCart = c.filter(l => l.medicineId === m.id).reduce((s, l) => s + l.qty, 0);
      if (inCart + baseQty > stock) { toast(`Only ${stock} saleable ${m.unit} of "${m.name}" available (${inCart} already in cart).`, true); added = false; return c; }
      const key = lineKey(m.id, opts.preferredBatchId, opts.packaging);
      const ex = c.find(l => l.key === key);
      if (ex) return c.map(l => l.key === key ? { ...l, qty: l.qty + baseQty } : l);
      return [...c, { key, medicineId: m.id, qty: baseQty, unitPricePaisa, discountPaisa: 0, preferredBatchId: opts.preferredBatchId, packaging: opts.packaging, scannedBatchNo: opts.scannedBatchNo, barcodeRecordId: opts.barcodeRecordId ?? null }];
    });
    return added;
  }, []);

  const addMed = (m: Medicine) => {
    const firstBatch = engine.eligibleBatches(m.id)[0];
    addToCart(m, 1, firstBatch?.sellPricePaisa || m.retailPricePaisa);
  };

  /** Central scan handler — used by the dedicated box, wedge-anywhere capture and camera. */
  const handleScan = useCallback((rawIn: string) => {
    const raw = rawIn.trim(); if (!raw) return;
    const sc = engine.db.settings.scanner;
    setBarcode(''); setSearch(''); barcodeRef.current?.focus();
    if (!sc.enabled) { toast('Scanner is disabled in Settings → Barcode & Scanner.', true); return; }
    if (!gateRef.current.accept(raw, Date.now())) return; // same physical scan arriving twice
    const fail = (text: string, sub = '') => { if (sc.beepOnError) beepError(); setBanner({ ok: false, text, sub }); };
    const r = engine.resolveScan(raw);
    if (r.status === 'invalid') { fail('⛔ Invalid scan', r.message); toast(r.message, true); return; }
    if (r.status === 'blocked') { fail('⛔ Sale blocked for safety', r.message); toast(r.message, true); return; }
    if (r.status === 'unknown' || !r.medicine) {
      fail('❓ Unknown barcode', r.message);
      if (sc.unknownBehavior === 'prompt') setUnknownCode(r.parsed.code || raw);
      else toast(r.message + ' It was NOT added to the sale.', true);
      return;
    }
    const qty = Math.max(1, sc.defaultScanQty) * r.baseQtyPerScan;
    const ok = addToCart(r.medicine, qty, r.unitPricePaisa, {
      preferredBatchId: r.matchedBatch?.id, packaging: r.packagingLabel !== r.medicine.unit ? r.packagingLabel : undefined,
      scannedBatchNo: r.matchedBatch?.batchNo, barcodeRecordId: r.barcodeRecord?.id ?? null,
    });
    if (!ok) { fail('⚠ Not enough saleable stock', r.medicine.name); return; }
    if (sc.beepOnSuccess) beepSuccess();
    setBanner({
      ok: true,
      text: `✓ ${medLabel(r.medicine)}`,
      sub: `${r.packagingLabel} · +${qty} ${r.medicine.unit} · ${money(r.unitPricePaisa)} each` +
        (r.matchedBatch ? ` · Batch ${r.matchedBatch.batchNo} (exp ${fmtDate(r.matchedBatch.expiryDate)})` : ' · FEFO batch') +
        (r.parsed.format ? ` · ${r.parsed.format}` : ''),
    });
    r.warnings.forEach(w => toast('⚠ ' + w));
    barcodeRef.current?.focus();
  }, [addToCart]);
  const handleScanRef = useRef(handleScan);
  handleScanRef.current = handleScan;

  // Wedge-anywhere: fast keyboard bursts anywhere on this screen are scans.
  useEffect(() => {
    if (!scanner.enabled || !scanner.autoDetectWedge || scanner.inputMode === 'dedicated') return;
    const suffixKeys = scanner.suffix === 'enter' ? ['Enter'] : scanner.suffix === 'tab' ? ['Tab'] : ['Enter', 'Tab'];
    const det = new WedgeDetector({ suffixKeys });
    wedgeRef.current = det;
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (modalOpenRef.current) return; // never scan behind an open dialog
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      const scanned = det.feed(e.key === 'Dead' ? '' : e.key, Date.now());
      if (scanned) {
        // If the burst landed in our dedicated box, its own handler may also
        // fire — the ScanGate collapses the duplicate. Stop the suffix key
        // from submitting forms / moving focus.
        e.preventDefault();
        handleScanRef.current(scanned);
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [scanner.enabled, scanner.autoDetectWedge, scanner.inputMode, scanner.suffix]);

  const onBarcodeKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const isSuffix = e.key === 'Enter' || (e.key === 'Tab' && scanner.suffix !== 'enter');
    if (isSuffix) { e.preventDefault(); handleScan(barcode); }
  };

  const subtotal = cart.reduce((s, l) => s + l.qty * l.unitPricePaisa, 0);
  const lineDisc = cart.reduce((s, l) => s + l.discountPaisa, 0);
  // Bill discount: fixed Rs OR percentage of (subtotal − line discounts).
  // The invoice always records the computed paisa amount.
  const billDiscPctRaw = parseFloat(billDiscRs) || 0;
  const billDiscPct = Math.max(0, Math.min(100, billDiscPctRaw));
  const billDisc = billDiscType === 'pct'
    ? percentOf(Math.max(0, subtotal - lineDisc), billDiscPct)
    : toPaisa(billDiscRs || 0);
  const discountTotal = lineDisc + billDisc;
  const tax = percentOf(Math.max(0, subtotal - discountTotal), db.settings.taxRatePct);
  const total = Math.max(0, subtotal - discountTotal) + tax;
  const paid = paidRs === '' ? total : toPaisa(paidRs);
  const change = Math.max(0, paid - total);
  const balance = Math.max(0, total - paid);

  const fefoPreview = (l: CartLine): string => {
    let rem = l.qty; const parts: string[] = [];
    const batches = engine.eligibleBatches(l.medicineId);
    const ordered = l.preferredBatchId
      ? [batches.find(b => b.id === l.preferredBatchId), ...batches.filter(b => b.id !== l.preferredBatchId)].filter(Boolean) as typeof batches
      : batches;
    for (const b of ordered) { if (rem <= 0) break; const take = Math.min(b.qtyRemaining, rem); parts.push(`${b.batchNo}×${take} (exp ${fmtDate(b.expiryDate)})`); rem -= take; }
    return parts.join(' + ') || '—';
  };

  const checkout = () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const sale = engine.createSale(user, {
        customerId,
        items: cart.map(l => ({ medicineId: l.medicineId, qty: l.qty, unitPricePaisa: l.unitPricePaisa, discountPaisa: l.discountPaisa, preferredBatchId: l.preferredBatchId, packaging: l.packaging, barcodeRecordId: l.barcodeRecordId, priceOverrideId: l.priceOverrideId })),
        billDiscountPaisa: billDisc,
        payments: paid > 0 ? [{ method, amountPaisa: Math.min(paid, total) }] : [], idempotencyKey: idemKey,
      });
      setLastSale(sale);
      setCart([]); setPaidRs(''); setBillDiscRs(''); setIdemKey(uid()); setBanner(null); gateRef.current.reset();
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
    <Page title="Point of Sale" sub="Scan barcode / QR / GS1 DataMatrix (F2) · Search (F4) · Complete sale (F9). Stock is deducted only when the sale completes.">
      {banner && (
        <div className={`rounded-xl px-4 py-2.5 mb-3 text-sm font-semibold border ${banner.ok ? 'bg-teal-50 dark:bg-teal-900/30 border-teal-200 dark:border-teal-700 text-teal-800 dark:text-teal-100' : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700 text-red-800 dark:text-red-100'}`}>
          {banner.text}<span className="block text-xs font-medium opacity-80">{banner.sub}</span>
        </div>
      )}
      <div className="grid lg:grid-cols-5 gap-4 items-start">
        <div className="lg:col-span-3 space-y-4">
          <Card>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label={`🔫 Scanner input ${scanner.enabled ? `(${scanner.inputMode}, suffix: ${scanner.suffix})` : '— DISABLED in Settings'}`}>
                <div className="flex gap-2">
                  <input ref={barcodeRef} className={inputCls} placeholder="Scan barcode / QR / DataMatrix…" value={barcode}
                    onChange={e => setBarcode(e.target.value)} onKeyDown={onBarcodeKey} autoFocus />
                  {scanner.cameraEnabled && <Btn kind="ghost" onClick={() => setCameraOpen(true)}>📷</Btn>}
                </div>
              </Field>
              <Field label="🔍 Search medicine (name / generic / brand)">
                <input id="pos-search" className={inputCls} placeholder="e.g. Panadol, paracetamol…" value={search} onChange={e => setSearch(e.target.value)} />
              </Field>
            </div>
            {scanner.autoDetectWedge && scanner.inputMode !== 'dedicated' && scanner.enabled && (
              <p className="text-[11px] text-slate-400 mt-1.5">Scanner auto-detection is ON — you can scan anywhere on this screen; fast scanner input is captured automatically.</p>
            )}
            {search && (
              <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-700 max-h-64 overflow-y-auto">
                {results.length === 0 && <p className="text-sm text-slate-400 py-3">No matching medicine. Check spelling or register it under Medicines.</p>}
                {results.map(m => {
                  const st = engine.saleableStock(m.id);
                  return (
                    <button key={m.id} onClick={() => { addMed(m); setSearch(''); barcodeRef.current?.focus(); }}
                      className="w-full flex items-center justify-between py-2 px-1 text-left hover:bg-teal-50 dark:hover:bg-slate-700/40 rounded">
                      <span><span className="font-semibold text-slate-800 dark:text-slate-100">{medLabel(m)}</span>
                        <span className="block text-xs text-slate-400">{m.genericName} · {m.packSize} · {m.barcode || 'no barcode'}</span></span>
                      <span className="text-right"><span className="font-bold text-teal-700 dark:text-teal-300">{money(m.retailPricePaisa)}</span>
                        <span className="block text-xs">{st > 0 ? <Badge color="green">{st} in stock</Badge> : <Badge color="red">Out of stock</Badge>}</span></span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title={`Cart (${cart.length} line${cart.length === 1 ? '' : 's'}) — quantities are in base units; FEFO/scanned-batch allocation preview`}>
            {cart.length === 0 ? <p className="text-sm text-slate-400 py-6 text-center">Cart is empty. Scan a barcode or search a medicine to begin billing. Scanning never reduces stock until checkout.</p> : (
              <div className="space-y-2">
                {cart.map(l => {
                  const m = engine.medicine(l.medicineId);
                  return (
                    <div key={l.key} className="flex flex-wrap items-center gap-2 border border-slate-100 dark:border-slate-700 rounded-xl p-2.5">
                      <div className="flex-1 min-w-[170px]">
                        <div className="font-semibold text-sm text-slate-800 dark:text-slate-100">{medLabel(m)}
                          {l.packaging && <Badge color="blue"> {l.packaging}</Badge>}
                          {l.scannedBatchNo && <Badge color="green"> scanned batch {l.scannedBatchNo}</Badge>}
                        </div>
                        <div className="text-[11px] text-slate-400">Batch: {fefoPreview(l)} · qty in {m.unit}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-700 font-bold" onClick={() => setCart(c => c.map(x => x.key === l.key ? { ...x, qty: Math.max(1, x.qty - 1) } : x))}>−</button>
                        <input className={inputCls + ' !w-16 text-center'} type="number" min={1} value={l.qty}
                          onChange={e => setCart(c => c.map(x => x.key === l.key ? { ...x, qty: Math.max(1, parseInt(e.target.value) || 1) } : x))} />
                        <button className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-700 font-bold" onClick={() => addToCart(m, 1, l.unitPricePaisa, { preferredBatchId: l.preferredBatchId, packaging: l.packaging, scannedBatchNo: l.scannedBatchNo, barcodeRecordId: l.barcodeRecordId })}>+</button>
                      </div>
                      <div className="flex items-center gap-1" title={`Authorized price per ${m.unit}. Any other price needs an administrator-approved override.`}>
                        <input className={inputCls + ' !w-24 bg-slate-50 dark:bg-slate-700/40'} type="number" min={0} readOnly value={l.unitPricePaisa / 100} />
                        <button className="w-7 h-7 rounded bg-amber-100 dark:bg-amber-900/40 text-sm" title="Request administrator price override" onClick={() => setOverrideFor(l)}>🔑</button>
                      </div>
                      <input className={inputCls + ' !w-20'} type="number" min={0} placeholder="Disc Rs" title="Line discount Rs" value={l.discountPaisa ? l.discountPaisa / 100 : ''}
                        onChange={e => setCart(c => c.map(x => x.key === l.key ? { ...x, discountPaisa: toPaisa(e.target.value) } : x))} />
                      <div className="w-24 text-right font-bold text-sm">{money(l.qty * l.unitPricePaisa - l.discountPaisa)}{l.overrideNote && <div className="text-[10px] font-semibold text-amber-600">{l.overrideNote}</div>}</div>
                      <button className="text-red-500 font-bold px-1" onClick={() => setCart(c => c.filter(x => x.key !== l.key))} title="Remove">✕</button>
                    </div>
                  );
                })}
                <button onClick={() => setConfirmClear(true)} title="Remove all lines and start a fresh sale. No stock has moved yet — nothing is posted until checkout."
                  className="w-full mt-2 px-3.5 py-2.5 rounded-lg text-sm font-bold bg-red-600 text-white shadow hover:bg-red-500 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-red-400 transition">🧹 Clear Cart — cancel this sale</button>
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
              <div className="flex justify-between items-center gap-2"><span>Bill discount</span>
                <div className="flex items-center gap-1.5">
                  <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600 text-xs font-bold">
                    <button type="button" onClick={() => setBillDiscType('fixed')} className={`px-2 py-1.5 ${billDiscType === 'fixed' ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-700'}`}>Rs</button>
                    <button type="button" onClick={() => setBillDiscType('pct')} className={`px-2 py-1.5 ${billDiscType === 'pct' ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-700'}`}>%</button>
                  </div>
                  <input className={inputCls + ' !w-24 text-right'} type="number" min={0} max={billDiscType === 'pct' ? 100 : undefined} step={billDiscType === 'pct' ? '0.5' : undefined}
                    value={billDiscRs} onChange={e => setBillDiscRs(e.target.value)} placeholder="0"
                    title={billDiscType === 'pct' ? 'Percentage of (subtotal − line discounts)' : 'Fixed discount in rupees'} />
                </div>
              </div>
              {billDiscType === 'pct' && billDiscRs !== '' && <div className="flex justify-between text-xs text-slate-400"><span>{billDiscPct}% of {money(Math.max(0, subtotal - lineDisc))}</span><span>= {money(billDisc)}{billDiscPctRaw > 100 ? ' (capped at 100%)' : ''}</span></div>}
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
            <p className="text-[11px] text-slate-400">Stock is re-checked at checkout and deducted only on success — a failed sale rolls back stock, cash and ledger completely. Expired batches can never be sold.</p>
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
      {unknownCode && (
        <UnknownBarcodeModal user={user} code={unknownCode} close={() => { setUnknownCode(null); barcodeRef.current?.focus(); }}
          onRegistered={() => { const c = unknownCode; setUnknownCode(null); gateRef.current.reset(); if (c) handleScan(c); }} />
      )}
      {cameraOpen && <CameraScan close={() => setCameraOpen(false)} onScan={(code) => handleScan(code)} />}
      {confirmClear && <Confirm text="Cancel this sale and clear the cart? No stock, cash or ledger changes have been made yet — nothing to undo." onNo={() => setConfirmClear(false)} onYes={() => { setCart([]); setBanner(null); setConfirmClear(false); barcodeRef.current?.focus(); }} />}
      {overrideFor && (
        <PriceOverrideModal user={user} line={overrideFor} close={() => setOverrideFor(null)}
          apply={(newPricePaisa, overrideId, note) => {
            setCart(c => c.map(x => x.key === overrideFor.key ? { ...x, unitPricePaisa: newPricePaisa, priceOverrideId: overrideId, overrideNote: note } : x));
            setOverrideFor(null);
          }} />
      )}
    </Page>
  );
}

/** Unknown-barcode workflow: never auto-adds anything. An authorized user may
 *  register the code against an existing medicine (any packaging level) or
 *  create a new medicine; only then is the scan re-processed. */
function UnknownBarcodeModal({ user, code, close, onRegistered }: { user: SessionUser; code: string; close: () => void; onRegistered: () => void }) {
  const db = engine.db;
  const canEdit = can(user.role, 'medicines.edit');
  const [q, setQ] = useState('');
  const [medId, setMedId] = useState<number | null>(null);
  const [level, setLevel] = useState<PackagingLevel>('strip');
  const [units, setUnits] = useState('1');
  const [sellRs, setSellRs] = useState('');
  const [costRs, setCostRs] = useState('');
  const [newName, setNewName] = useState('');
  const [newPriceRs, setNewPriceRs] = useState('');
  const results = useMemo(() => engine.searchMedicines(q), [q, db]);
  const med = medId ? db.medicines.find(m => m.id === medId) : undefined;

  const registerExisting = () => {
    if (!medId) { toast('Select a medicine first.', true); return; }
    if (run(() => engine.addMedicineBarcode(user, {
      medicineId: medId, barcode: code, packagingLevel: level, unitsPerPackage: parseInt(units) || 1,
      sellPricePaisa: toPaisa(sellRs || 0), purchaseCostPaisa: toPaisa(costRs || 0),
    }), `Barcode registered to ${med?.name}. Adding to cart…`)) onRegistered();
  };
  const createNew = () => {
    if (run(() => {
      const m = engine.saveMedicine(user, { name: newName, barcode: code, retailPricePaisa: toPaisa(newPriceRs || 0) });
      if ((parseInt(units) || 1) !== 1 || level !== 'strip') {
        const rec = engine.barcodesFor(m.id).find(b => b.isPrimary);
        if (rec) engine.updateMedicineBarcode(user, rec.id, { packagingLevel: level, unitsPerPackage: parseInt(units) || 1, sellPricePaisa: toPaisa(sellRs || 0), purchaseCostPaisa: toPaisa(costRs || 0) });
      }
    }, 'Medicine created with this barcode. Note: it has no stock yet — receive stock via Purchases.')) close();
  };

  return (
    <Modal title="❓ Unknown barcode — not added to sale" onClose={close} wide>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-1">Scanned code: <b className="font-mono">{code}</b></p>
      <p className="text-sm text-slate-500 mb-4">This barcode is not registered. It has <b>not</b> been added to the bill. {canEdit ? 'Register it now:' : 'Ask an admin or pharmacist to register it (Medicines → Barcodes), then scan again.'}</p>
      {canEdit && (
        <div className="grid md:grid-cols-2 gap-5">
          <div className="space-y-3">
            <div className="font-semibold text-sm">Option A — attach to an existing medicine</div>
            <Field label="Search medicine"><input className={inputCls} value={q} onChange={e => setQ(e.target.value)} placeholder="Type medicine name…" /></Field>
            <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
              {results.map(m => (
                <button key={m.id} onClick={() => setMedId(m.id)} className={`w-full text-left text-sm py-1.5 px-1 rounded ${medId === m.id ? 'bg-teal-100 dark:bg-teal-900/50 font-semibold' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}>
                  {medLabel(m)} <span className="text-slate-400">· stock unit: {m.unit}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Packaging level"><select className={inputCls} value={level} onChange={e => setLevel(e.target.value as PackagingLevel)}>
                <option value="box">Box</option><option value="bottle">Bottle</option><option value="strip">Strip</option><option value="unit">Individual unit</option></select></Field>
              <Field label={`Base units in 1 package${med ? ` (${med.unit})` : ''}`}><input className={inputCls} type="number" min={1} value={units} onChange={e => setUnits(e.target.value)} /></Field>
              <Field label="Selling price / package Rs (0=inherit)"><input className={inputCls} type="number" min={0} value={sellRs} onChange={e => setSellRs(e.target.value)} /></Field>
              <Field label="Purchase cost / package Rs (0=inherit)"><input className={inputCls} type="number" min={0} value={costRs} onChange={e => setCostRs(e.target.value)} /></Field>
            </div>
            <Btn className="w-full" onClick={registerExisting}>Register barcode &amp; add to cart</Btn>
          </div>
          <div className="space-y-3">
            <div className="font-semibold text-sm">Option B — create a new medicine</div>
            <Field label="Medicine name *"><input className={inputCls} value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Disprin 300mg" /></Field>
            <Field label="Retail price per base unit (Rs)"><input className={inputCls} type="number" min={0} value={newPriceRs} onChange={e => setNewPriceRs(e.target.value)} /></Field>
            <p className="text-xs text-slate-400">Creates the medicine with this barcode as its primary (packaging settings from the left form apply). Complete its full details later under Medicines. It will have <b>no stock</b> until you record a Purchase.</p>
            <Btn kind="soft" className="w-full" onClick={createNew}>Create new medicine</Btn>
            <Btn kind="ghost" className="w-full" onClick={close}>Skip — do not add anything</Btn>
          </div>
        </div>
      )}
      {!canEdit && <div className="flex justify-end"><Btn kind="ghost" onClick={close}>Close</Btn></div>}
    </Modal>
  );
}

/** Administrator-approved price override. The price field in the cart is
 *  locked for every role; this modal is the only way to change it, and the
 *  engine verifies the approver (admin credentials when the cashier asks). */
function PriceOverrideModal({ user, line, close, apply }: {
  user: SessionUser; line: CartLine; close: () => void;
  apply: (newPricePaisa: number, overrideId: number, note: string) => void;
}) {
  const med = engine.medicine(line.medicineId);
  const authorized = engine.authorizedUnitPrice(line.medicineId, line.barcodeRecordId);
  const selfApprove = can(user.role, 'pos.price.override');
  const [priceRs, setPriceRs] = useState(String(line.unitPricePaisa / 100));
  const [reason, setReason] = useState('');
  const [adminUser, setAdminUser] = useState('');
  const [adminPw, setAdminPw] = useState('');
  const submit = () => {
    try {
      const rec = engine.authorizePriceOverride(user, {
        medicineId: line.medicineId, barcodeRecordId: line.barcodeRecordId,
        newUnitPricePaisa: toPaisa(priceRs || 0), reason,
        approverUsername: selfApprove ? undefined : adminUser,
        approverPassword: selfApprove ? undefined : adminPw,
      });
      toast('Price override approved and recorded in Audit Logs.');
      apply(rec.newPricePaisa, rec.id, '🔑 admin-approved price');
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <Modal title={`Price override — ${medLabel(med)}`} onClose={close}>
      <p className="text-sm text-slate-500 mb-3">Authorized selling price: <b>{money(authorized)}</b> per {med.unit}. Selling at any other price requires administrator approval with a reason. The approval (old price, new price, approver, reason, time) is written to Audit Logs and linked to the invoice.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`New price per ${med.unit} (Rs) *`}><input type="number" min={0} className={inputCls} value={priceRs} onChange={e => setPriceRs(e.target.value)} autoFocus /></Field>
        <Field label="Reason *"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Damaged outer box — owner agreed" /></Field>
        {!selfApprove && (<>
          <Field label="Administrator username *"><input className={inputCls} value={adminUser} onChange={e => setAdminUser(e.target.value)} autoComplete="off" /></Field>
          <Field label="Administrator password *"><input type="password" className={inputCls} value={adminPw} onChange={e => setAdminPw(e.target.value)} autoComplete="new-password" /></Field>
        </>)}
      </div>
      {selfApprove && <p className="text-xs text-slate-400 mt-2">You are approving this override yourself ({user.fullName}).</p>}
      <div className="flex justify-end gap-2 mt-5">
        <Btn kind="ghost" onClick={close}>Cancel</Btn>
        <Btn disabled={!reason.trim() || priceRs === '' || (!selfApprove && (!adminUser.trim() || !adminPw))} onClick={submit}>Approve & apply price</Btn>
      </div>
    </Modal>
  );
}

