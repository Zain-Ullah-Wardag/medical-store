import { useState } from 'react';
import { engine, uid } from '../lib/store';
import { Page, Card, Btn, Modal, Field, inputCls, money, toast, Table, Badge, Empty, run, fmtDate, ExportBtn, medLabel } from '../components/ui';
import { toPaisa, todayStr } from '../core/money';
import type { SessionUser, Supplier } from '../core/types';
import { can } from '../core/types';

interface PLine { medicineId: number; batchNo: string; mfgDate: string; expiryDate: string; qty: string; costRs: string; sellRs: string; }

export function Purchases({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [form, setForm] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const canCreate = can(user.role, 'purchases.create');
  const rows = [...db.purchases].sort((a, b) => b.id - a.id);
  return (
    <Page title="Purchases" sub="Receive stock from suppliers. Stock increases exactly once per saved purchase."
      actions={canCreate && <Btn onClick={() => setForm(true)}>+ New purchase</Btn>}>
      <Card>
        {rows.length === 0 ? <Empty text="No purchases recorded yet." action={canCreate && <Btn onClick={() => setForm(true)}>+ New purchase</Btn>} /> : (
          <Table head={['Ref', 'Date', 'Supplier', 'Supplier invoice', 'Total', 'Paid', 'Balance', '']}>
            {rows.map(p => <tr key={p.id}>
              <td>PUR-{p.id}</td><td>{fmtDate(p.date)}</td><td>{db.suppliers.find(s => s.id === p.supplierId)?.name}</td><td>{p.supplierInvoiceNo || '—'}</td>
              <td className="font-semibold">{money(p.totalPaisa)}</td><td>{money(p.paidPaisa)}</td>
              <td>{p.totalPaisa - p.paidPaisa > 0 ? <Badge color="amber">{money(p.totalPaisa - p.paidPaisa)}</Badge> : <Badge color="green">Paid</Badge>}</td>
              <td><Btn kind="soft" onClick={() => setDetailId(p.id)}>View</Btn></td></tr>)}
          </Table>
        )}
      </Card>
      {form && <PurchaseForm user={user} close={() => setForm(false)} />}
      {detailId && (
        <Modal title={`Purchase PUR-${detailId}`} onClose={() => setDetailId(null)} wide>
          <Table head={['Medicine', 'Batch', 'Qty', 'Cost', 'Line total']}>
            {db.purchaseItems.filter(i => i.purchaseId === detailId).map(i => { const b = engine.batch(i.batchId); return (
              <tr key={i.id}><td>{engine.medicine(i.medicineId).name}</td><td>{b.batchNo} (exp {fmtDate(b.expiryDate)})</td><td>{i.qty}</td><td>{money(i.costPaisa)}</td><td className="font-semibold">{money(i.qty * i.costPaisa)}</td></tr>); })}
          </Table>
        </Modal>
      )}
    </Page>
  );
}

function PurchaseForm({ user, close }: { user: SessionUser; close: () => void }) {
  const db = engine.db;
  const [scanCode, setScanCode] = useState('');
  const onScan = (raw: string) => {
    setScanCode('');
    const r = engine.resolveScan(raw);
    if ((r.status !== 'found' && r.status !== 'blocked') || !r.medicine) { toast(r.message || 'Barcode not registered — add the medicine/barcode first.', true); return; }
    const m = r.medicine;
    const rec = r.barcodeRecord;
    const costPerUnit = rec && rec.purchaseCostPaisa > 0 ? rec.purchaseCostPaisa / rec.unitsPerPackage : m.defaultCostPaisa;
    const line: PLine = {
      medicineId: m.id,
      batchNo: r.parsed.gs1?.batchNo ?? '',
      mfgDate: r.parsed.gs1?.productionDate ?? '',
      expiryDate: r.parsed.gs1?.expiryDate ?? '',
      qty: String(r.baseQtyPerScan),
      costRs: String(costPerUnit / 100 || ''),
      sellRs: String(r.unitPricePaisa / 100 || ''),
    };
    setLines(ls => (ls.length === 1 && !ls[0].medicineId ? [line] : [...ls, line]));
    toast(`Scanned: ${m.name} — ${r.packagingLabel}${line.batchNo ? ` · batch ${line.batchNo}` : ''}${line.expiryDate ? ` · exp ${line.expiryDate}` : ''}. Check quantity (base units) and batch details, then save.`);
    r.warnings.forEach(w => toast('⚠ ' + w));
  };
  const [supplierId, setSupplierId] = useState(String(db.suppliers[0]?.id ?? ''));
  const [invoiceNo, setInvoiceNo] = useState(''); const [date, setDate] = useState(todayStr());
  const [lines, setLines] = useState<PLine[]>([{ medicineId: 0, batchNo: '', mfgDate: '', expiryDate: '', qty: '', costRs: '', sellRs: '' }]);
  const [discountRs, setDiscountRs] = useState(''); const [chargesRs, setChargesRs] = useState('');
  const [paidRs, setPaidRs] = useState(''); const [method, setMethod] = useState('Cash');
  const [idem] = useState(uid());
  const setLine = (i: number, k: keyof PLine, v: any) => setLines(ls => ls.map((l, x) => x === i ? { ...l, [k]: v } : l));
  const subtotal = lines.reduce((s, l) => s + (parseInt(l.qty) || 0) * toPaisa(l.costRs || 0), 0);
  const total = subtotal - toPaisa(discountRs || 0) + toPaisa(chargesRs || 0);
  const save = () => {
    if (!supplierId) { toast('Select a supplier (create one under Suppliers first).', true); return; }
    const ok = run(() => engine.createPurchase(user, {
      supplierId: Number(supplierId), supplierInvoiceNo: invoiceNo, date,
      items: lines.filter(l => l.medicineId).map(l => ({ medicineId: l.medicineId, batchNo: l.batchNo, mfgDate: l.mfgDate, expiryDate: l.expiryDate, qty: parseInt(l.qty) || 0, costPaisa: toPaisa(l.costRs || 0), sellPricePaisa: toPaisa(l.sellRs || 0) })),
      discountPaisa: toPaisa(discountRs || 0), chargesPaisa: toPaisa(chargesRs || 0),
      paidPaisa: toPaisa(paidRs || 0), paymentMethod: method, idempotencyKey: idem,
    }), 'Purchase saved — stock and supplier balance updated.');
    if (ok) close();
  };
  return (
    <Modal title="New purchase (receive stock)" onClose={close} wide>
      <div className="mb-4">
        <Field label="🔫 Scan to add line (barcode / GS1 DataMatrix — batch & expiry auto-fill when present in the code)">
          <input className={inputCls} value={scanCode} onChange={e => setScanCode(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); onScan(scanCode); } }}
            placeholder="Scan supplier stock here — quantities convert to base units via packaging barcodes" />
        </Field>
      </div>
      <div className="grid md:grid-cols-3 gap-3 mb-4">
        <Field label="Supplier *"><select className={inputCls} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
          <option value="">Select supplier…</option>{db.suppliers.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Supplier invoice no."><input className={inputCls} value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} /></Field>
        <Field label="Purchase date"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-2 md:grid-cols-7 gap-2 border border-slate-100 dark:border-slate-700 rounded-xl p-2">
            <select className={inputCls + ' col-span-2'} value={l.medicineId} onChange={e => { const id = Number(e.target.value); const m = db.medicines.find(x => x.id === id); setLine(i, 'medicineId', id); if (m) { setLine(i, 'costRs', String(m.defaultCostPaisa / 100 || '')); setLine(i, 'sellRs', String(m.retailPricePaisa / 100 || '')); } }}>
              <option value={0}>Select medicine…</option>{db.medicines.filter(m => m.active).map(m => <option key={m.id} value={m.id}>{medLabel(m)}</option>)}
            </select>
            <input className={inputCls} placeholder="Batch no *" value={l.batchNo} onChange={e => setLine(i, 'batchNo', e.target.value)} />
            <input type="date" className={inputCls} title="Expiry date" value={l.expiryDate} onChange={e => setLine(i, 'expiryDate', e.target.value)} />
            <input type="number" className={inputCls} placeholder="Qty *" value={l.qty} onChange={e => setLine(i, 'qty', e.target.value)} />
            <input type="number" className={inputCls} placeholder="Cost Rs" value={l.costRs} onChange={e => setLine(i, 'costRs', e.target.value)} />
            <div className="flex gap-1"><input type="number" className={inputCls} placeholder="Sell Rs" value={l.sellRs} onChange={e => setLine(i, 'sellRs', e.target.value)} />
              <button className="text-red-500 font-bold px-1" onClick={() => setLines(ls => ls.filter((_, x) => x !== i))}>✕</button></div>
          </div>
        ))}
      </div>
      <Btn kind="soft" className="mt-2" onClick={() => setLines(ls => [...ls, { medicineId: 0, batchNo: '', mfgDate: '', expiryDate: '', qty: '', costRs: '', sellRs: '' }])}>+ Add line</Btn>
      <div className="grid md:grid-cols-5 gap-3 mt-4">
        <Field label="Discount (Rs)"><input type="number" className={inputCls} value={discountRs} onChange={e => setDiscountRs(e.target.value)} /></Field>
        <Field label="Extra charges (Rs)"><input type="number" className={inputCls} value={chargesRs} onChange={e => setChargesRs(e.target.value)} /></Field>
        <Field label="Paid now (Rs)"><input type="number" className={inputCls} value={paidRs} onChange={e => setPaidRs(e.target.value)} /></Field>
        <Field label="Payment method"><select className={inputCls} value={method} onChange={e => setMethod(e.target.value)}>{db.settings.paymentMethods.map(m => <option key={m}>{m}</option>)}</select></Field>
        <div className="text-right"><div className="text-xs text-slate-400">TOTAL</div><div className="text-xl font-bold">{money(total)}</div>
          <div className="text-xs text-amber-600">Balance: {money(Math.max(0, total - toPaisa(paidRs || 0)))}</div></div>
      </div>
      <div className="flex justify-end gap-2 mt-5"><Btn kind="ghost" onClick={close}>Cancel</Btn><Btn onClick={save}>Save purchase & receive stock</Btn></div>
    </Modal>
  );
}

export function Suppliers({ user, goLedger }: { user: SessionUser; goLedger: (supplierId: number) => void }) {
  const db = engine.db;
  const [form, setForm] = useState<Supplier | 'new' | null>(null);
  const [payFor, setPayFor] = useState<Supplier | null>(null);
  const [q, setQ] = useState(''); const [detail, setDetail] = useState<Supplier | null>(null);
  const canEdit = can(user.role, 'suppliers.edit');
  const rows = db.suppliers.filter(s2 => { const t = q.trim().toLowerCase(); return !t || s2.name.toLowerCase().includes(t) || s2.phone.includes(t) || s2.contactPerson.toLowerCase().includes(t) || s2.address.toLowerCase().includes(t); });
  return (
    <Page title="Suppliers" sub="Distributors and their outstanding balances."
      actions={<>
        <ExportBtn filename="suppliers.csv" headerLine={`${db.settings.storeName} — Suppliers — ${new Date().toLocaleString('en-PK')}`} rows={rows.map(s2 => ({ Name: s2.name, Contact: s2.contactPerson, Phone: s2.phone, Address: s2.address, BalancePKR: engine.supplierBalance(s2.id) / 100, Meaning: engine.supplierBalance(s2.id) > 0 ? 'We owe them' : engine.supplierBalance(s2.id) < 0 ? 'Advance (supplier credit)' : 'Clear' }))} />
        {canEdit && <Btn onClick={() => setForm('new')}>+ Add supplier</Btn>}
      </>}>
      <Card>
        <input className={inputCls + ' mb-3'} placeholder="🔎 Search by name, phone, contact person or address…" value={q} onChange={e => setQ(e.target.value)} />
        {rows.length === 0 ? <Empty text={q ? 'No supplier matches your search.' : 'No suppliers yet.'} /> : (
          <Table head={['Supplier', 'Contact', 'Phone', 'We owe them', 'Actions']}>
            {rows.map(s => { const bal = engine.supplierBalance(s.id); return <tr key={s.id}>
              <td><b>{s.name}</b><span className="block text-xs text-slate-400">{s.address}</span></td><td>{s.contactPerson || '—'}</td><td>{s.phone || '—'}</td>
              <td>{bal > 0 ? <Badge color="amber">{money(bal)}</Badge> : bal < 0 ? <Badge color="blue">Advance {money(-bal)}</Badge> : <Badge color="green">Clear</Badge>}</td>
              <td><div className="flex gap-1.5 whitespace-nowrap">
                <Btn kind="soft" onClick={() => setDetail(s)}>Details</Btn>
                <Btn kind="ghost" onClick={() => goLedger(s.id)}>Ledger</Btn>
                {can(user.role, 'payments.create') && <Btn kind="ghost" onClick={() => setPayFor(s)}>Pay</Btn>}
                {canEdit && <Btn kind="ghost" onClick={() => setForm(s)}>Edit</Btn>}</div></td></tr>; })}
          </Table>
        )}
      </Card>
      {form && <SupplierForm user={user} sup={form === 'new' ? undefined : form} close={() => setForm(null)} />}
      {payFor && <PaySupplierForm user={user} sup={payFor} close={() => setPayFor(null)} />}
      {detail && <SupplierDetail sup={detail} goLedger={goLedger} close={() => setDetail(null)} />}
    </Page>
  );
}

function SupplierDetail({ sup, goLedger, close }: { sup: Supplier; goLedger: (id: number) => void; close: () => void }) {
  const db = engine.db;
  const bal = engine.supplierBalance(sup.id);
  const purchases = db.purchases.filter(p => p.supplierId === sup.id).slice().reverse().slice(0, 10);
  const payments = db.supplierPayments.filter(p => p.supplierId === sup.id).slice().reverse().slice(0, 10);
  const returns = db.purchaseReturns.filter(r => r.supplierId === sup.id).slice().reverse().slice(0, 10);
  return (
    <Modal title={sup.name} onClose={close} wide>
      <div className="grid sm:grid-cols-2 gap-2 text-sm mb-4">
        <div><span className="text-slate-400">Contact person:</span> {sup.contactPerson || '—'}</div><div><span className="text-slate-400">Phone:</span> {sup.phone || '—'}</div>
        <div className="sm:col-span-2"><span className="text-slate-400">Address:</span> {sup.address || '—'}</div>
        {sup.notes && <div className="sm:col-span-2"><span className="text-slate-400">Notes / terms:</span> {sup.notes}</div>}
        <div><span className="text-slate-400">Opening balance:</span> {money(sup.openingBalancePaisa)}</div>
        <div><span className="text-slate-400">Current balance:</span> {bal > 0 ? <Badge color="amber">We owe {money(bal)}</Badge> : bal < 0 ? <Badge color="blue">Advance {money(-bal)}</Badge> : <Badge color="green">Clear</Badge>}</div>
      </div>
      <h4 className="font-bold text-sm mb-1.5">Recent purchases (Purchases → View shows full bills)</h4>
      {purchases.length === 0 ? <Empty text="No purchases from this supplier." /> : (
        <Table head={['Reference', 'Date', 'Net', 'Paid', 'Due']}>{purchases.map(p => <tr key={p.id}><td className="font-semibold">{p.supplierInvoiceNo || ("Purchase #" + p.id)}</td><td>{fmtDate(p.date)}</td><td>{money(p.totalPaisa)}</td><td>{money(p.paidPaisa + db.supplierPayments.filter(x => x.purchaseId === p.id).reduce((a, x) => a + x.amountPaisa, 0))}</td><td>{money(Math.max(0, p.totalPaisa - p.paidPaisa - db.supplierPayments.filter(x => x.purchaseId === p.id).reduce((a, x) => a + x.amountPaisa, 0)))}</td></tr>)}</Table>)}
      <div className="grid md:grid-cols-2 gap-3 mt-4">
        <div><h4 className="font-bold text-sm mb-1.5">Recent payments</h4>{payments.length === 0 ? <Empty text="None." /> : (
          <Table head={['Date', 'Amount', 'Method', 'Ref']}>{payments.map(p => <tr key={p.id}><td>{fmtDate(p.date)}</td><td>{money(p.amountPaisa)}</td><td>{p.method}</td><td>{p.reference || '—'}</td></tr>)}</Table>)}</div>
        <div><h4 className="font-bold text-sm mb-1.5">Purchase returns</h4>{returns.length === 0 ? <Empty text="None." /> : (
          <Table head={['Return', 'Value', 'Reason']}>{returns.map(r => <tr key={r.id}><td>{r.returnNo}</td><td>{money(r.totalPaisa)}</td><td>{r.reason}</td></tr>)}</Table>)}</div>
      </div>
      <div className="flex justify-end gap-2 mt-5"><Btn kind="ghost" onClick={close}>Close</Btn>
        <Btn kind="soft" onClick={() => { goLedger(sup.id); close(); }}>Open supplier ledger</Btn></div>
    </Modal>
  );
}

function SupplierForm({ user, sup, close }: { user: SessionUser; sup?: Supplier; close: () => void }) {
  const [f, setF] = useState({ name: sup?.name ?? '', contactPerson: sup?.contactPerson ?? '', phone: sup?.phone ?? '', address: sup?.address ?? '', email: sup?.email ?? '', openingRs: String((sup?.openingBalancePaisa ?? 0) / 100 || ''), notes: sup?.notes ?? '' });
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  return (
    <Modal title={sup ? 'Edit supplier' : 'Add supplier'} onClose={close}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name *"><input className={inputCls} value={f.name} onChange={e => set('name', e.target.value)} /></Field>
        <Field label="Contact person"><input className={inputCls} value={f.contactPerson} onChange={e => set('contactPerson', e.target.value)} /></Field>
        <Field label="Phone"><input className={inputCls} value={f.phone} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="Email"><input className={inputCls} value={f.email} onChange={e => set('email', e.target.value)} /></Field>
        <Field label="Address"><input className={inputCls} value={f.address} onChange={e => set('address', e.target.value)} /></Field>
        <Field label="Opening balance we owe (Rs)"><input type="number" className={inputCls} value={f.openingRs} disabled={!!sup} onChange={e => set('openingRs', e.target.value)} /></Field>
        <div className="col-span-2"><Field label="Notes"><input className={inputCls} value={f.notes} onChange={e => set('notes', e.target.value)} /></Field></div>
      </div>
      {sup && <p className="text-xs text-slate-400 mt-2">Opening balance cannot be edited after creation — use payments/adjustments with an audit trail instead.</p>}
      <div className="flex justify-end gap-2 mt-5"><Btn kind="ghost" onClick={close}>Cancel</Btn>
        <Btn onClick={() => { if (run(() => engine.saveSupplier(user, { id: sup?.id, name: f.name, contactPerson: f.contactPerson, phone: f.phone, address: f.address, email: f.email, openingBalancePaisa: sup ? sup.openingBalancePaisa : toPaisa(f.openingRs || 0), notes: f.notes }), 'Supplier saved.')) close(); }}>Save</Btn></div>
    </Modal>
  );
}

function PaySupplierForm({ user, sup, close }: { user: SessionUser; sup: Supplier; close: () => void }) {
  const db = engine.db;
  const [amountRs, setAmountRs] = useState(''); const [method, setMethod] = useState('Cash'); const [ref, setRef] = useState(''); const [date, setDate] = useState(todayStr());
  const [confirmAdvance, setConfirmAdvance] = useState(false);
  const outstanding = engine.supplierBalance(sup.id);
  const amtPaisa = toPaisa(amountRs || 0);
  const amountError = amountRs === '' ? 'Amount is required.' : amtPaisa <= 0 ? 'Amount must be greater than zero.' : '';
  const excess = amtPaisa - Math.max(0, outstanding);
  const needsConfirm = !amountError && excess > 0;
  return (
    <Modal title={`Pay supplier — ${sup.name}`} onClose={close}>
      <p className="text-sm mb-3">{outstanding > 0 ? <>Outstanding payable: <b>{money(outstanding)}</b></> : outstanding < 0 ? <>Supplier already owes us / holds an advance of <b>{money(-outstanding)}</b>.</> : 'No outstanding payable — any payment creates a supplier advance.'}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount to pay (Rs) *"><input type="number" className={inputCls} value={amountRs} onChange={e => { setAmountRs(e.target.value); setConfirmAdvance(false); }} /></Field>
        <Field label="Method"><select className={inputCls} value={method} onChange={e => setMethod(e.target.value)}>{db.settings.paymentMethods.map(m => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Date"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Reference"><input className={inputCls} value={ref} onChange={e => setRef(e.target.value)} placeholder="Cheque / txn no." /></Field>
      </div>
      {amountRs !== '' && amountError && <p className="text-sm text-red-500 mt-2">{amountError}</p>}
      {needsConfirm && (
        <label className="flex gap-2 items-start rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 px-3 py-2 text-sm text-amber-800 dark:text-amber-100 mt-3 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={confirmAdvance} onChange={e => setConfirmAdvance(e.target.checked)} />
          <span>⚠ This is <b>{money(excess)}</b> more than the outstanding payable. Tick to confirm the extra is an intentional <b>supplier advance</b> (shows as supplier credit on the ledger).</span>
        </label>
      )}
      <div className="flex justify-end gap-2 mt-5"><Btn kind="ghost" onClick={close}>Cancel</Btn>
        <Btn disabled={!!amountError || (needsConfirm && !confirmAdvance)} onClick={() => { if (run(() => engine.supplierPayment(user, { supplierId: sup.id, amountPaisa: amtPaisa, method, reference: ref, date, allowAdvance: confirmAdvance }), 'Payment recorded.')) close(); }}>Record payment</Btn></div>
    </Modal>
  );
}
