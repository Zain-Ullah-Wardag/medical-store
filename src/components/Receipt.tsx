import { engine } from '../lib/store';
import { money, fmtDateTime } from './ui';
import type { Sale } from '../core/types';

/** Thermal-style receipt. The print stylesheet shows ONLY this block. */
export function Receipt({ sale }: { sale: Sale }) {
  const db = engine.db;
  const items = db.saleItems.filter(i => i.saleId === sale.id);
  const pays = db.salePayments.filter(p => p.saleId === sale.id);
  const customer = db.customers.find(c => c.id === sale.customerId);
  const cashier = db.users.find(u => u.id === sale.userId);
  const s = db.settings;
  const change = Math.max(0, sale.paidPaisa - sale.totalPaisa);
  const due = Math.max(0, sale.totalPaisa - sale.paidPaisa);
  return (
    <div className="receipt mx-auto w-[300px] max-w-full bg-white text-black font-mono text-[12px] leading-relaxed p-3 border border-dashed border-slate-300">
      <div className="text-center">
        <div className="text-base font-bold">{s.storeName}</div>
        {s.address && <div>{s.address}</div>}
        {s.phone && <div>Tel: {s.phone}</div>}
      </div>
      <div className="border-t border-dashed border-black my-2" />
      <div className="flex justify-between"><span>Invoice:</span><b>{sale.invoiceNo}</b></div>
      <div className="flex justify-between"><span>Date:</span><span>{fmtDateTime(sale.dateTime)}</span></div>
      <div className="flex justify-between"><span>Cashier:</span><span>{cashier?.fullName ?? '—'}</span></div>
      {customer && customer.name !== 'Walk-in Customer' && <div className="flex justify-between"><span>Customer:</span><span>{customer.name}</span></div>}
      <div className="border-t border-dashed border-black my-2" />
      {items.map(i => (
        <div key={i.id}>
          <div className="flex justify-between"><span className="pr-2">{i.medicineName}</span><span>{money(i.lineTotalPaisa)}</span></div>
          <div className="text-[11px] flex justify-between"><span>{i.qty} × {money(i.unitPricePaisa)}{i.discountPaisa ? ` − disc ${money(i.discountPaisa)}` : ''}</span>
            <span>{i.allocations.map(a => `${a.batchNo}`).join(', ')}</span></div>
        </div>
      ))}
      <div className="border-t border-dashed border-black my-2" />
      <div className="flex justify-between"><span>Subtotal</span><span>{money(sale.subtotalPaisa)}</span></div>
      {sale.discountPaisa > 0 && <div className="flex justify-between"><span>Discount</span><span>−{money(sale.discountPaisa)}</span></div>}
      {sale.taxPaisa > 0 && <div className="flex justify-between"><span>Tax</span><span>{money(sale.taxPaisa)}</span></div>}
      <div className="flex justify-between font-bold text-[13px]"><span>TOTAL</span><span>{money(sale.totalPaisa)}</span></div>
      {pays.map(p => <div key={p.id} className="flex justify-between"><span>Paid ({p.method})</span><span>{money(p.amountPaisa)}</span></div>)}
      {change > 0 && <div className="flex justify-between"><span>Change</span><span>{money(change)}</span></div>}
      {due > 0 && <div className="flex justify-between font-bold"><span>Balance due</span><span>{money(due)}</span></div>}
      <div className="border-t border-dashed border-black my-2" />
      <div className="text-center">{s.receiptFooter}</div>
    </div>
  );
}
