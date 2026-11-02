import { useEffect, useState } from 'react';
import { engine } from '../lib/store';
import { Page, Card, Btn, Modal, Field, inputCls, money, Table, Badge, Empty, run, fmtDateTime, ExportBtn, Stat } from '../components/ui';
import { toPaisa, todayStr } from '../core/money';
import type { Customer, SessionUser } from '../core/types';
import { can } from '../core/types';


export const ledgerTypeLabel = (t: string): string => ({
  sale: 'Credit sale', payment: 'Payment received / paid', purchase: 'Purchase (credit)',
  purchase_return: 'Purchase return', sales_return: 'Sales return (credit)', adjustment: 'Balance adjustment',
}[t] ?? t.replace(/_/g, ' '));

export function Customers({ user, goLedger }: { user: SessionUser; goLedger: (customerId: number) => void }) {
  const db = engine.db;
  const [form, setForm] = useState<Customer | 'new' | null>(null);
  const [payFor, setPayFor] = useState<Customer | null>(null);
  const [q, setQ] = useState('');
  const rows = db.customers.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q));
  return (
    <Page title="Customers" sub="Credit (udhaar) accounts. Walk-in is the default counter customer and cannot take credit."
      actions={<>
        {can(user.role, 'customers.export') && <ExportBtn filename="customers.csv" headerLine={`${db.settings.storeName} — Customers — ${new Date().toLocaleString('en-PK')}`} rows={engine.customerExportRows(user, q)} />}
        {can(user.role, 'customers.edit') && <Btn onClick={() => setForm('new')}>+ Add customer</Btn>}
      </>}>
      <Card>
        <input className={inputCls + ' mb-3'} placeholder="Search by name or phone…" value={q} onChange={e => setQ(e.target.value)} />
        {rows.length === 0 ? <Empty text="No customers found." /> : (
          <Table head={['Customer', 'Phone', 'Owes us (balance)', 'Actions']}>
            {rows.map(c => { const bal = engine.customerBalance(c.id); return <tr key={c.id}>
              <td><b>{c.name}</b><span className="block text-xs text-slate-400">{c.address}</span></td><td>{c.phone || '—'}</td>
              <td>{bal > 0 ? <Badge color="amber">{money(bal)}</Badge> : bal < 0 ? <Badge color="blue">Advance {money(-bal)}</Badge> : <Badge color="green">Clear</Badge>}</td>
              <td><div className="flex gap-1.5 whitespace-nowrap">
                <Btn kind="soft" onClick={() => goLedger(c.id)}>Ledger / statement</Btn>
                {can(user.role, 'payments.create') && <Btn kind="ghost" onClick={() => setPayFor(c)}>Receive payment</Btn>}
                {can(user.role, 'customers.edit') && <Btn kind="ghost" onClick={() => setForm(c)}>Edit</Btn>}</div></td></tr>; })}
          </Table>
        )}
      </Card>
      {form && <CustomerForm user={user} cust={form === 'new' ? undefined : form} close={() => setForm(null)} />}
      {payFor && <ReceiveForm user={user} cust={payFor} close={() => setPayFor(null)} />}
    </Page>
  );
}

function CustomerForm({ user, cust, close }: { user: SessionUser; cust?: Customer; close: () => void }) {
  const [f, setF] = useState({ name: cust?.name ?? '', phone: cust?.phone ?? '', address: cust?.address ?? '', openingRs: String((cust?.openingBalancePaisa ?? 0) / 100 || ''), notes: cust?.notes ?? '' });
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  return (
    <Modal title={cust ? 'Edit customer' : 'Add customer'} onClose={close}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name *"><input className={inputCls} value={f.name} onChange={e => set('name', e.target.value)} /></Field>
        <Field label="Phone"><input className={inputCls} value={f.phone} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="Address"><input className={inputCls} value={f.address} onChange={e => set('address', e.target.value)} /></Field>
        <Field label="Opening udhaar (Rs)"><input type="number" className={inputCls} value={f.openingRs} disabled={!!cust} onChange={e => set('openingRs', e.target.value)} /></Field>
        {cust && <p className="col-span-2 text-xs text-slate-400">Opening balance can’t be edited directly — it protects your audit trail. To correct a balance, use <b>Customer Ledger → Adjust balance</b> (reason required, fully audited).</p>}
        <div className="col-span-2"><Field label="Notes"><input className={inputCls} value={f.notes} onChange={e => set('notes', e.target.value)} /></Field></div>
      </div>
      <p className="text-xs text-slate-400 mt-2">Only business contact details are stored — no medical/patient information.</p>
      <div className="flex justify-end gap-2 mt-5"><Btn kind="ghost" onClick={close}>Cancel</Btn>
        <Btn onClick={() => { if (run(() => engine.saveCustomer(user, { id: cust?.id, name: f.name, phone: f.phone, address: f.address, openingBalancePaisa: cust ? cust.openingBalancePaisa : toPaisa(f.openingRs || 0), notes: f.notes }), 'Customer saved.')) close(); }}>Save</Btn></div>
    </Modal>
  );
}

function ReceiveForm({ user, cust, close }: { user: SessionUser; cust: Customer; close: () => void }) {
  const db = engine.db;
  const [amountRs, setAmountRs] = useState(''); const [method, setMethod] = useState('Cash'); const [ref, setRef] = useState(''); const [date, setDate] = useState(todayStr());
  const balance = engine.customerBalance(cust.id);
  const amtPaisa = toPaisa(amountRs || 0);
  const amountError = amountRs === '' ? 'Amount is required.' : amtPaisa <= 0 ? 'Amount must be greater than zero.' : '';
  const advance = amtPaisa - Math.max(0, balance);
  const isWalkIn = cust.id === db.customers[0]?.id;
  return (
    <Modal title={`Receive payment — ${cust.name}`} onClose={close}>
      <p className="text-sm mb-3">{balance > 0 ? <>Outstanding (udhaar): <b>{money(balance)}</b></> : balance < 0 ? <>This customer already has an advance of <b>{money(-balance)}</b>.</> : 'No outstanding balance. Any payment recorded will be held as a customer advance.'}</p>
      {isWalkIn && <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-700 dark:text-amber-200 mb-3">⚠ Walk-in is a shared counter record — customer advances should belong to a <b>named customer</b>. Add the customer first, then receive against their name. (A reference is required for Walk-in payments.)</div>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount received (Rs) *"><input type="number" className={inputCls} value={amountRs} onChange={e => setAmountRs(e.target.value)} /></Field>
        <Field label="Method"><select className={inputCls} value={method} onChange={e => setMethod(e.target.value)}>{db.settings.paymentMethods.map(m => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Date"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Reference"><input className={inputCls} value={ref} onChange={e => setRef(e.target.value)} /></Field>
      </div>
      {amountRs !== '' && amountError && <p className="text-sm text-red-500 mt-2">{amountError}</p>}
      {!amountError && advance > 0 && <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 text-sm text-blue-700 dark:text-blue-200 mt-3">This exceeds the outstanding udhaar — <b>{money(advance)}</b> will be kept as a customer advance (used against future purchases). It is <b>not</b> sales income.</div>}
      <div className="flex justify-end gap-2 mt-5"><Btn kind="ghost" onClick={close}>Cancel</Btn>
        <Btn disabled={!!amountError || (isWalkIn && !ref.trim())} onClick={() => { if (run(() => engine.customerPayment(user, { customerId: cust.id, amountPaisa: amtPaisa, method, reference: ref, saleId: null, date }), 'Payment received and ledger updated.')) close(); }}>Receive payment</Btn></div>
    </Modal>
  );
}

export function LedgerPage({ kind, preselect, user }: { kind: 'customer' | 'supplier'; preselect?: number; user: SessionUser }) {
  const db = engine.db;
  const parties = kind === 'customer' ? db.customers : db.suppliers;
  const [partyId, setPartyId] = useState<number>(preselect ?? parties[0]?.id ?? 0);
  useEffect(() => { if (preselect) setPartyId(preselect); }, [preselect]);
  const entries = partyId ? engine.partyLedger(kind, partyId) : [];
  const balance = kind === 'customer' ? engine.customerBalance(partyId) : engine.supplierBalance(partyId);
  const party = parties.find(p => p.id === partyId);
  const [adjRs, setAdjRs] = useState(''); const [adjReason, setAdjReason] = useState('');
  return (
    <Page title={kind === 'customer' ? 'Customer Ledger' : 'Supplier Ledger'} sub="Running-balance statement built from recorded transactions only — balances are never typed in directly."
      actions={can(user.role, kind === 'customer' ? 'customers.export' : 'suppliers.export') ? <ExportBtn filename={`${kind}-ledger-${party?.name.replace(/[^a-z0-9]+/gi, '_') ?? partyId}.csv`} label="Export statement CSV" headerLine={`${db.settings.storeName} — ${kind === 'customer' ? 'Customer' : 'Supplier'} statement — ${party?.name ?? ''} — generated ${new Date().toLocaleString('en-PK')}`} rows={engine.partyLedgerExportRows(user, kind, partyId).map(r => ({ ...r, Type: ledgerTypeLabel(String(r.Type)) }))} /> : undefined}>
      <div className="grid md:grid-cols-3 gap-3 mb-4">
        <Stat label={kind === 'customer' ? (balance < 0 ? 'Customer advance held' : 'Customer owes us') : (balance < 0 ? 'Supplier credit (advance paid)' : 'We owe supplier')} value={money(Math.abs(balance))} tone={balance > 0 ? 'amber' : 'teal'} hint={balance < 0 ? (kind === 'customer' ? 'Customer paid in advance — not sales income' : 'We overpaid/returned — use against future purchases') : undefined} />
        <Stat label="Opening balance" value={money(party?.openingBalancePaisa ?? 0)} tone="slate" />
        <Stat label="Ledger entries" value={String(entries.length)} tone="blue" />
      </div>
      <Card>
        <select className={inputCls + ' mb-3 !w-auto min-w-[260px]'} value={partyId} onChange={e => setPartyId(Number(e.target.value))}>
          {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {entries.length === 0 ? <Empty text="No ledger entries for this party yet." /> : (
          <Table head={['Date', 'Type', 'Reference', 'Debit', 'Credit', 'Running balance']}>
            {entries.map(e => <tr key={e.id}><td>{fmtDateTime(e.dateTime)}</td><td>{ledgerTypeLabel(e.type)}</td><td>{e.reference}</td>
              <td>{e.debitPaisa ? money(e.debitPaisa) : '—'}</td><td>{e.creditPaisa ? money(e.creditPaisa) : '—'}</td>
              <td className="font-semibold">{money(e.runningPaisa)}</td></tr>)}
          </Table>
        )}
      </Card>
      {can(user.role, 'ledgers.adjust') && partyId > 0 && (
        <Card title="Adjust balance (audited correction)">
          <p className="text-sm text-slate-500 mb-3">Opening balances and past entries are never edited. Enter a signed amount: <b>+</b> increases what is owed ({kind === 'customer' ? 'customer owes us more' : 'we owe the supplier more'}), <b>−</b> decreases it. The adjustment and its reason appear in this statement and in Audit Logs.</p>
          <div className="flex flex-wrap gap-2">
            <input type="number" className={inputCls + ' !w-44'} placeholder="Amount (Rs, ±)" value={adjRs} onChange={e => setAdjRs(e.target.value)} />
            <input className={inputCls + ' flex-1 min-w-[220px]'} placeholder="Reason *" value={adjReason} onChange={e => setAdjReason(e.target.value)} />
            <Btn kind="soft" disabled={!adjRs || toPaisa(adjRs) === 0 || !adjReason.trim()} onClick={() => { if (run(() => engine.adjustPartyBalance(user, kind, partyId, toPaisa(adjRs), adjReason), 'Balance adjustment recorded.')) { setAdjRs(''); setAdjReason(''); } }}>Record adjustment</Btn>
          </div>
        </Card>
      )}
    </Page>
  );
}
