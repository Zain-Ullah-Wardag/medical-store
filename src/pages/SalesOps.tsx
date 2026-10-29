import { useMemo, useState } from 'react';
import { engine } from '../lib/store';
import { Page, Card, Btn, Modal, Field, inputCls, money, Table, Badge, Empty, run, fmtDate, fmtDateTime, downloadFile, toCSV } from '../components/ui';
import { todayStr } from '../core/money';
import type { Sale, SessionUser } from '../core/types';
import { can } from '../core/types';
import { Receipt } from '../components/Receipt';

export function SalesHistory({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [from, setFrom] = useState(todayStr()); const [to, setTo] = useState(todayStr());
  const [q, setQ] = useState(''); const [cashierId, setCashierId] = useState(''); const [methodF, setMethodF] = useState('');
  const [detail, setDetail] = useState<Sale | null>(null); const [printSale, setPrintSale] = useState<Sale | null>(null);
  const rows = db.sales.filter(s => {
    const d = s.dateTime.slice(0, 10);
    if (d < from || d > to) return false;
    if (user.role === 'cashier' && s.userId !== user.id) return false;
    if (q && !s.invoiceNo.toLowerCase().includes(q.toLowerCase()) && !(db.customers.find(c => c.id === s.customerId)?.name ?? '').toLowerCase().includes(q.toLowerCase())) return false;
    if (cashierId && String(s.userId) !== cashierId) return false;
    if (methodF && !db.salePayments.some(p => p.saleId === s.id && p.method === methodF)) return false;
    return true;
  }).sort((a, b) => b.id - a.id);
  return (
    <Page title="Sales History" sub="Completed invoices are never deleted — corrections go through Sales Returns."
      actions={<Btn kind="ghost" onClick={() => downloadFile('sales-history.csv', toCSV(rows.map(s => ({ Invoice: s.invoiceNo, Date: s.dateTime, TotalPKR: s.totalPaisa / 100, PaidPKR: s.paidPaisa / 100 }))), 'text/csv')}>Export CSV</Btn>}>
      <Card>
        <div className="grid md:grid-cols-5 gap-2 mb-3">
          <input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} />
          <input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} />
          <input className={inputCls} placeholder="Invoice no. or customer…" value={q} onChange={e => setQ(e.target.value)} />
          <select className={inputCls} value={cashierId} onChange={e => setCashierId(e.target.value)}><option value="">All cashiers</option>{db.users.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select>
          <select className={inputCls} value={methodF} onChange={e => setMethodF(e.target.value)}><option value="">All payment methods</option>{db.settings.paymentMethods.map(m => <option key={m}>{m}</option>)}</select>
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
  const [supplierId, setSupplierId] = useState(String(db.suppliers[0]?.id ?? ''));
  const [qtys, setQtys] = useState<Record<number, number>>({}); const [reason, setReason] = useState('');
  const batches = db.batches.filter(b => b.supplierId === Number(supplierId) && b.qtyRemaining > 0);
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
              <Table head={['Medicine · batch', 'Expiry', 'On hand', 'Return qty']}>
                {batches.map(b => <tr key={b.id}><td>{engine.medicine(b.medicineId).name} · {b.batchNo}{engine.isExpired(b) && <Badge color="red"> expired</Badge>}</td><td>{fmtDate(b.expiryDate)}</td><td>{b.qtyRemaining}</td>
                  <td><input type="number" min={0} max={b.qtyRemaining} className={inputCls + ' !w-24'} value={qtys[b.id] ?? ''} onChange={e => setQtys(q => ({ ...q, [b.id]: parseInt(e.target.value) || 0 }))} /></td></tr>)}
              </Table>
            )}
          </div>
          <div className="mt-3"><Field label="Reason *"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Near-expiry return as per distributor policy" /></Field></div>
          {can(user.role, 'purchase.return') && <Btn className="w-full mt-4" onClick={submit}>Record purchase return</Btn>}
        </Card>
        <Card title="Return history">
          {db.purchaseReturns.length === 0 ? <Empty text="No purchase returns yet." /> : (
            <Table head={['Return', 'Supplier', 'When', 'Value', 'Reason']}>
              {[...db.purchaseReturns].reverse().map(r => <tr key={r.id}><td>{r.returnNo}</td><td>{db.suppliers.find(s => s.id === r.supplierId)?.name}</td><td>{fmtDateTime(r.dateTime)}</td><td className="font-semibold">{money(r.totalPaisa)}</td><td>{r.reason}</td></tr>)}
            </Table>
          )}
        </Card>
      </div>
    </Page>
  );
}
