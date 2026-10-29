import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { engine } from '../lib/store';
import { Page, Card, Btn, inputCls, money, Table, Empty, fmtDate, Stat, downloadFile, toCSV, Badge } from '../components/ui';
import { todayStr, addDays } from '../core/money';
import type { SessionUser } from '../core/types';

const COLORS = ['#0d9488', '#0284c7', '#d97706', '#dc2626', '#7c3aed', '#65a30d', '#db2777', '#475569'];
type Rep = 'summary' | 'byMedicine' | 'byCategory' | 'byCashier' | 'byPayment' | 'inventory' | 'expiry' | 'outstanding' | 'movements' | 'returns' | 'slow';

export function Reports({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [rep, setRep] = useState<Rep>('summary');
  const [from, setFrom] = useState(todayStr().slice(0, 8) + '01');
  const [to, setTo] = useState(todayStr());
  const stats = useMemo(() => engine.rangeStats(from, to), [from, to, db]);
  const inRange = (iso: string) => { const d = iso.slice(0, 10); return d >= from && d <= to; };
  const saleIds = new Set(db.sales.filter(s => inRange(s.dateTime)).map(s => s.id));
  const items = db.saleItems.filter(i => saleIds.has(i.saleId));

  const group = (keyFn: (i: any) => string) => {
    const map = new Map<string, { name: string; qty: number; revenue: number; cogs: number }>();
    for (const i of items) {
      const k = keyFn(i); const cur = map.get(k) ?? { name: k, qty: 0, revenue: 0, cogs: 0 };
      cur.qty += i.qty; cur.revenue += i.lineTotalPaisa; cur.cogs += i.allocations.reduce((a: number, al: any) => a + al.qty * al.costPaisa, 0); map.set(k, cur);
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  };

  const byMedicine = useMemo(() => group(i => i.medicineName), [db, from, to]);
  const byCategory = useMemo(() => group(i => db.categories.find(c => c.id === engine.medicine(i.medicineId).categoryId)?.name ?? 'Uncategorized'), [db, from, to]);
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

  const exportRows = (name: string, rows: Record<string, string | number>[]) =>
    downloadFile(`${name}-${from}-to-${to}.csv`, `MedStore Manager — ${name} — ${from} to ${to} — generated ${new Date().toLocaleString('en-PK')}\n` + toCSV(rows), 'text/csv');

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
      <div className="flex gap-2 flex-wrap mb-4">
        {tabs.map(([k, label]) => <button key={k} onClick={() => setRep(k)} className={`px-3 py-1.5 rounded-full text-sm font-semibold ${rep === k ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600'}`}>{label}</button>)}
      </div>

      {rep === 'summary' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Net sales revenue" value={money(stats.netRevenue)} hint={`Gross ${money(stats.grossRevenue)} − returns ${money(stats.returnsValue)}`} />
            <Stat label="Cost of goods sold" value={money(stats.cogs)} hint="Batch cost of units actually sold" tone="blue" />
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
            <Btn kind="ghost" onClick={() => exportRows('profit-summary', [{ Period: `${from} to ${to}`, NetRevenuePKR: stats.netRevenue / 100, COGSPKR: stats.cogs / 100, GrossProfitPKR: stats.grossProfit / 100, ExpensesPKR: stats.expenses / 100, NetOperatingProfitPKR: stats.netOperatingProfit / 100, PurchasesPKR: stats.purchases / 100, Invoices: stats.invoiceCount }])}>Export CSV</Btn>
          </Card>
        </>
      )}

      {(rep === 'byMedicine' || rep === 'byCategory') && (
        <Card title={rep === 'byMedicine' ? 'Sales by medicine' : 'Sales by category'}>
          {(rep === 'byMedicine' ? byMedicine : byCategory).length === 0 ? <Empty text="No sales in this period." /> : (
            <Table head={['Name', 'Qty sold', 'Revenue', 'COGS (batch cost)', 'Gross profit']}>
              {(rep === 'byMedicine' ? byMedicine : byCategory).map(r => <tr key={r.name}><td className="font-semibold">{r.name}</td><td>{r.qty}</td><td>{money(r.revenue)}</td><td>{money(r.cogs)}</td><td className="font-semibold text-teal-600">{money(r.revenue - r.cogs)}</td></tr>)}
            </Table>
          )}
          <Btn kind="ghost" className="mt-3" onClick={() => exportRows(rep, (rep === 'byMedicine' ? byMedicine : byCategory).map(r => ({ Name: r.name, Qty: r.qty, RevenuePKR: r.revenue / 100, COGSPKR: r.cogs / 100, GrossProfitPKR: (r.revenue - r.cogs) / 100 })))}>Export CSV</Btn>
        </Card>
      )}

      {rep === 'byCashier' && <Card title="Sales by cashier">{byCashier.length === 0 ? <Empty text="No sales in this period." /> : (
        <Table head={['Cashier', 'Invoices', 'Revenue']}>{byCashier.map(r => <tr key={r.name}><td className="font-semibold">{r.name}</td><td>{r.invoices}</td><td>{money(r.revenue)}</td></tr>)}</Table>)}</Card>}

      {rep === 'byPayment' && <Card title="Receipts by payment method (at time of sale)">{byPayment.length === 0 ? <Empty text="No payments in this period." /> : (
        <div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart>
          <Pie data={byPayment} dataKey="value" nameKey="name" label={({ name, value }: any) => `${name}: ${money((value ?? 0) * 100)}`}>
            {byPayment.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie><Tooltip /></PieChart></ResponsiveContainer></div>)}</Card>}

      {rep === 'inventory' && <Card title="Batch-wise inventory valuation (saleable, at cost)">
        <Table head={['Medicine', 'Batch', 'Expiry', 'Qty', 'Cost', 'Value']}>
          {db.batches.filter(b => b.status === 'active' && !engine.isExpired(b) && b.qtyRemaining > 0).map(b => <tr key={b.id}><td>{engine.medicine(b.medicineId).name}</td><td>{b.batchNo}</td><td>{fmtDate(b.expiryDate)}</td><td>{b.qtyRemaining}</td><td>{money(b.costPaisa)}</td><td className="font-semibold">{money(b.qtyRemaining * b.costPaisa)}</td></tr>)}
        </Table>
        <div className="text-right font-bold mt-2">Total valuation: {money(engine.inventoryValuation())}</div>
      </Card>}

      {rep === 'expiry' && (
        <div className="grid md:grid-cols-2 gap-4">
          {([['Expired batches (never saleable)', engine.alerts().expired], ['Near-expiry batches', engine.alerts().nearExpiry]] as const).map(([title, list]) => (
            <Card key={title} title={title}>{list.length === 0 ? <Empty text="None." /> : (
              <Table head={['Medicine', 'Batch', 'Expiry', 'Qty', 'Value at cost']}>
                {list.map(b => <tr key={b.id}><td>{engine.medicine(b.medicineId).name}</td><td>{b.batchNo}</td><td><Badge color={title.startsWith('Expired') ? 'red' : 'amber'}>{fmtDate(b.expiryDate)}</Badge></td><td>{b.qtyRemaining}</td><td>{money(b.qtyRemaining * b.costPaisa)}</td></tr>)}
              </Table>)}</Card>
          ))}
        </div>
      )}

      {rep === 'outstanding' && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="Customers who owe us"><Table head={['Customer', 'Phone', 'Balance']}>
            {db.customers.filter(c => engine.customerBalance(c.id) > 0).map(c => <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td><td className="font-semibold">{money(engine.customerBalance(c.id))}</td></tr>)}
          </Table></Card>
          <Card title="Suppliers we owe"><Table head={['Supplier', 'Phone', 'Balance']}>
            {db.suppliers.filter(s => engine.supplierBalance(s.id) > 0).map(s => <tr key={s.id}><td>{s.name}</td><td>{s.phone}</td><td className="font-semibold">{money(engine.supplierBalance(s.id))}</td></tr>)}
          </Table></Card>
        </div>
      )}

      {rep === 'returns' && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="Sales returns in period"><Table head={['Return', 'Invoice', 'Refund', 'Method']}>
            {db.salesReturns.filter(r => inRange(r.dateTime)).map(r => <tr key={r.id}><td>{r.returnNo}</td><td>{db.sales.find(s => s.id === r.saleId)?.invoiceNo}</td><td>{money(r.refundPaisa)}</td><td>{r.method}</td></tr>)}
          </Table></Card>
          <Card title="Purchase returns in period"><Table head={['Return', 'Supplier', 'Value', 'Reason']}>
            {db.purchaseReturns.filter(r => inRange(r.dateTime)).map(r => <tr key={r.id}><td>{r.returnNo}</td><td>{db.suppliers.find(s => s.id === r.supplierId)?.name}</td><td>{money(r.totalPaisa)}</td><td>{r.reason}</td></tr>)}
          </Table></Card>
        </div>
      )}

      {rep === 'movements' && <Card title="Inventory movement report">
        <Table head={['When', 'Medicine', 'Type', 'Qty', 'Reference', 'By', 'Reason']}>
          {[...db.movements].filter(m => inRange(m.dateTime)).reverse().slice(0, 200).map(m => <tr key={m.id}><td>{m.dateTime.slice(0, 16).replace('T', ' ')}</td><td>{engine.medicine(m.medicineId).name}</td><td>{m.type.replace(/_/g, ' ')}</td><td className={m.qty < 0 ? 'text-red-500' : 'text-teal-600'}>{m.qty > 0 ? '+' : ''}{m.qty}</td><td>{m.reference}</td><td>{db.users.find(u => u.id === m.userId)?.username}</td><td>{m.reason}</td></tr>)}
        </Table>
        <Btn kind="ghost" className="mt-3" onClick={() => exportRows('inventory-movements', db.movements.filter(m => inRange(m.dateTime)).map(m => ({ When: m.dateTime, Medicine: engine.medicine(m.medicineId).name, Type: m.type, Qty: m.qty, Reference: m.reference, Reason: m.reason })))}>Export CSV</Btn>
      </Card>}

      {rep === 'slow' && <Card title="Slow-moving medicines (in stock, few/no sales in period)">
        <Table head={['Medicine', 'Saleable stock', 'Qty sold in period', 'Stock value']}>
          {db.medicines.filter(m => m.active).map(m => ({
            m, stock: engine.saleableStock(m.id),
            sold: items.filter(i => i.medicineId === m.id).reduce((s, i) => s + i.qty, 0),
            value: db.batches.filter(b => b.medicineId === m.id && b.status === 'active').reduce((s, b) => s + b.qtyRemaining * b.costPaisa, 0),
          })).filter(r => r.stock > 0).sort((a, b) => a.sold - b.sold).slice(0, 25)
            .map(r => <tr key={r.m.id}><td>{r.m.name} {r.m.strength}</td><td>{r.stock}</td><td>{r.sold}</td><td>{money(r.value)}</td></tr>)}
        </Table></Card>}
      <p className="text-xs text-slate-400 mt-3">Profit formulas and assumptions: see docs/FINANCIAL_RULES.md. Net operating profit excludes income tax, owner drawings and loan interest unless recorded as expenses.</p>
    </Page>
  );
}
