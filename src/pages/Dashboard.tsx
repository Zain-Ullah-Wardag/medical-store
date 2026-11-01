import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { engine } from '../lib/store';
import { Page, Card, Stat, Table, Badge, Empty, money, fmtDate, fmtDateTime, inputCls } from '../components/ui';
import { todayStr, addDays } from '../core/money';
import type { SessionUser } from '../core/types';
import { can } from '../core/types';

export function Dashboard({ user, go }: { user: SessionUser; go: (p: string) => void }) {
  const db = engine.db;
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  // Role-scoped data: the engine restricts cashiers to their OWN sales for
  // every figure below (same policy as Sales History) — not just hidden UI.
  const ownOnly = !can(user.role, 'sales.view');
  const canPurchases = can(user.role, 'purchases.view');
  const stats = useMemo(() => engine.rangeStats(from, to, user), [from, to, db]);
  const today = useMemo(() => engine.rangeStats(todayStr(), todayStr(), user), [db]);
  const { nearExpiry, expired, lowStock } = engine.alerts();
  const trend = engine.salesTrend(14, user).map(d => ({ date: d.date.slice(5), Sales: d.salesPaisa / 100, Invoices: d.invoices }));
  const top = engine.topSelling(addDays(todayStr(), -30), todayStr(), 5, user);
  const recentSales = engine.recentSales(user, 5);
  const recentPurchases = canPurchases ? [...db.purchases].sort((a, b) => b.id - a.id).slice(0, 5) : [];
  const custOut = db.customers.reduce((s, c) => s + Math.max(0, engine.customerBalance(c.id)), 0);
  const suppOut = db.suppliers.reduce((s, c) => s + Math.max(0, engine.supplierBalance(c.id)), 0);
  const showProfit = can(user.role, 'reports.view') || user.role === 'admin';

  return (
    <Page title={`Assalam-o-Alaikum, ${user.fullName.split(' ')[0]} 👋`} sub={`${db.settings.storeName} — ${fmtDate(todayStr())}`}
      actions={<div className="flex items-center gap-2 text-sm">
        <input type="date" className={inputCls + ' !w-auto'} value={from} onChange={e => setFrom(e.target.value)} />
        <span className="text-slate-400">to</span>
        <input type="date" className={inputCls + ' !w-auto'} value={to} onChange={e => setTo(e.target.value)} />
      </div>}>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mb-4">
        <Stat label={ownOnly ? 'Your sales (selected period)' : 'Sales (selected period)'} value={money(stats.netRevenue)} hint={`${stats.invoiceCount} invoices · returns ${money(stats.returnsValue)}`} />
        <Stat label={ownOnly ? "Your sales today" : "Today's sales"} value={money(today.netRevenue)} hint={`${today.invoiceCount} invoices today`} />
        {canPurchases && <Stat label="Purchases (period)" value={money(stats.purchases)} hint="Stock bought — not COGS" tone="blue" />}
        {showProfit && <Stat label="Gross profit (period)" value={money(stats.grossProfit)} hint={`COGS ${money(stats.cogs)} (batch cost)`} tone="teal" />}
        {showProfit && <Stat label="Expenses (period)" value={money(stats.expenses)} hint="Recorded operating expenses" tone="amber" />}
        {showProfit && <Stat label="Net operating profit (est.)" value={money(stats.netOperatingProfit)} hint="Gross profit − expenses" tone="teal" />}
        <Stat label="Inventory value" value={money(engine.inventoryValuation())} hint="Saleable batches at cost" tone="blue" />
        <Stat label="Customers owe us" value={money(custOut)} hint="Outstanding udhaar" tone="amber" />
        {canPurchases && <Stat label="We owe suppliers" value={money(suppOut)} hint="Outstanding payables" tone="amber" />}
        <Stat label="Low-stock medicines" value={String(lowStock.length)} hint="At/below minimum level" tone={lowStock.length ? 'amber' : 'slate'} />
        <Stat label="Near-expiry batches" value={String(nearExpiry.length)} hint={`Within ${db.settings.expiryWarnDays} days`} tone={nearExpiry.length ? 'amber' : 'slate'} />
        <Stat label="Expired batches" value={String(expired.length)} hint="Blocked from sale" tone={expired.length ? 'red' : 'slate'} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Card title={ownOnly ? "Your sales trend — last 14 days (PKR)" : "Sales trend — last 14 days (PKR)"} className="lg:col-span-2">
          {db.sales.length === 0 ? <Empty text="No sales yet. Complete your first sale from Point of Sale." /> : (
            <div className="h-56"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend}><CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="date" fontSize={11} /><YAxis fontSize={11} /><Tooltip /><Bar dataKey="Sales" fill="#0d9488" radius={[4, 4, 0, 0]} /></BarChart>
            </ResponsiveContainer></div>
          )}
        </Card>
        <Card title="Top-selling medicines (30 days)">
          {top.length === 0 ? <Empty text="No sales in the last 30 days." /> : (
            <ul className="space-y-2 text-sm">{top.map(t => (
              <li key={t.medicineId} className="flex justify-between gap-2"><span className="text-slate-700 dark:text-slate-200">{t.name}</span><span className="font-semibold">{t.qty} × · {money(t.revenuePaisa)}</span></li>
            ))}</ul>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="⚠ Inventory alerts">
          {expired.length + nearExpiry.length + lowStock.length === 0 ? <Empty text="All clear — no expiry or low-stock alerts." /> : (
            <ul className="space-y-2 text-sm">
              {expired.map(b => <li key={b.id} className="flex justify-between gap-2"><span>{engine.medicine(b.medicineId).name} · {b.batchNo}</span><Badge color="red">Expired {fmtDate(b.expiryDate)}</Badge></li>)}
              {nearExpiry.slice(0, 5).map(b => <li key={b.id} className="flex justify-between gap-2"><span>{engine.medicine(b.medicineId).name} · {b.batchNo}</span><Badge color="amber">Exp {fmtDate(b.expiryDate)}</Badge></li>)}
              {lowStock.slice(0, 5).map(m => <li key={m.id} className="flex justify-between gap-2"><span>{m.name}</span><Badge color="amber">Only {engine.saleableStock(m.id)} left</Badge></li>)}
            </ul>
          )}
          <button className="mt-3 text-teal-600 text-sm font-semibold" onClick={() => go('inventory')}>Open Inventory →</button>
        </Card>
        <Card title={ownOnly ? 'Your recent sales' : 'Recent sales'}>
          {recentSales.length === 0 ? <Empty text="No sales yet." /> : (
            <Table head={['Invoice', 'Time', 'Total']}>{recentSales.map(s => (
              <tr key={s.id}><td>{s.invoiceNo}</td><td>{fmtDateTime(s.dateTime)}</td><td className="font-semibold">{money(s.totalPaisa)}</td></tr>
            ))}</Table>
          )}
          <button className="mt-3 text-teal-600 text-sm font-semibold" onClick={() => go('pos')}>New sale (POS) →</button>
        </Card>
        {canPurchases && (
        <Card title="Recent purchases">
          {recentPurchases.length === 0 ? <Empty text="No purchases recorded yet." /> : (
            <Table head={['Ref', 'Supplier', 'Total']}>{recentPurchases.map(p => (
              <tr key={p.id}><td>PUR-{p.id}</td><td>{db.suppliers.find(s => s.id === p.supplierId)?.name ?? '—'}</td><td className="font-semibold">{money(p.totalPaisa)}</td></tr>
            ))}</Table>
          )}
          <button className="mt-3 text-teal-600 text-sm font-semibold" onClick={() => go('purchases')}>Record purchase →</button>
        </Card>
        )}
      </div>
    </Page>
  );
}
