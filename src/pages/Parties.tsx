import { useEffect, useState } from 'react';
import { engine } from '../lib/store';
import { Page, Card, Btn, Modal, Field, inputCls, money, Table, Badge, Empty, run, fmtDateTime, downloadFile, toCSV, Stat } from '../components/ui';
import { toPaisa, todayStr } from '../core/money';
import type { Customer, SessionUser } from '../core/types';
import { can } from '../core/types';

export function Customers({ user, goLedger }: { user: SessionUser; goLedger: (customerId: number) => void }) {
  const db = engine.db;
  const [form, setForm] = useState<Customer | 'new' | null>(null);
  const [payFor, setPayFor] = useState<Customer | null>(null);
  const [q, setQ] = useState('');
  const rows = db.customers.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q));
  return (
    <Page title="Customers" sub="Credit (udhaar) accounts. Walk-in is the default counter customer and cannot take credit."
      actions={<>
        <Btn kind="ghost" onClick={() => downloadFile('customers.csv', toCSV(rows.map(c => ({ Name: c.name, Phone: c.phone, BalancePKR: engine.customerBalance(c.id) / 100 }))), 'text/csv')}>Export CSV</Btn>
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
  return (
    <Modal title={`Receive payment — ${cust.name}`} onClose={close}>
      <p className="text-sm mb-3">Outstanding: <b>{money(engine.customerBalance(cust.id))}</b></p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (Rs) *"><input type="number" className={inputCls} value={amountRs} onChange={e => setAmountRs(e.target.value)} /></Field>
        <Field label="Method"><select className={inputCls} value={method} onChange={e => setMethod(e.target.value)}>{db.settings.paymentMethods.map(m => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Date"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Reference"><input className={inputCls} value={ref} onChange={e => setRef(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2 mt-5"><Btn kind="ghost" onClick={close}>Cancel</Btn>
        <Btn onClick={() => { if (run(() => engine.customerPayment(user, { customerId: cust.id, amountPaisa: toPaisa(amountRs || 0), method, reference: ref, saleId: null, date }), 'Payment received and ledger updated.')) close(); }}>Receive payment</Btn></div>
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
  void user;
  return (
    <Page title={kind === 'customer' ? 'Customer Ledger' : 'Supplier Ledger'} sub="Running-balance statement built from recorded transactions only — balances are never typed in directly."
      actions={<Btn kind="ghost" onClick={() => downloadFile(`${kind}-ledger-${partyId}.csv`, toCSV(entries.map(e => ({ Date: e.dateTime, Type: e.type, Reference: e.reference, DebitPKR: e.debitPaisa / 100, CreditPKR: e.creditPaisa / 100, BalancePKR: e.runningPaisa / 100 }))), 'text/csv')}>Export statement CSV</Btn>}>
      <div className="grid md:grid-cols-3 gap-3 mb-4">
        <Stat label={kind === 'customer' ? 'Customer owes us' : 'We owe supplier'} value={money(balance)} tone={balance > 0 ? 'amber' : 'teal'} />
        <Stat label="Opening balance" value={money(party?.openingBalancePaisa ?? 0)} tone="slate" />
        <Stat label="Ledger entries" value={String(entries.length)} tone="blue" />
      </div>
      <Card>
        <select className={inputCls + ' mb-3 !w-auto min-w-[260px]'} value={partyId} onChange={e => setPartyId(Number(e.target.value))}>
          {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {entries.length === 0 ? <Empty text="No ledger entries for this party yet." /> : (
          <Table head={['Date', 'Type', 'Reference', 'Debit', 'Credit', 'Running balance']}>
            {entries.map(e => <tr key={e.id}><td>{fmtDateTime(e.dateTime)}</td><td>{e.type.replace(/_/g, ' ')}</td><td>{e.reference}</td>
              <td>{e.debitPaisa ? money(e.debitPaisa) : '—'}</td><td>{e.creditPaisa ? money(e.creditPaisa) : '—'}</td>
              <td className="font-semibold">{money(e.runningPaisa)}</td></tr>)}
          </Table>
        )}
      </Card>
    </Page>
  );
}
