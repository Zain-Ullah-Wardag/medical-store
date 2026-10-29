import { useState } from 'react';
import { engine } from '../lib/store';
import { Page, Card, Btn, Modal, Field, inputCls, money, Table, Empty, run, fmtDate, Stat, Confirm, downloadFile, toCSV, Badge } from '../components/ui';
import { toPaisa, todayStr } from '../core/money';
import type { SessionUser } from '../core/types';
import { can } from '../core/types';

export function Expenses({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [form, setForm] = useState(false);
  const [cat, setCat] = useState(''); const [from, setFrom] = useState(todayStr().slice(0, 8) + '01'); const [to, setTo] = useState(todayStr());
  const [delId, setDelId] = useState<number | null>(null);
  const rows = db.expenses.filter(e => e.date >= from && e.date <= to && (!cat || e.category === cat)).sort((a, b) => b.id - a.id);
  return (
    <Page title="Expenses" sub="Operating expenses reduce net operating profit — they are never mixed into medicine cost."
      actions={<>
        <Btn kind="ghost" onClick={() => downloadFile('expenses.csv', toCSV(rows.map(e => ({ Date: e.date, Category: e.category, Description: e.description, AmountPKR: e.amountPaisa / 100, Method: e.method }))), 'text/csv')}>Export CSV</Btn>
        {can(user.role, 'expenses.create') && <Btn onClick={() => setForm(true)}>+ Add expense</Btn>}
      </>}>
      <div className="grid md:grid-cols-3 gap-3 mb-4"><Stat label="Expenses in period" value={money(rows.reduce((s, e) => s + e.amountPaisa, 0))} tone="amber" /></div>
      <Card>
        <div className="grid md:grid-cols-3 gap-2 mb-3">
          <input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} />
          <input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} />
          <select className={inputCls} value={cat} onChange={e => setCat(e.target.value)}><option value="">All categories</option>{db.settings.expenseCategories.map(c => <option key={c}>{c}</option>)}</select>
        </div>
        {rows.length === 0 ? <Empty text="No expenses in this period." /> : (
          <Table head={['Date', 'Category', 'Description', 'Method', 'Recorded by', 'Amount', '']}>
            {rows.map(e => <tr key={e.id}><td>{fmtDate(e.date)}</td><td><Badge>{e.category}</Badge></td><td>{e.description}{e.reference ? ` · ${e.reference}` : ''}</td>
              <td>{e.method}</td><td>{db.users.find(u => u.id === e.userId)?.fullName}</td><td className="font-semibold">{money(e.amountPaisa)}</td>
              <td>{can(user.role, 'expenses.delete') && <Btn kind="ghost" onClick={() => setDelId(e.id)}>Reverse</Btn>}</td></tr>)}
          </Table>
        )}
      </Card>
      {form && <ExpenseForm user={user} close={() => setForm(false)} />}
      {delId !== null && <Confirm text="Reverse this expense? If it was paid in cash, a reversing cash movement will be recorded and the action audited." onNo={() => setDelId(null)} onYes={() => { run(() => engine.deleteExpense(user, delId), 'Expense reversed.'); setDelId(null); }} />}
    </Page>
  );
}

function ExpenseForm({ user, close }: { user: SessionUser; close: () => void }) {
  const db = engine.db;
  const [f, setF] = useState({ date: todayStr(), category: db.settings.expenseCategories[0] ?? 'Other', description: '', amountRs: '', method: 'Cash', reference: '' });
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  return (
    <Modal title="Add expense" onClose={close}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><input type="date" className={inputCls} value={f.date} onChange={e => set('date', e.target.value)} /></Field>
        <Field label="Category"><select className={inputCls} value={f.category} onChange={e => set('category', e.target.value)}>{db.settings.expenseCategories.map(c => <option key={c}>{c}</option>)}</select></Field>
        <div className="col-span-2"><Field label="Description *"><input className={inputCls} value={f.description} onChange={e => set('description', e.target.value)} placeholder="e.g. Electricity bill — October" /></Field></div>
        <Field label="Amount (Rs) *"><input type="number" className={inputCls} value={f.amountRs} onChange={e => set('amountRs', e.target.value)} /></Field>
        <Field label="Paid via"><select className={inputCls} value={f.method} onChange={e => set('method', e.target.value)}>{db.settings.paymentMethods.map(m => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Reference"><input className={inputCls} value={f.reference} onChange={e => set('reference', e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2 mt-5"><Btn kind="ghost" onClick={close}>Cancel</Btn>
        <Btn onClick={() => { if (run(() => engine.createExpense(user, { date: f.date, category: f.category, description: f.description, amountPaisa: toPaisa(f.amountRs || 0), method: f.method, reference: f.reference }), 'Expense recorded.')) close(); }}>Save expense</Btn></div>
    </Modal>
  );
}

export function CashManagement({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [date, setDate] = useState(todayStr());
  const [openingRs, setOpeningRs] = useState(''); const [countedRs, setCountedRs] = useState(''); const [reason, setReason] = useState(''); const [notes, setNotes] = useState('');
  const [adjRs, setAdjRs] = useState(''); const [adjReason, setAdjReason] = useState('');
  const sum = engine.dayCashSummary(date);
  const session = db.cashSessions.find(s => s.date === date);
  const moves = db.cashMovements.filter(m => m.dateTime.slice(0, 10) === date);
  return (
    <Page title="Cash Management & Daily Closing" sub="Only physical CASH is reconciled here — card/bank/JazzCash receipts are excluded by design.">
      <div className="flex items-center gap-2 mb-4 text-sm">
        <input type="date" className={inputCls + ' !w-auto'} value={date} onChange={e => setDate(e.target.value)} />
        {session?.closedAt ? <Badge color="blue">Day closed</Badge> : <Badge color="green">Open</Badge>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Opening cash" value={money(session?.openingPaisa ?? 0)} tone="slate" />
        <Stat label="Total sales (all methods)" value={money(sum.totalSalesPaisa)} hint={`Cash ${money(sum.cashSalesPaisa)} · Non-cash ${money(sum.nonCashSalesPaisa)}`} />
        <Stat label="Customer cash received" value={money(sum.customerPaymentsPaisa)} hint={`Refunds paid: ${money(sum.refundsPaisa)}`} tone="blue" />
        <Stat label="Cash out" value={money(sum.expensesPaisa + sum.supplierPaymentsPaisa + sum.cashOutPaisa)} hint={`Expenses ${money(sum.expensesPaisa)} · Suppliers ${money(sum.supplierPaymentsPaisa)}`} tone="amber" />
        <Stat label="Expected closing cash" value={money(sum.expectedPaisa)} tone="teal" />
        {session?.closedAt && <Stat label="Counted cash" value={money(session.countedPaisa ?? 0)} hint={`Difference ${money((session.countedPaisa ?? 0) - (session.expectedPaisa ?? 0))}${session.discrepancyReason ? ' — ' + session.discrepancyReason : ''}`} tone={(session.countedPaisa ?? 0) === (session.expectedPaisa ?? 0) ? 'teal' : 'red'} />}
      </div>
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card title="Cash movements for the day">
          {moves.length === 0 ? <Empty text="No cash movements on this date." /> : (
            <Table head={['Time', 'Type', 'Reference', 'Amount']}>
              {moves.map(m => <tr key={m.id}><td>{m.dateTime.slice(11, 16)}</td><td>{m.type.replace(/_/g, ' ')}</td><td>{m.reference}</td>
                <td className={m.amountPaisa < 0 ? 'text-red-500 font-semibold' : 'text-teal-600 font-semibold'}>{m.amountPaisa > 0 ? '+' : ''}{money(m.amountPaisa)}</td></tr>)}
            </Table>
          )}
        </Card>
        <div className="space-y-4">
          {!session?.closedAt && can(user.role, 'cash.view') && (
            <Card title="Set opening cash (float)">
              <div className="flex gap-2"><input type="number" className={inputCls} placeholder="Opening cash in drawer (Rs)" value={openingRs} onChange={e => setOpeningRs(e.target.value)} />
                <Btn onClick={() => run(() => engine.setOpeningCash(user, date, toPaisa(openingRs || 0)), 'Opening cash set.')}>Set</Btn></div>
            </Card>
          )}
          {can(user.role, 'cash.adjust') && (
            <Card title="Authorized cash in / out">
              <div className="grid grid-cols-2 gap-2">
                <input type="number" className={inputCls} placeholder="Amount Rs (+ in / − out)" value={adjRs} onChange={e => setAdjRs(e.target.value)} />
                <input className={inputCls} placeholder="Reason *" value={adjReason} onChange={e => setAdjReason(e.target.value)} />
              </div>
              <Btn className="mt-3" kind="soft" onClick={() => { if (run(() => engine.cashAdjustment(user, toPaisa(adjRs || 0), adjReason), 'Cash movement recorded.')) { setAdjRs(''); setAdjReason(''); } }}>Record movement</Btn>
            </Card>
          )}
          {!session?.closedAt && can(user.role, 'cash.close') && (
            <Card title="Close the day">
              <div className="space-y-3">
                <Field label="Actual counted cash in drawer (Rs) *"><input type="number" className={inputCls} value={countedRs} onChange={e => setCountedRs(e.target.value)} /></Field>
                {countedRs !== '' && toPaisa(countedRs) !== sum.expectedPaisa && (
                  <div className="rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-200">
                    Cash differs from expected by <b>{money(toPaisa(countedRs) - sum.expectedPaisa)}</b>. A discrepancy reason is required below.
                  </div>
                )}
                <Field label="Discrepancy reason (if any)"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} /></Field>
                <Field label="Closing notes"><input className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
                <Btn className="w-full" onClick={() => run(() => engine.closeDay(user, date, toPaisa(countedRs || 0), notes, reason), 'Day closed successfully.')}>🔒 Close day</Btn>
              </div>
            </Card>
          )}
          <Card title="Closing history">
            {db.cashSessions.filter(s => s.closedAt).length === 0 ? <Empty text="No closed days yet." /> : (
              <Table head={['Date', 'Expected', 'Counted', 'Diff']}>
                {[...db.cashSessions].filter(s => s.closedAt).reverse().map(s => <tr key={s.id}><td>{fmtDate(s.date)}</td><td>{money(s.expectedPaisa ?? 0)}</td><td>{money(s.countedPaisa ?? 0)}</td>
                  <td className={(s.countedPaisa ?? 0) === (s.expectedPaisa ?? 0) ? 'text-teal-600' : 'text-red-500'}>{money((s.countedPaisa ?? 0) - (s.expectedPaisa ?? 0))}</td></tr>)}
              </Table>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
