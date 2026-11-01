import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { engine } from '../lib/store';
import { Page, Card, Btn, inputCls, money, Table, Empty, fmtDate, Stat, ExportBtn, Badge, medLabel } from '../components/ui';
import { todayStr, addDays, localDateOf } from '../core/money';
import type { SessionUser } from '../core/types';

const COLORS = ['#0d9488', '#0284c7', '#d97706', '#dc2626', '#7c3aed', '#65a30d', '#db2777', '#475569'];
type Rep = 'summary' | 'byMedicine' | 'byCategory' | 'byCashier' | 'byPayment' | 'inventory' | 'expiry' | 'outstanding' | 'movements' | 'returns' | 'slow';

export function Reports({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [rep, setRep] = useState<Rep>('summary');
  const [from, setFrom] = useState(todayStr().slice(0, 8) + '01');
  const [to, setTo] = useState(todayStr());
  const stats = useMemo(() => engine.rangeStats(from, to), [from, to, db]);
  const inRange = (iso: string) => { const d = localDateOf(iso); return d >= from && d <= to; };
  const saleIds = new Set(db.sales.filter(s => inRange(s.dateTime)).map(s => s.id));
  const items = db.saleItems.filter(i => saleIds.has(i.saleId));
  // Shared engine calculation: nets returns recorded in the period, so COGS
  // totals here ALWAYS reconcile with the profit summary above.
  const byMedicine = useMemo(() => engine.salesGrouped(from, to, 'medicine').map(r => ({ name: r.name, qty: r.qty, revenue: r.revenuePaisa, cogs: r.cogsPaisa })), [db, from, to]);
  const byCategory = useMemo(() => engine.salesGrouped(from, to, 'category').map(r => ({ name: r.name, qty: r.qty, revenue: r.revenuePaisa, cogs: r.cogsPaisa })), [db, from, to]);
  const byCashier = useMemo(() => {
    const map = new Map<string, { name: string; invoices: number; revenue: number }>();
    for (const s of db.sales.filter(s => inRange(s.dateTime))) {
      const name = db.users.find(u => u.id === s.userId)?.fullName ?? 'Unknown';
      const cur = map.get(name) ?? { name, invoices: 0, revenue: 0 }; cur.invoices++; cur.revenue += s.totalPaisa; map.set(name, cur);
    }
    return [...map.values()];
  }, [db, from, to]);
  const byPayment = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of db.salePayments.filter(p => saleIds.has(p.saleId))) map.set(p.method, (map.get(p.method) ?? 0) + p.amountPaisa);
    return [...map.entries()].map(([name, v]) => ({ name, value: v / 100 }));
  }, [db, from, to]);

  const slowRows = useMemo(() => db.medicines.filter(m => m.active).map(m => ({
    m, stock: engine.saleableStock(m.id),
    sold: items.filter(i => i.medicineId === m.id).reduce((x, i) => x + i.qty, 0),
    value: db.batches.filter(b => b.medicineId === m.id && b.status === 'active' && !engine.isExpired(b)).reduce((x, b) => x + b.qtyRemaining * b.costPaisa, 0),
  })).filter(r => r.stock > 0).sort((a, b) => a.sold - b.sold).slice(0, 25), [db, from, to]);
  const exportHeader = `${db.settings.storeName} — report — ${from} to ${to} — generated ${new Date().toLocaleString('en-PK')} (money columns in PKR)`;
  const reportTitles: Record<Rep, string> = { summary: 'Profit summary', byMedicine: 'Sales by medicine', byCategory: 'Sales by category', byCashier: 'Sales by cashier', byPayment: 'Receipts by payment method', inventory: 'Inventory valuation', expiry: 'Expiry report', outstanding: 'Outstanding balances', movements: 'Stock movements', returns: 'Returns', slow: 'Slow-moving medicines' };

  const tabs: [Rep, string][] = [['summary', '📊 Profit summary'], ['byMedicine', '💊 By medicine'], ['byCategory', '🗂 By category'], ['byCashier', '👤 By cashier'], ['byPayment', '💳 By payment'], ['inventory', '📦 Inventory valuation'], ['expiry', '⏳ Expiry'], ['outstanding', '🧾 Outstanding'], ['returns', '↩ Returns'], ['movements', '🔁 Stock movements'], ['slow', '🐢 Slow-moving']];

  return (
    <Page title="Reports & Analytics" sub={`All figures come from real transactions for ${fmtDate(from)} → ${fmtDate(to)}. Export CSV (opens in Excel) or print to PDF.`}
      actions={<div className="flex gap-2 items-center">
        {[['Today', todayStr(), todayStr()], ['7 days', addDays(todayStr(), -6), todayStr()], ['30 days', addDays(todayStr(), -29), todayStr()], ['This month', todayStr().slice(0, 8) + '01', todayStr()]].map(([l, f, t]) => (
          <Btn key={l} kind="soft" onClick={() => { setFrom(f); setTo(t); }}>{l}</Btn>))}
        <input type="date" className={inputCls + ' !w-auto'} value={from} onChange={e => setFrom(e.target.value)} />
        <input type="date" className={inputCls + ' !w-auto'} value={to} onChange={e => setTo(e.target.value)} />
        <Btn kind="ghost" onClick={() => window.print()}>🖨 Print / PDF</Btn>
      </div>}>
      <div className="hidden print:block mb-4">
        <h1 className="text-xl font-bold">{db.settings.storeName}</h1>
        <p className="text-sm">{reportTitles[rep]} — {fmtDate(from)} to {fmtDate(to)}</p>
        <p className="text-xs text-slate-500">Generated {new Date().toLocaleString('en-PK')} by {user.fullName}. All amounts in PKR.</p>
      </div>
      <div className="flex gap-2 flex-wrap mb-4 no-print">
        {tabs.map(([k, label]) => <button key={k} onClick={() => setRep(k)} className={`px-3 py-1.5 rounded-full text-sm font-semibold ${rep === k ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600'}`}>{label}</button>)}
      </div>

      {rep === 'summary' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Net sales revenue" value={money(stats.netRevenue)} hint={`Gross ${money(stats.grossRevenue)} − returns ${money(stats.returnsValue)}`} />
            <Stat label="Cost of goods sold" value={money(stats.cogs)} hint="Batch cost of units sold, minus cost of sealed/saleable returns. Damaged returns stay a cost." tone="blue" />
            <Stat label="Gross profit" value={money(stats.grossProfit)} hint="Net revenue − COGS" />
            <Stat label="Expenses" value={money(stats.expenses)} tone="amber" />
            <Stat label="Net operating profit (est.)" value={money(stats.netOperatingProfit)} hint="Before tax & owner drawings" />
            <Stat label="Purchases (stock bought)" value={money(stats.purchases)} hint="Not subtracted from sales — see docs" tone="slate" />
            <Stat label="Invoices" value={String(stats.invoiceCount)} tone="blue" />
            <Stat label="Inventory value (today)" value={money(engine.inventoryValuation())} tone="slate" />
          </div>
          <Card title="Daily sales in period (PKR)">
            <div className="h-60"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={engine.salesTrend(30).filter(d => d.date >= from && d.date <= to).map(d => ({ date: d.date.slice(5), Sales: d.salesPaisa / 100 }))}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="date" fontSize={11} /><YAxis fontSize={11} /><Tooltip /><Bar dataKey="Sales" fill="#0d9488" radius={[4, 4, 0, 0]} />
              </BarChart></ResponsiveContainer></div>
            <div className="flex gap-2 items-center mt-2">
              <ExportBtn filename={`profit-summary-${from}-to-${to}.csv`} headerLine={exportHeader} rows={[{ Store: db.settings.storeName, PeriodFrom: from, PeriodTo: to, GrossRevenuePKR: stats.grossRevenue / 100, ReturnsPKR: stats.returnsValue / 100, NetRevenuePKR: stats.netRevenue / 100, COGSPKR: stats.cogs / 100, GrossProfitPKR: stats.grossProfit / 100, ExpensesPKR: stats.expenses / 100, NetOperatingProfitPKR: stats.netOperatingProfit / 100, PurchasesPKR: stats.purchases / 100, Invoices: stats.invoiceCount }]} />
              <span className="text-xs text-slate-400">Returns are counted by return date; both sealed and damaged returns reduce net sales.</span>
            </div>
          </Card>
        </>
      )}

      {(rep === 'byMedicine' || rep === 'byCategory') && (
        <Card title={rep === 'byMedicine' ? 'Sales by medicine' : 'Sales by category'}>
          {(rep === 'byMedicine' ? byMedicine : byCategory).length === 0 ? <Empty text="No sales in this period." /> : (
            <Table head={['Name', 'Qty sold (net)', 'Revenue (net)', 'COGS (batch cost)', 'Gross profit']}>
              {(rep === 'byMedicine' ? byMedicine : byCategory).map(r => <tr key={r.name}><td className="font-semibold">{r.name}</td><td>{r.qty}</td><td>{money(r.revenue)}</td><td>{money(r.cogs)}</td><td className="font-semibold text-teal-600">{money(r.revenue - r.cogs)}</td></tr>)}
              <tr className="font-bold border-t-2 border-slate-300"><td>Total</td><td>{(rep === 'byMedicine' ? byMedicine : byCategory).reduce((a, r) => a + r.qty, 0)}</td><td>{money((rep === 'byMedicine' ? byMedicine : byCategory).reduce((a, r) => a + r.revenue, 0))}</td><td>{money((rep === 'byMedicine' ? byMedicine : byCategory).reduce((a, r) => a + r.cogs, 0))}</td><td>{money((rep === 'byMedicine' ? byMedicine : byCategory).reduce((a, r) => a + r.revenue - r.cogs, 0))}</td></tr>
            </Table>
          )}
          <div className="mt-3 flex gap-2 items-center"><ExportBtn filename={`${rep}-${from}-to-${to}.csv`} headerLine={exportHeader} rows={(rep === 'byMedicine' ? byMedicine : byCategory).map(r => ({ Name: r.name, QtySoldNet: r.qty, RevenuePKR: r.revenue / 100, COGSPKR: r.cogs / 100, GrossProfitPKR: (r.revenue - r.cogs) / 100 }))} />
          <span className="text-xs text-slate-400">Returns in the period are netted. COGS total matches the profit summary.</span></div>
        </Card>
      )}

      {rep === 'byCashier' && <Card title="Sales by cashier">{byCashier.length === 0 ? <Empty text="No sales in this period." /> : (
        <Table head={['Cashier', 'Invoices', 'Revenue']}>{byCashier.map(r => <tr key={r.name}><td className="font-semibold">{r.name}</td><td>{r.invoices}</td><td>{money(r.revenue)}</td></tr>)}</Table>)}
        <div className="mt-3"><ExportBtn filename="by-cashier-report.csv" headerLine={exportHeader} rows={byCashier.map(r => ({ Cashier: r.name, Invoices: r.invoices, RevenuePKR: r.revenue / 100 }))} /></div></Card>}

      {rep === 'byPayment' && <Card title="Receipts by payment method (at time of sale)">{byPayment.length === 0 ? <Empty text="No payments in this period." /> : (
        <div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart>
          <Pie data={byPayment} dataKey="value" nameKey="name" label={({ name, value }: any) => `${name}: ${money((value ?? 0) * 100)}`}>
            {byPayment.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie><Tooltip /></PieChart></ResponsiveContainer></div>)}
        <div className="mt-3"><ExportBtn filename="by-payment-report.csv" headerLine={exportHeader} rows={byPayment.map(r => ({ PaymentMethod: r.name, AmountPKR: r.value }))} /></div></Card>}

      {rep === 'inventory' && <Card title="Batch-wise inventory valuation (saleable, at cost)">
        <Table head={['Medicine', 'Batch', 'Expiry', 'Qty', 'Cost', 'Value']}>
          {db.batches.filter(b => b.status === 'active' && !engine.isExpired(b) && b.qtyRemaining > 0).map(b => <tr key={b.id}><td>{engine.medicine(b.medicineId).name}</td><td>{b.batchNo}</td><td>{fmtDate(b.expiryDate)}</td><td>{b.qtyRemaining}</td><td>{money(b.costPaisa)}</td><td className="font-semibold">{money(b.qtyRemaining * b.costPaisa)}</td></tr>)}
        </Table>
        <div className="flex items-center justify-between mt-2">
          <ExportBtn filename="inventory-valuation-report.csv" headerLine={exportHeader} rows={[...db.batches.filter(b => b.status === 'active' && !engine.isExpired(b) && b.qtyRemaining > 0).map(b => ({ Medicine: engine.medicine(b.medicineId).name, Batch: b.batchNo, Expiry: b.expiryDate, Qty: b.qtyRemaining, CostPKR: b.costPaisa / 100, ValuePKR: (b.qtyRemaining * b.costPaisa) / 100 })), { Medicine: 'TOTAL', Batch: '', Expiry: '', Qty: '', CostPKR: '', ValuePKR: engine.inventoryValuation() / 100 }]} />
          <div className="font-bold">Total valuation: {money(engine.inventoryValuation())}</div>
        </div>
      </Card>}

      {rep === 'expiry' && (<>
        <div className="mb-3"><ExportBtn filename="expiry-report.csv" headerLine={exportHeader} rows={[
          ...engine.alerts().expired.map(b => ({ Status: 'Expired', Medicine: engine.medicine(b.medicineId).name, Batch: b.batchNo, Expiry: b.expiryDate, Qty: b.qtyRemaining, ValueAtCostPKR: (b.qtyRemaining * b.costPaisa) / 100 })),
          ...engine.alerts().nearExpiry.map(b => ({ Status: 'Near-expiry', Medicine: engine.medicine(b.medicineId).name, Batch: b.batchNo, Expiry: b.expiryDate, Qty: b.qtyRemaining, ValueAtCostPKR: (b.qtyRemaining * b.costPaisa) / 100 })),
        ]} /></div>
        <div className="grid md:grid-cols-2 gap-4">
          {([['Expired batches (never saleable)', engine.alerts().expired], ['Near-expiry batches', engine.alerts().nearExpiry]] as const).map(([title, list]) => (
            <Card key={title} title={title}>{list.length === 0 ? <Empty text="None." /> : (
              <Table head={['Medicine', 'Batch', 'Expiry', 'Qty', 'Value at cost']}>
                {list.map(b => <tr key={b.id}><td>{engine.medicine(b.medicineId).name}</td><td>{b.batchNo}</td><td><Badge color={title.startsWith('Expired') ? 'red' : 'amber'}>{fmtDate(b.expiryDate)}</Badge></td><td>{b.qtyRemaining}</td><td>{money(b.qtyRemaining * b.costPaisa)}</td></tr>)}
              </Table>)}</Card>
          ))}
        </div>
      </>)}

      {rep === 'outstanding' && (<>
        <div className="mb-3"><ExportBtn filename="outstanding-report.csv" headerLine={exportHeader} rows={[
          ...db.customers.filter(c => engine.customerBalance(c.id) > 0).map(c => ({ PartyType: 'Customer (owes us)', Name: c.name, Phone: c.phone, BalancePKR: engine.customerBalance(c.id) / 100 })),
          ...db.suppliers.filter(x => engine.supplierBalance(x.id) > 0).map(x => ({ PartyType: 'Supplier (we owe)', Name: x.name, Phone: x.phone, BalancePKR: engine.supplierBalance(x.id) / 100 })),
        ]} /></div>
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="Customers who owe us"><Table head={['Customer', 'Phone', 'Balance']}>
            {db.customers.filter(c => engine.customerBalance(c.id) > 0).map(c => <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td><td className="font-semibold">{money(engine.customerBalance(c.id))}</td></tr>)}
          </Table></Card>
          <Card title="Suppliers we owe"><Table head={['Supplier', 'Phone', 'Balance']}>
            {db.suppliers.filter(s => engine.supplierBalance(s.id) > 0).map(s => <tr key={s.id}><td>{s.name}</td><td>{s.phone}</td><td className="font-semibold">{money(engine.supplierBalance(s.id))}</td></tr>)}
          </Table></Card>
        </div>
      </>)}

      {rep === 'returns' && (<>
        <div className="mb-3"><ExportBtn filename="returns-report.csv" headerLine={exportHeader} rows={[
          ...db.salesReturns.filter(r => inRange(r.dateTime)).map(r => ({ Type: 'Sales return', ReturnNo: r.returnNo, Date: r.dateTime, Reference: db.sales.find(x => x.id === r.saleId)?.invoiceNo ?? '', AmountPKR: r.refundPaisa / 100, MethodOrReason: `${r.method} — ${r.reason}` })),
          ...db.purchaseReturns.filter(r => inRange(r.dateTime)).map(r => ({ Type: 'Purchase return', ReturnNo: r.returnNo, Date: r.dateTime, Reference: db.suppliers.find(x => x.id === r.supplierId)?.name ?? '', AmountPKR: r.totalPaisa / 100, MethodOrReason: r.reason })),
        ]} /></div>
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="Sales returns in period"><Table head={['Return', 'Invoice', 'Refund', 'Method']}>
            {db.salesReturns.filter(r => inRange(r.dateTime)).map(r => <tr key={r.id}><td>{r.returnNo}</td><td>{db.sales.find(s => s.id === r.saleId)?.invoiceNo}</td><td>{money(r.refundPaisa)}</td><td>{r.method}</td></tr>)}
          </Table></Card>
          <Card title="Purchase returns in period"><Table head={['Return', 'Supplier', 'Value', 'Reason']}>
            {db.purchaseReturns.filter(r => inRange(r.dateTime)).map(r => <tr key={r.id}><td>{r.returnNo}</td><td>{db.suppliers.find(s => s.id === r.supplierId)?.name}</td><td>{money(r.totalPaisa)}</td><td>{r.reason}</td></tr>)}
          </Table></Card>
        </div>
      </>)}

      {rep === 'movements' && <Card title="Inventory movement report">
        <Table head={['When', 'Medicine', 'Type', 'Qty', 'Reference', 'By', 'Reason']}>
          {[...db.movements].filter(m => inRange(m.dateTime)).reverse().slice(0, 200).map(m => <tr key={m.id}><td>{new Date(m.dateTime).toLocaleString('en-PK', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td>{engine.medicine(m.medicineId).name}</td><td>{m.type.replace(/_/g, ' ')}</td><td className={m.qty < 0 ? 'text-red-500' : 'text-teal-600'}>{m.qty > 0 ? '+' : ''}{m.qty}</td><td>{m.reference}</td><td>{db.users.find(u => u.id === m.userId)?.username}</td><td>{m.reason}</td></tr>)}
        </Table>
        <div className="mt-3"><ExportBtn filename={`inventory-movements-${from}-to-${to}.csv`} headerLine={exportHeader} rows={db.movements.filter(m => inRange(m.dateTime)).map(m => ({ When: m.dateTime, Medicine: engine.medicine(m.medicineId).name, Type: m.type, Qty: m.qty, Reference: m.reference, Reason: m.reason }))} /></div>
      </Card>}

      {rep === 'slow' && <Card title="Slow-moving medicines (in stock, few/no sales in period)">
        <Table head={['Medicine', 'Saleable stock', 'Qty sold in period', 'Saleable stock value (excl. expired)']}>
          {slowRows.map(r => <tr key={r.m.id}><td>{medLabel(r.m)}</td><td>{r.stock}</td><td>{r.sold}</td><td>{money(r.value)}</td></tr>)}
        </Table>
        <div className="mt-3"><ExportBtn filename="slow-moving-report.csv" headerLine={exportHeader} rows={slowRows.map(r => ({ Medicine: medLabel(r.m), SaleableStock: r.stock, QtySoldInPeriod: r.sold, SaleableStockValuePKR: r.value / 100 }))} /></div></Card>}
      <p className="text-xs text-slate-400 mt-3">Profit formulas and assumptions: see docs/FINANCIAL_RULES.md. Net operating profit excludes income tax, owner drawings and loan interest unless recorded as expenses.</p>
    </Page>
  );
}
