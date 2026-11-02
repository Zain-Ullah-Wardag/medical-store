import { useMemo, useState } from 'react';
import { engine } from '../lib/store';
import { Page, Card, Btn, Modal, Field, inputCls, money, Table, Badge, Empty, run, fmtDate, fmtDateTime, ExportBtn, medLabel, DetailRow, Tabs } from '../components/ui';
import { todayStr, addDays, localDateOf } from '../core/money';
import type { Sale, SessionUser } from '../core/types';
import { can } from '../core/types';
import { Receipt } from '../components/Receipt';

export function SalesHistory({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [from, setFrom] = useState(todayStr()); const [to, setTo] = useState(todayStr());
  const [q, setQ] = useState(''); const [cashierId, setCashierId] = useState(''); const [methodF, setMethodF] = useState('');
  const [detail, setDetail] = useState<Sale | null>(null); const [printSale, setPrintSale] = useState<Sale | null>(null);
  // Engine-enforced visibility: cashiers only ever receive their own sales.
  const rows = engine.listSales(user, { from, to, query: q, cashierId: cashierId ? Number(cashierId) : null, method: methodF });
  return (
    <Page title="Sales History" sub={user.role === 'cashier' ? 'Showing only your own sales. Completed invoices are never deleted — corrections go through Sales Returns.' : 'Completed invoices are never deleted — corrections go through Sales Returns.'}
      actions={<ExportBtn filename={`sales-history-${from}-to-${to}.csv`} headerLine={`${db.settings.storeName} — Sales history — ${from} to ${to} — generated ${new Date().toLocaleString('en-PK')}`} rows={rows.map(s => ({ Invoice: s.invoiceNo, DateTime: s.dateTime, Customer: db.customers.find(c => c.id === s.customerId)?.name ?? '', Cashier: db.users.find(u => u.id === s.userId)?.fullName ?? '', TotalPKR: s.totalPaisa / 100, PaidPKR: (s.paidPaisa + db.customerPayments.filter(p => p.saleId === s.id).reduce((x, p) => x + p.amountPaisa, 0)) / 100 }))} />}>
      <Card>
        <div className="grid md:grid-cols-5 gap-2 mb-3">
          <Field label="Date from (inclusive)"><input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="Date to (inclusive)"><input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} /></Field>
          <Field label="Invoice no. or customer"><input className={inputCls} placeholder="INV-000001 or Ali…" value={q} onChange={e => setQ(e.target.value)} /></Field>
          <Field label="Cashier"><select className={inputCls} value={cashierId} onChange={e => setCashierId(e.target.value)}><option value="">All cashiers</option>{db.users.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></Field>
          <Field label="Payment method"><select className={inputCls} value={methodF} onChange={e => setMethodF(e.target.value)}><option value="">All payment methods</option>{db.settings.paymentMethods.map(m => <option key={m}>{m}</option>)}</select></Field>
        </div>
        {rows.length === 0 ? <Empty text="No sales in this filter range." /> : (
          <Table head={['Invoice', 'Date & time', 'Customer', 'Cashier', 'Total', 'Paid', 'Due', 'Status', '']}>
            {rows.map(s => { const due = s.totalPaisa - s.paidPaisa - db.customerPayments.filter(p => p.saleId === s.id).reduce((x, p) => x + p.amountPaisa, 0); return (
              <tr key={s.id}><td className="font-semibold">{s.invoiceNo}</td><td>{fmtDateTime(s.dateTime)}</td>
                <td>{db.customers.find(c => c.id === s.customerId)?.name}</td><td>{db.users.find(u => u.id === s.userId)?.fullName}</td>
                <td className="font-semibold">{money(s.totalPaisa)}</td><td>{money(s.paidPaisa)}</td>
                <td>{due > 0 ? <Badge color="amber">{money(due)}</Badge> : '—'}</td>
                <td>{db.salesReturns.some(r => r.saleId === s.id) ? <Badge color="blue">Has returns</Badge> : <Badge color="green">Completed</Badge>}</td>
                <td><div className="flex gap-1.5 whitespace-nowrap"><Btn kind="soft" onClick={() => setDetail(s)}>View</Btn><Btn kind="ghost" onClick={() => setPrintSale(s)}>🖨 Reprint</Btn></div></td></tr>); })}
          </Table>
        )}
        <div className="mt-3 text-right text-sm font-semibold">Total: {money(rows.reduce((s, x) => s + x.totalPaisa, 0))} · {rows.length} invoices</div>
      </Card>
      {detail && (
        <Modal title={`Invoice ${detail.invoiceNo}`} onClose={() => setDetail(null)} wide>
          <Table head={['Medicine', 'Batch (FEFO)', 'Qty', 'Unit price', 'Line total']}>
            {db.saleItems.filter(i => i.saleId === detail.id).map(i => <tr key={i.id}><td>{i.medicineName}</td>
              <td className="text-xs">{i.allocations.map(a => `${a.batchNo}×${a.qty} (exp ${fmtDate(a.expiryDate)})`).join(', ')}</td>
              <td>{i.qty}</td><td>{money(i.unitPricePaisa)}</td><td className="font-semibold">{money(i.lineTotalPaisa)}</td></tr>)}
          </Table>
          <div className="mt-2 text-sm space-y-1">
            <div>Subtotal {money(detail.subtotalPaisa)} · Discount {money(detail.discountPaisa)} · Tax {money(detail.taxPaisa)} · <b>Total {money(detail.totalPaisa)}</b> · Paid {money(detail.paidPaisa)}</div>
            {db.salesReturns.filter(r => r.saleId === detail.id).map(r => <div key={r.id} className="text-amber-600">Return {r.returnNo}: refund {money(r.refundPaisa)} ({r.method}) — {r.reason}</div>)}
          </div>
        </Modal>
      )}
      {printSale && (
        <Modal title={`Receipt — ${printSale.invoiceNo}`} onClose={() => setPrintSale(null)}>
          <Receipt sale={printSale} />
          <div className="flex justify-end gap-2 mt-4 no-print"><Btn kind="ghost" onClick={() => setPrintSale(null)}>Close</Btn><Btn onClick={() => window.print()}>🖨 Print / Save PDF</Btn></div>
        </Modal>
      )}
    </Page>
  );
}

const DISPOSITION_LABEL: Record<string, string> = {
  saleable: 'Sealed & good → back to saleable stock',
  quarantine: 'Questionable → quarantine',
  damaged: 'Damaged/opened → damaged',
};
const DISPOSITION_RESULT: Record<string, string> = {
  saleable: 'Returned to saleable stock',
  quarantine: 'Quarantine batch (not saleable)',
  damaged: 'Damaged batch (not saleable)',
};
/** Exact engine refund formula (createSalesReturn): proportional share of the line total. */
const refundPreview = (lineTotalPaisa: number, returnQty: number, soldQty: number) =>
  soldQty > 0 && returnQty > 0 ? Math.round((lineTotalPaisa * returnQty) / soldQty) : 0;

export function SalesReturns({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [tab, setTab] = useState<'new' | 'history'>('new');
  const [invQuery, setInvQuery] = useState('');
  const [saleId, setSaleId] = useState<number | null>(null);
  const [qtys, setQtys] = useState<Record<number, number>>({});
  const [disps, setDisps] = useState<Record<number, 'saleable' | 'quarantine' | 'damaged'>>({});
  const [method, setMethod] = useState<'cash' | 'credit' | 'card' | 'bank'>('cash'); const [reason, setReason] = useState('');
  const [detailRet, setDetailRet] = useState<number | null>(null);
  const sale = db.sales.find(s => s.id === saleId);
  const items = sale ? db.saleItems.filter(i => i.saleId === sale.id) : [];
  const matches = useMemo(() => invQuery ? db.sales.filter(s => s.invoiceNo.toLowerCase().includes(invQuery.toLowerCase())).slice(0, 6) : [], [invQuery, db]);
  const lineRefund = (i: (typeof items)[number]) => refundPreview(i.lineTotalPaisa, qtys[i.id] ?? 0, i.qty);
  const selectedLines = items.filter(i => (qtys[i.id] ?? 0) > 0);
  const totalRefund = items.reduce((sum, i) => sum + lineRefund(i), 0);
  const submit = () => {
    if (!sale) return;
    const ok = run(() => engine.createSalesReturn(user, {
      saleId: sale.id, reason, method,
      items: items.map(i => ({ saleItemId: i.id, qty: qtys[i.id] ?? 0, disposition: disps[i.id] ?? 'quarantine' })),
    }), 'Sales return recorded.');
    if (ok) { setQtys({}); setReason(''); }
  };
  const history = [...db.salesReturns].reverse();
  return (
    <Page title="Sales Returns" sub="Returns never delete the original sale. Opened/damaged/expired medicine goes to quarantine — never back on the saleable shelf automatically.">
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'new', label: '↩ New Return' },
        { key: 'history', label: '🕘 Return History', count: history.length },
      ]} />

      {tab === 'new' && (
        <div className="space-y-4">
          <Card title="1) Find the original invoice">
            <input className={inputCls} placeholder="Type invoice number, e.g. INV-000001" value={invQuery} onChange={e => setInvQuery(e.target.value)} />
            <div className="divide-y divide-slate-100 dark:divide-slate-700 mt-2">
              {matches.map(s => <button key={s.id} onClick={() => { setSaleId(s.id); setQtys({}); setDisps({}); }} className={`w-full flex justify-between py-2 text-left text-sm rounded px-1 ${saleId === s.id ? 'bg-teal-50 dark:bg-teal-900/30' : 'hover:bg-teal-50 dark:hover:bg-slate-700/40'}`}>
                <span><b>{s.invoiceNo}</b> · {fmtDateTime(s.dateTime)} · {db.customers.find(c => c.id === s.customerId)?.name ?? '—'}</span><span className="font-semibold">{money(s.totalPaisa)}</span></button>)}
            </div>
            {invQuery && matches.length === 0 && <Empty text="No invoice matches that number." />}
          </Card>

          {sale && (
            <>
              <Card title={`2) Invoice ${sale.invoiceNo}`}>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6">
                  <DetailRow label="Customer">{db.customers.find(c => c.id === sale.customerId)?.name ?? '—'}</DetailRow>
                  <DetailRow label="Sale date">{fmtDateTime(sale.dateTime)}</DetailRow>
                  <DetailRow label="Sold by">{db.users.find(u => u.id === sale.userId)?.fullName ?? '—'}</DetailRow>
                  <DetailRow label="Invoice total">{money(sale.totalPaisa)} (paid {money(sale.paidPaisa)})</DetailRow>
                </div>
              </Card>

              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {items.map(i => { const returned = engine.returnedQtyForSaleItem(i.id); const max = i.qty - returned; const q = qtys[i.id] ?? 0; const sel = q > 0; return (
                  <div key={i.id} className={`border rounded-xl p-3 bg-white dark:bg-slate-800 transition ${sel ? 'border-teal-500 ring-1 ring-teal-500' : 'border-slate-200 dark:border-slate-700'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold leading-snug break-words">{i.medicineName}</div>
                      {sel && <Badge color="green">returning {q}</Badge>}
                    </div>
                    <div className="text-xs text-slate-400 break-words mt-0.5">
                      Batch {i.allocations.map(a => `${a.batchNo}×${a.qty}`).join(', ')}{i.packaging ? ` · sold as ${i.packaging}` : ''}
                    </div>
                    <div className="mt-2 space-y-0.5">
                      <DetailRow label="Originally sold">{i.qty}</DetailRow>
                      <DetailRow label="Unit selling price">{money(i.unitPricePaisa)}</DetailRow>
                      <DetailRow label="Already returned">{returned}</DetailRow>
                      <DetailRow label="Available to return">{max}</DetailRow>
                    </div>
                    <div className="flex items-end justify-between gap-2 mt-2 pt-2 border-t border-dashed border-slate-200 dark:border-slate-600">
                      <div>
                        <label className="block text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">Return qty</label>
                        <input type="number" min={0} max={max} step={1} inputMode="numeric" disabled={max === 0}
                          aria-label={`Return quantity for ${i.medicineName}`}
                          className={inputCls + ' !w-[104px] text-center'}
                          value={qtys[i.id] ?? 0}
                          onFocus={e => e.target.select()}
                          onWheel={e => (e.target as HTMLInputElement).blur()}
                          onChange={e => { const v = e.target.value === '' ? 0 : parseInt(e.target.value, 10); setQtys(prev => ({ ...prev, [i.id]: Number.isNaN(v) ? 0 : Math.max(0, Math.min(max, v)) })); }} />
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Refund</div>
                        <div className="font-bold">{q > 0 ? money(lineRefund(i)) : '—'}</div>
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="block text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">Medicine condition / stock disposition</label>
                      <select className={inputCls} disabled={max === 0} value={disps[i.id] ?? 'quarantine'} onChange={e => setDisps(d => ({ ...d, [i.id]: e.target.value as any }))}>
                        <option value="saleable">{DISPOSITION_LABEL.saleable}</option>
                        <option value="quarantine">{DISPOSITION_LABEL.quarantine}</option>
                        <option value="damaged">{DISPOSITION_LABEL.damaged}</option>
                      </select>
                    </div>
                    {max === 0 && <div className="text-[11px] text-slate-400 mt-1.5">Fully returned already.</div>}
                  </div>); })}
              </div>

              <Card title="3) Return summary">
                <div className="grid sm:grid-cols-3 gap-x-6 mb-3">
                  <DetailRow label="Medicines selected">{selectedLines.length} of {items.length}</DetailRow>
                  <DetailRow label="Units returning">{selectedLines.reduce((sum, i) => sum + (qtys[i.id] ?? 0), 0)}</DetailRow>
                  <DetailRow label="Estimated refund">{money(totalRefund)}</DetailRow>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Refund method"><select className={inputCls} value={method} onChange={e => setMethod(e.target.value as any)}>
                    <option value="cash">Cash refund</option><option value="credit">Customer credit (reduce udhaar)</option><option value="card">Card reversal</option><option value="bank">Bank transfer</option></select></Field>
                  <Field label="Reason *"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Wrong medicine dispensed" /></Field>
                </div>
                <Btn className="w-full mt-4" disabled={selectedLines.length === 0 || !reason.trim()} onClick={submit}>
                  Record sales return{selectedLines.length > 0 ? ` — refund ${money(totalRefund)}` : ''}
                </Btn>
                {selectedLines.length === 0 && <p className="text-xs text-slate-400 mt-1.5">Enter a return quantity on at least one medicine card.</p>}
              </Card>
            </>
          )}
        </div>
      )}

      {tab === 'history' && (
        history.length === 0 ? <Card><Empty text="No sales returns yet." /></Card> : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {history.map(r => { const orig = db.sales.find(s => s.id === r.saleId); return (
              <div key={r.id} className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 bg-white dark:bg-slate-800 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold">{r.returnNo}</div>
                  <Btn kind="soft" onClick={() => setDetailRet(r.id)}>View Details</Btn>
                </div>
                <div className="mt-1.5 flex-1">
                  <DetailRow label="Original invoice">{orig?.invoiceNo ?? '—'}</DetailRow>
                  <DetailRow label="Customer">{db.customers.find(c => c.id === orig?.customerId)?.name ?? '—'}</DetailRow>
                  <DetailRow label="Return date">{fmtDateTime(r.dateTime)}</DetailRow>
                  <DetailRow label="Refund amount"><span className="font-bold">{money(r.refundPaisa)}</span></DetailRow>
                  <DetailRow label="Refund method">{r.method}</DetailRow>
                  <DetailRow label="Recorded by">{db.users.find(u => u.id === r.userId)?.fullName ?? '—'}</DetailRow>
                </div>
                <div className="mt-2 pt-2 border-t border-dashed border-slate-200 dark:border-slate-600 text-sm">
                  <span className="text-slate-400 text-xs uppercase tracking-wide font-semibold">Reason</span>
                  <div className="break-words mt-0.5">{r.reason}</div>
                </div>
              </div>); })}
          </div>
        )
      )}

      {detailRet !== null && (() => {
        const r = db.salesReturns.find(x => x.id === detailRet)!;
        const orig = db.sales.find(s => s.id === r.saleId);
        const rItems = db.salesReturnItems.filter(x => x.returnId === r.id);
        return (
          <Modal title={`Sales return ${r.returnNo}`} onClose={() => setDetailRet(null)} wide>
            <div className="grid sm:grid-cols-2 gap-x-6 mb-3">
              <DetailRow label="Return ID">{r.returnNo}</DetailRow>
              <DetailRow label="Original invoice">{orig?.invoiceNo ?? '—'}</DetailRow>
              <DetailRow label="Customer">{db.customers.find(c => c.id === orig?.customerId)?.name ?? '—'}</DetailRow>
              <DetailRow label="Date & time">{fmtDateTime(r.dateTime)}</DetailRow>
              <DetailRow label="Refund method">{r.method}</DetailRow>
              <DetailRow label="Recorded by">{db.users.find(u => u.id === r.userId)?.fullName ?? '—'}</DetailRow>
            </div>
            <div className="space-y-2">
              {rItems.map(ri => { const si = db.saleItems.find(x => x.id === ri.saleItemId); return (
                <div key={ri.id} className="border border-slate-200 dark:border-slate-700 rounded-xl p-3">
                  <div className="font-semibold break-words">{si?.medicineName ?? engine.medicine(ri.medicineId).name}</div>
                  <div className="grid sm:grid-cols-2 gap-x-6 mt-1">
                    <DetailRow label="Batch (as sold)">{si ? si.allocations.map(a => `${a.batchNo}×${a.qty} (exp ${fmtDate(a.expiryDate)})`).join(', ') : '—'}</DetailRow>
                    <DetailRow label="Quantity returned">{ri.qty}</DetailRow>
                    <DetailRow label="Medicine condition">{DISPOSITION_LABEL[ri.disposition]}</DetailRow>
                    <DetailRow label="Stock disposition">{DISPOSITION_RESULT[ri.disposition]}</DetailRow>
                    <DetailRow label="Refund for this medicine">{money(ri.amountPaisa)}</DetailRow>
                  </div>
                </div>); })}
            </div>
            <div className="flex justify-between items-center mt-4 text-sm">
              <span className="text-slate-400">Reason: <span className="text-slate-700 dark:text-slate-200 break-words">{r.reason}</span></span>
              <span className="font-bold shrink-0 ml-3">Total refund: {money(r.refundPaisa)}</span>
            </div>
            <div className="flex justify-end mt-4"><Btn onClick={() => setDetailRet(null)}>Close</Btn></div>
          </Modal>);
      })()}
    </Page>
  );
}

export function PurchaseReturns({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [detailId, setDetailId] = useState<number | null>(null);
  const [supplierId, setSupplierId] = useState(String(db.suppliers[0]?.id ?? ''));
  const [qtys, setQtys] = useState<Record<number, number>>({}); const [reason, setReason] = useState('');
  const batches = db.batches.filter(b => b.supplierId === Number(supplierId) && b.qtyRemaining > 0)
    .sort((a, b2) => engine.medicine(a.medicineId).name.localeCompare(engine.medicine(b2.medicineId).name) || a.expiryDate.localeCompare(b2.expiryDate));
  const qtyError = (batchId: number, max: number): string => {
    const q = qtys[batchId];
    if (q === undefined) return '';
    if (!Number.isFinite(q) || q < 0) return 'Enter a valid quantity (0 or more).';
    if (q > max) return `Only ${max} eligible to return.`;
    return '';
  };
  const hasQtyError = batches.some(b => qtyError(b.id, b.qtyRemaining));
  const selected = batches.filter(b => (qtys[b.id] ?? 0) > 0);
  const returnTotal = selected.reduce((sum, b) => sum + (qtys[b.id] ?? 0) * b.costPaisa, 0);
  // --- Tabs & filters (view-only; quantities/reason live above and survive tab switches) ---
  const [prTab, setPrTab] = useState<'new' | 'history'>('new');
  const [batchQuery, setBatchQuery] = useState('');
  const [expiryFilter, setExpiryFilter] = useState<'all' | 'expired' | 'near' | 'active'>('all');
  const warnTo = addDays(todayStr(), db.settings.expiryWarnDays);
  const expiryBucket = (b: (typeof batches)[number]): 'expired' | 'near' | 'active' =>
    engine.isExpired(b) ? 'expired' : b.expiryDate <= warnTo ? 'near' : 'active';
  const bucketCounts = {
    all: batches.length,
    expired: batches.filter(b => expiryBucket(b) === 'expired').length,
    near: batches.filter(b => expiryBucket(b) === 'near').length,
    active: batches.filter(b => expiryBucket(b) === 'active').length,
  };
  const visibleBatches = batches.filter(b => {
    if (expiryFilter !== 'all' && expiryBucket(b) !== expiryFilter) return false;
    const q = batchQuery.trim().toLowerCase();
    return !q || engine.medicine(b.medicineId).name.toLowerCase().includes(q) || b.batchNo.toLowerCase().includes(q);
  });
  const hiddenSelected = selected.filter(b => !visibleBatches.some(v => v.id === b.id)).length;
  // --- History filters ---
  const [histQuery, setHistQuery] = useState('');
  const [histSupplier, setHistSupplier] = useState('');
  const [histFrom, setHistFrom] = useState('');
  const [histTo, setHistTo] = useState('');
  const allReturns = [...db.purchaseReturns].reverse();
  const histRows = allReturns.filter(r => {
    if (histSupplier && r.supplierId !== Number(histSupplier)) return false;
    const d = localDateOf(r.dateTime);
    if (histFrom && d < histFrom) return false;
    if (histTo && d > histTo) return false;
    const q = histQuery.trim().toLowerCase();
    return !q || r.returnNo.toLowerCase().includes(q)
      || (db.suppliers.find(x => x.id === r.supplierId)?.name ?? '').toLowerCase().includes(q)
      || r.reason.toLowerCase().includes(q);
  });
  const histFiltersActive = !!(histQuery || histSupplier || histFrom || histTo);
  const clearHistFilters = () => { setHistQuery(''); setHistSupplier(''); setHistFrom(''); setHistTo(''); };
  const submit = () => {
    const ok = run(() => engine.createPurchaseReturn(user, {
      supplierId: Number(supplierId), purchaseId: null, reason,
      items: Object.entries(qtys).filter(([, q]) => q > 0).map(([batchId, qty]) => ({ batchId: Number(batchId), qty })),
    }), 'Purchase return recorded — supplier balance reduced.');
    if (ok) { setQtys({}); setReason(''); }
  };
  return (
    <Page title="Purchase Returns" sub="Send eligible stock back to the supplier. The original purchase is preserved; the supplier balance is reduced by batch cost.">
      <Tabs value={prTab} onChange={setPrTab} tabs={[
        { key: 'new', label: '📤 New Purchase Return' },
        { key: 'history', label: '🕘 Return History', count: allReturns.length },
      ]} />
      {prTab === 'new' && (
        <Card title="New purchase return">
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Supplier"><select className={inputCls} value={supplierId} onChange={e => { setSupplierId(e.target.value); setQtys({}); }}>
              {db.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Search medicine or batch"><input className={inputCls} placeholder="e.g. Panadol or PN-2401…" value={batchQuery} onChange={e => setBatchQuery(e.target.value)} /></Field>
            <Field label="Expiry status"><select className={inputCls} value={expiryFilter} onChange={e => setExpiryFilter(e.target.value as any)}>
              <option value="all">All ({bucketCounts.all})</option>
              <option value="expired">⛔ Expired ({bucketCounts.expired})</option>
              <option value="near">⏳ Near Expiry ({bucketCounts.near})</option>
              <option value="active">✅ Active ({bucketCounts.active})</option>
            </select></Field>
          </div>
          <div className="mt-3">
            {batches.length === 0 ? <Empty text="No batches with stock for this supplier." /> : visibleBatches.length === 0 ? (
              <div>
                <Empty text="No batches match the current search / expiry filter." />
                <div className="text-center"><Btn kind="ghost" onClick={() => { setBatchQuery(''); setExpiryFilter('all'); }}>Clear search & filter</Btn></div>
              </div>
            ) : (
              <>
              <p className="text-xs text-slate-400 mb-2">Showing {visibleBatches.length} of {batches.length} batches. Enter the quantity to return on each batch card (0 = not returned). Selected batches are highlighted.</p>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[560px] overflow-y-auto pr-0.5">
                {visibleBatches.map(b => { const err = qtyError(b.id, b.qtyRemaining); const q = qtys[b.id] ?? 0; const sel = q > 0; const med = engine.medicine(b.medicineId); return (
                  <div key={b.id} className={`border rounded-xl p-3 transition ${sel ? 'border-teal-500 ring-1 ring-teal-500 bg-teal-50/70 dark:bg-teal-900/20' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold leading-snug break-words">{medLabel(med)}</div>
                      {sel && <Badge color="green">selected</Badge>}
                    </div>
                    <div className="text-xs text-slate-400 break-words mt-0.5">Batch {b.batchNo}</div>
                    <div className="mt-2 space-y-0.5">
                      <DetailRow label="Expiry">{engine.isExpired(b) ? <Badge color="red">Expired {fmtDate(b.expiryDate)}</Badge> : <span>{fmtDate(b.expiryDate)} <span className="text-slate-400">· active</span></span>}</DetailRow>
                      <DetailRow label="Eligible qty">{b.qtyRemaining} {med.unit}</DetailRow>
                      <DetailRow label="Unit cost">{money(b.costPaisa)}</DetailRow>
                    </div>
                    <div className="flex items-end justify-between gap-2 mt-2 pt-2 border-t border-dashed border-slate-200 dark:border-slate-600">
                      <div>
                        <label className="block text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">Return qty</label>
                        <input type="number" min={0} max={b.qtyRemaining} step={1} inputMode="numeric" aria-label={`Return quantity for ${medLabel(med)} batch ${b.batchNo}`}
                          className={inputCls + ' !w-[104px] text-center' + (err ? ' !border-red-500' : '')}
                          value={qtys[b.id] ?? 0}
                          onFocus={e => e.target.select()}
                          onWheel={e => (e.target as HTMLInputElement).blur()}
                          onChange={e => { const v = e.target.value === '' ? 0 : parseInt(e.target.value, 10); setQtys(prev => ({ ...prev, [b.id]: Number.isNaN(v) ? -1 : v })); }}
                          onBlur={() => setQtys(prev => { const v = prev[b.id] ?? 0; return { ...prev, [b.id]: Math.max(0, Math.min(b.qtyRemaining, Number.isFinite(v) ? v : 0)) }; })} />
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Return value</div>
                        <div className="font-bold">{q > 0 ? money(q * b.costPaisa) : '—'}</div>
                      </div>
                    </div>
                    {err && <div className="text-[11px] text-red-500 mt-1.5 leading-tight">{err}</div>}
                  </div>); })}
              </div>
              <div className="flex flex-wrap justify-between gap-2 mt-2 text-sm">
                <span className="text-slate-500">{selected.length} batch(es) selected{hiddenSelected > 0 ? ` (${hiddenSelected} hidden by the current filter — still included)` : ''}</span>
                <span>Total return value: <b>{money(returnTotal)}</b> <span className="text-slate-400">(at batch cost)</span></span>
              </div>
              </>
            )}
          </div>
          <div className="mt-3"><Field label="Reason *"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Near-expiry return as per distributor policy" /></Field></div>
          {can(user.role, 'purchase.return') && <Btn className="w-full mt-4" disabled={hasQtyError || selected.length === 0} onClick={submit}>Record purchase return{selected.length > 0 ? ` (${money(returnTotal)})` : ''}</Btn>}
          {hasQtyError && <p className="text-xs text-red-500 mt-1.5">Fix the highlighted quantities before recording the return.</p>}
        </Card>
      )}

      {prTab === 'history' && (
        <div className="space-y-4">
          <Card title="Find a return">
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
              <Field label="Search (return ID, supplier or reason)"><input className={inputCls} placeholder="e.g. PR-000001, Medinova, damaged…" value={histQuery} onChange={e => setHistQuery(e.target.value)} /></Field>
              <Field label="Supplier"><select className={inputCls} value={histSupplier} onChange={e => setHistSupplier(e.target.value)}>
                <option value="">All Suppliers</option>
                {db.suppliers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select></Field>
              <Field label="From date"><input type="date" className={inputCls} value={histFrom} onChange={e => setHistFrom(e.target.value)} /></Field>
              <Field label="To date"><input type="date" className={inputCls} value={histTo} onChange={e => setHistTo(e.target.value)} /></Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
              <span className="text-sm text-slate-500">{histRows.length} of {allReturns.length} return(s){histFiltersActive ? ' match the current filters' : ''}</span>
              <Btn kind="ghost" disabled={!histFiltersActive} onClick={clearHistFilters}>✕ Clear Filters</Btn>
            </div>
          </Card>

          {allReturns.length === 0 ? <Card><Empty text="No purchase returns recorded yet." /></Card>
            : histRows.length === 0 ? (
              <Card>
                <Empty text="No purchase returns match the current search and filters." />
                <div className="text-center pb-2"><Btn kind="ghost" onClick={clearHistFilters}>✕ Clear Filters</Btn></div>
              </Card>
            ) : (
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {histRows.map(r => (
                  <div key={r.id} className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 bg-white dark:bg-slate-800 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-bold">{r.returnNo}</div>
                      <Btn kind="soft" onClick={() => setDetailId(r.id)}>View Details</Btn>
                    </div>
                    <div className="mt-1.5 flex-1">
                      <DetailRow label="Supplier">{db.suppliers.find(x => x.id === r.supplierId)?.name ?? '—'}</DetailRow>
                      <DetailRow label="Date">{fmtDateTime(r.dateTime)}</DetailRow>
                      <DetailRow label="Total value"><span className="font-bold">{money(r.totalPaisa)}</span></DetailRow>
                      <DetailRow label="Recorded by">{db.users.find(u => u.id === r.userId)?.fullName ?? '—'}</DetailRow>
                    </div>
                    <div className="mt-2 pt-2 border-t border-dashed border-slate-200 dark:border-slate-600 text-sm">
                      <span className="text-slate-400 text-xs uppercase tracking-wide font-semibold">Reason</span>
                      <div className="break-words mt-0.5">{r.reason}</div>
                    </div>
                  </div>))}
              </div>
            )}
        </div>
      )}
      {detailId !== null && (() => {
        const r = db.purchaseReturns.find(x => x.id === detailId)!;
        const items = db.purchaseReturnItems.filter(i => i.returnId === r.id);
        const posted = db.ledger.find(l => l.partyType === 'supplier' && l.partyId === r.supplierId && l.reference === r.returnNo);
        return (
          <Modal title={`Purchase return ${r.returnNo}`} onClose={() => setDetailId(null)} wide>
            <div className="text-sm space-y-1 mb-3">
              <div>Supplier: <b>{db.suppliers.find(s2 => s2.id === r.supplierId)?.name}</b> · {fmtDateTime(r.dateTime)} · Recorded by {db.users.find(u => u.id === r.userId)?.fullName}</div>
              <div>Reason: {r.reason}</div>
              <div className="rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 px-3 py-2">
                Supplier payable reduced by <b>{money(r.totalPaisa)}</b> — posted to the Supplier Ledger as a <b>debit</b> “purchase return” with reference <b>{r.returnNo}</b>{posted ? ` (ledger entry ${posted.id})` : ''}. Open <b>Supplier Ledger → {db.suppliers.find(s2 => s2.id === r.supplierId)?.name}</b> to see it; if we owed less than this amount, the extra appears as supplier credit.
              </div>
            </div>
            <Table head={['Medicine', 'Batch', 'Qty returned', 'Batch cost', 'Value']}>
              {items.map(i => { const b = db.batches.find(x => x.id === i.batchId); return <tr key={i.id}><td>{engine.medicine(i.medicineId).name}</td><td>{b?.batchNo ?? '—'}</td><td>{i.qty}</td><td>{money(b?.costPaisa ?? i.costPaisa)}</td><td className="font-semibold">{money(i.costPaisa * i.qty)}</td></tr>; })}
            </Table>
            <div className="text-right font-bold mt-2">Total: {money(r.totalPaisa)}</div>
          </Modal>);
      })()}
    </Page>
  );
}
