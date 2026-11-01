import { useMemo, useState } from 'react';
import { engine } from '../lib/store';
import { Page, Card, Btn, Modal, Field, inputCls, money, Table, Badge, Empty, run, fmtDate, fmtDateTime, ExportBtn, medLabel } from '../components/ui';
import { todayStr } from '../core/money';
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

export function SalesReturns({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [invQuery, setInvQuery] = useState('');
  const [saleId, setSaleId] = useState<number | null>(null);
  const [qtys, setQtys] = useState<Record<number, number>>({});
  const [disps, setDisps] = useState<Record<number, 'saleable' | 'quarantine' | 'damaged'>>({});
  const [method, setMethod] = useState<'cash' | 'credit' | 'card' | 'bank'>('cash'); const [reason, setReason] = useState('');
  const sale = db.sales.find(s => s.id === saleId);
  const items = sale ? db.saleItems.filter(i => i.saleId === sale.id) : [];
  const matches = useMemo(() => invQuery ? db.sales.filter(s => s.invoiceNo.toLowerCase().includes(invQuery.toLowerCase())).slice(0, 6) : [], [invQuery, db]);
  const submit = () => {
    if (!sale) return;
    const ok = run(() => engine.createSalesReturn(user, {
      saleId: sale.id, reason, method,
      items: items.map(i => ({ saleItemId: i.id, qty: qtys[i.id] ?? 0, disposition: disps[i.id] ?? 'quarantine' })),
    }), 'Sales return recorded.');
    if (ok) { setQtys({}); setReason(''); }
  };
  return (
    <Page title="Sales Returns" sub="Returns never delete the original sale. Opened/damaged/expired medicine goes to quarantine — never back on the saleable shelf automatically.">
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card title="1) Find the original invoice">
          <input className={inputCls} placeholder="Type invoice number, e.g. INV-000001" value={invQuery} onChange={e => setInvQuery(e.target.value)} />
          <div className="divide-y divide-slate-100 dark:divide-slate-700 mt-2">
            {matches.map(s => <button key={s.id} onClick={() => { setSaleId(s.id); setQtys({}); }} className="w-full flex justify-between py-2 text-left text-sm hover:bg-teal-50 dark:hover:bg-slate-700/40 rounded px-1">
              <span><b>{s.invoiceNo}</b> · {fmtDateTime(s.dateTime)}</span><span className="font-semibold">{money(s.totalPaisa)}</span></button>)}
          </div>
          {sale && (
            <div className="mt-3 space-y-2">
              {items.map(i => { const returned = engine.returnedQtyForSaleItem(i.id); const max = i.qty - returned; return (
                <div key={i.id} className="border border-slate-100 dark:border-slate-700 rounded-xl p-2.5 text-sm">
                  <div className="font-semibold">{i.medicineName} <span className="text-slate-400 font-normal">sold {i.qty}, returned {returned}, eligible {max}</span></div>
                  <div className="flex gap-2 mt-1.5">
                    <input type="number" min={0} max={max} className={inputCls + ' !w-24'} placeholder="Return qty" value={qtys[i.id] ?? ''} onChange={e => setQtys(q => ({ ...q, [i.id]: parseInt(e.target.value) || 0 }))} />
                    <select className={inputCls} value={disps[i.id] ?? 'quarantine'} onChange={e => setDisps(d => ({ ...d, [i.id]: e.target.value as any }))}>
                      <option value="saleable">Sealed & good → back to saleable stock</option>
                      <option value="quarantine">Questionable → quarantine</option>
                      <option value="damaged">Damaged/opened → damaged</option>
                    </select>
                  </div>
                </div>); })}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Refund method"><select className={inputCls} value={method} onChange={e => setMethod(e.target.value as any)}>
                  <option value="cash">Cash refund</option><option value="credit">Customer credit (reduce udhaar)</option><option value="card">Card reversal</option><option value="bank">Bank transfer</option></select></Field>
                <Field label="Reason *"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Wrong medicine dispensed" /></Field>
              </div>
              <Btn className="w-full" onClick={submit}>Record sales return</Btn>
            </div>
          )}
        </Card>
        <Card title="Return history">
          {db.salesReturns.length === 0 ? <Empty text="No sales returns yet." /> : (
            <Table head={['Return', 'Invoice', 'When', 'Refund', 'Method', 'Reason']}>
              {[...db.salesReturns].reverse().map(r => <tr key={r.id}><td>{r.returnNo}</td><td>{db.sales.find(s => s.id === r.saleId)?.invoiceNo}</td><td>{fmtDateTime(r.dateTime)}</td><td className="font-semibold">{money(r.refundPaisa)}</td><td>{r.method}</td><td>{r.reason}</td></tr>)}
            </Table>
          )}
        </Card>
      </div>
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
  const submit = () => {
    const ok = run(() => engine.createPurchaseReturn(user, {
      supplierId: Number(supplierId), purchaseId: null, reason,
      items: Object.entries(qtys).filter(([, q]) => q > 0).map(([batchId, qty]) => ({ batchId: Number(batchId), qty })),
    }), 'Purchase return recorded — supplier balance reduced.');
    if (ok) { setQtys({}); setReason(''); }
  };
  return (
    <Page title="Purchase Returns" sub="Send eligible stock back to the supplier. The original purchase is preserved; the supplier balance is reduced by batch cost.">
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card title="New purchase return">
          <Field label="Supplier"><select className={inputCls} value={supplierId} onChange={e => { setSupplierId(e.target.value); setQtys({}); }}>
            {db.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <div className="mt-3">
            {batches.length === 0 ? <Empty text="No batches with stock for this supplier." /> : (
              <>
              <p className="text-xs text-slate-400 mb-2">Tip: the medicine column (left) and Return qty column (right) stay visible while you scroll sideways.</p>
              {/* Dedicated sticky-column table: medicine name frozen left, Return Qty frozen
                  right, middle columns scroll. Scrolling is contained in this box so the
                  page itself never scrolls horizontally. */}
              <div className="overflow-auto max-h-[520px] border border-slate-200 dark:border-slate-700 rounded-xl">
                <table className="w-full min-w-[660px] text-sm border-separate border-spacing-0">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="sticky top-0 left-0 z-30 bg-slate-50 dark:bg-slate-800 py-2 px-3 font-semibold border-b border-r border-slate-200 dark:border-slate-700 w-[240px] min-w-[240px] max-w-[240px]">Medicine · batch</th>
                      <th className="sticky top-0 z-20 bg-slate-50 dark:bg-slate-800 py-2 px-3 font-semibold border-b border-slate-200 dark:border-slate-700 whitespace-nowrap">Expiry</th>
                      <th className="sticky top-0 z-20 bg-slate-50 dark:bg-slate-800 py-2 px-3 font-semibold border-b border-slate-200 dark:border-slate-700 whitespace-nowrap">Eligible qty</th>
                      <th className="sticky top-0 z-20 bg-slate-50 dark:bg-slate-800 py-2 px-3 font-semibold border-b border-slate-200 dark:border-slate-700 whitespace-nowrap">Unit cost</th>
                      <th className="sticky top-0 z-20 bg-slate-50 dark:bg-slate-800 py-2 px-3 font-semibold border-b border-slate-200 dark:border-slate-700 whitespace-nowrap">Return value</th>
                      <th className="sticky top-0 right-0 z-30 bg-slate-50 dark:bg-slate-800 py-2 px-3 font-semibold border-b border-l border-slate-200 dark:border-slate-700 shadow-[-10px_0_10px_-10px_rgba(0,0,0,0.35)] w-[150px] min-w-[150px]">Return qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map(b => { const err = qtyError(b.id, b.qtyRemaining); const q = qtys[b.id] ?? 0; return (
                      <tr key={b.id} className="group">
                        <td className="sticky left-0 z-10 bg-white dark:bg-slate-800 group-hover:bg-slate-50 dark:group-hover:bg-slate-700/40 py-2 px-3 align-top border-b border-r border-slate-100 dark:border-slate-700 w-[240px] min-w-[240px] max-w-[240px]">
                          <div className="font-semibold leading-snug truncate" title={medLabel(engine.medicine(b.medicineId))}>{medLabel(engine.medicine(b.medicineId))}</div>
                          <div className="text-xs text-slate-400 truncate" title={`Batch ${b.batchNo}`}>Batch {b.batchNo}{engine.isExpired(b) && <> · <Badge color="red">expired</Badge></>}</div>
                        </td>
                        <td className="py-2 px-3 align-top border-b border-slate-100 dark:border-slate-700 whitespace-nowrap">{fmtDate(b.expiryDate)}</td>
                        <td className="py-2 px-3 align-top border-b border-slate-100 dark:border-slate-700">{b.qtyRemaining}</td>
                        <td className="py-2 px-3 align-top border-b border-slate-100 dark:border-slate-700 whitespace-nowrap">{money(b.costPaisa)}</td>
                        <td className="py-2 px-3 align-top border-b border-slate-100 dark:border-slate-700 whitespace-nowrap font-semibold">{q > 0 ? money(q * b.costPaisa) : '—'}</td>
                        <td className="sticky right-0 z-10 bg-white dark:bg-slate-800 group-hover:bg-slate-50 dark:group-hover:bg-slate-700/40 py-2 px-3 align-top border-b border-l border-slate-200 dark:border-slate-700 shadow-[-10px_0_10px_-10px_rgba(0,0,0,0.35)] w-[150px] min-w-[150px]">
                          <input type="number" min={0} max={b.qtyRemaining} step={1} inputMode="numeric" aria-label={`Return quantity for ${medLabel(engine.medicine(b.medicineId))} batch ${b.batchNo}`}
                            className={inputCls + ' !w-[110px] text-center' + (err ? ' !border-red-500' : '')}
                            value={qtys[b.id] ?? 0}
                            onFocus={e => e.target.select()}
                            onWheel={e => (e.target as HTMLInputElement).blur()}
                            onChange={e => { const v = e.target.value === '' ? 0 : parseInt(e.target.value, 10); setQtys(prev => ({ ...prev, [b.id]: Number.isNaN(v) ? -1 : v })); }}
                            onBlur={() => setQtys(prev => { const v = prev[b.id] ?? 0; return { ...prev, [b.id]: Math.max(0, Math.min(b.qtyRemaining, Number.isFinite(v) ? v : 0)) }; })} />
                          {err && <div className="text-[11px] text-red-500 mt-1 leading-tight">{err}</div>}
                        </td>
                      </tr>); })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap justify-between gap-2 mt-2 text-sm">
                <span className="text-slate-500">{selected.length} batch(es) selected</span>
                <span>Total return value: <b>{money(returnTotal)}</b> <span className="text-slate-400">(at batch cost)</span></span>
              </div>
              </>
            )}
          </div>
          <div className="mt-3"><Field label="Reason *"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Near-expiry return as per distributor policy" /></Field></div>
          {can(user.role, 'purchase.return') && <Btn className="w-full mt-4" disabled={hasQtyError || selected.length === 0} onClick={submit}>Record purchase return{selected.length > 0 ? ` (${money(returnTotal)})` : ''}</Btn>}
          {hasQtyError && <p className="text-xs text-red-500 mt-1.5">Fix the highlighted quantities before recording the return.</p>}
        </Card>
        <Card title="Return history">
          {db.purchaseReturns.length === 0 ? <Empty text="No purchase returns yet." /> : (
            <Table head={['Return', 'Supplier', 'When', 'Value', 'Reason', '']}>
              {[...db.purchaseReturns].reverse().map(r => <tr key={r.id}><td className="font-semibold">{r.returnNo}</td><td>{db.suppliers.find(s => s.id === r.supplierId)?.name}</td><td>{fmtDateTime(r.dateTime)}</td><td className="font-semibold">{money(r.totalPaisa)}</td><td>{r.reason}</td>
                <td><Btn kind="soft" onClick={() => setDetailId(r.id)}>View</Btn></td></tr>)}
            </Table>
          )}
        </Card>
      </div>
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
