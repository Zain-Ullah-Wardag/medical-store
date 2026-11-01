import { useState } from 'react';
import { engine } from '../lib/store';
import { Page, Card, Btn, Modal, Field, inputCls, money, Table, Empty, run, fmtDate, fmtDateTime, Stat, ExportBtn, Badge, toast } from '../components/ui';
import { toPaisa, todayStr, localDateOf } from '../core/money';
import type { SessionUser } from '../core/types';
import { can } from '../core/types';

export function Expenses({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [form, setForm] = useState(false);
  const [cat, setCat] = useState(''); const [from, setFrom] = useState(todayStr().slice(0, 8) + '01'); const [to, setTo] = useState(todayStr());
  const [statusF, setStatusF] = useState<'all' | 'active' | 'reversed'>('all');
  const [revId, setRevId] = useState<number | null>(null); const [revReason, setRevReason] = useState('');
  const rows = db.expenses.filter(e => e.date >= from && e.date <= to && (!cat || e.category === cat) && (statusF === 'all' || (statusF === 'reversed' ? !!e.reversedAt : !e.reversedAt))).sort((a, b) => b.id - a.id);
  return (
    <Page title="Expenses" sub="Operating expenses reduce net operating profit — they are never mixed into medicine cost."
      actions={<>
        <ExportBtn filename={`expenses-${from}-to-${to}.csv`} rows={rows.map(e => ({ Date: e.date, Category: e.category, Description: e.description, AmountPKR: e.amountPaisa / 100, Method: e.method, RecordedBy: db.users.find(u => u.id === e.userId)?.fullName ?? '', Reversed: e.reversedAt ? 'Yes' : 'No', ReversedAt: e.reversedAt ?? '', ReversedBy: e.reversedBy ? (db.users.find(u => u.id === e.reversedBy)?.fullName ?? '') : '', ReversalReason: e.reversalReason ?? '' }))} />
        {can(user.role, 'expenses.create') && <Btn onClick={() => setForm(true)}>+ Add expense</Btn>}
      </>}>
      <div className="grid md:grid-cols-3 gap-3 mb-4">
        <Stat label="Expenses in period (net)" value={money(rows.filter(e => !e.reversedAt).reduce((s, e) => s + e.amountPaisa, 0))} tone="amber" hint="Reversed expenses excluded" />
        {rows.some(e => e.reversedAt) && <Stat label="Reversed (excluded)" value={money(rows.filter(e => e.reversedAt).reduce((s, e) => s + e.amountPaisa, 0))} tone="slate" />}
      </div>
      <Card>
        <div className="grid md:grid-cols-4 gap-2 mb-3">
          <input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} />
          <input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} />
          <select className={inputCls} value={cat} onChange={e => setCat(e.target.value)}><option value="">All categories</option>{db.settings.expenseCategories.map(c => <option key={c}>{c}</option>)}</select>
          <select className={inputCls} value={statusF} onChange={e => setStatusF(e.target.value as any)}>
            <option value="all">All (incl. reversed history)</option><option value="active">Active only</option><option value="reversed">Reversed only</option>
          </select>
        </div>
        <p className="text-xs text-slate-400 mb-3">Reversed expenses are never deleted — they stay here for audit, struck through, and are excluded from totals and reports.</p>
        {rows.length === 0 ? <Empty text="No expenses in this period." /> : (
          <Table head={['Date', 'Category', 'Description', 'Method', 'Recorded by', 'Amount', '']}>
            {rows.map(e => <tr key={e.id} className={e.reversedAt ? 'opacity-60' : ''}><td>{fmtDate(e.date)}</td><td><Badge>{e.category}</Badge>{e.reversedAt && <> <Badge color="amber">reversed</Badge></>}</td>
              <td>{e.description}{e.reference ? ` · ${e.reference}` : ''}{e.reversedAt && <div className="text-xs text-slate-400">Reversed by {db.users.find(u => u.id === e.reversedBy)?.fullName ?? '—'} on {fmtDateTime(e.reversedAt)}: {e.reversalReason}</div>}</td>
              <td>{e.method}</td><td>{db.users.find(u => u.id === e.userId)?.fullName}</td><td className={`font-semibold ${e.reversedAt ? 'line-through' : ''}`}>{money(e.amountPaisa)}</td>
              <td>{!e.reversedAt && can(user.role, 'expenses.reverse') && <Btn kind="ghost" onClick={() => { setRevId(e.id); setRevReason(''); }}>Reverse</Btn>}</td></tr>)}
          </Table>
        )}
      </Card>
      {form && <ExpenseForm user={user} close={() => setForm(false)} />}
      {revId !== null && (
        <Modal title="Reverse expense" onClose={() => setRevId(null)}>
          <p className="text-sm text-slate-500 mb-3">The expense stays in history (flagged “reversed”); reports exclude it, and cash paid is restored. This is written to the audit log as <b>expense.reverse</b>.</p>
          <Field label="Reason for reversal *"><input className={inputCls} value={revReason} onChange={e => setRevReason(e.target.value)} placeholder="e.g. Entered twice" autoFocus /></Field>
          <div className="flex justify-end gap-2 mt-5"><Btn kind="ghost" onClick={() => setRevId(null)}>Cancel</Btn>
            <Btn kind="danger" disabled={!revReason.trim()} onClick={() => { if (run(() => engine.reverseExpense(user, revId, revReason), 'Expense reversed.')) setRevId(null); }}>Reverse expense</Btn></div>
        </Modal>)}
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
  const moves = db.cashMovements.filter(m => localDateOf(m.dateTime) === date);
  const closed = !!session?.closedAt;
  const backupToday = !!db.settings.lastBackupAt && localDateOf(db.settings.lastBackupAt) === todayStr();
  const [reopenReason, setReopenReason] = useState('');
  const closeIt = () => {
    if (run(() => engine.closeDay(user, date, toPaisa(countedRs || 0), notes, reason), 'Day closed successfully.') && !backupToday)
      setTimeout(() => toast('Reminder: no backup was made today. Please create one from Backup & Restore.', true), 400);
  };
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
        <Stat label={closed ? 'Expected cash at closing (snapshot)' : 'Expected closing cash'} value={money(closed ? (session!.expectedPaisa ?? sum.expectedPaisa) : sum.expectedPaisa)} tone="teal" hint={closed ? 'Recorded when the day was closed — later figures cannot change it' : undefined} />
        {session?.closedAt && <Stat label="Counted cash" value={money(session.countedPaisa ?? 0)} hint={`Difference ${money((session.countedPaisa ?? 0) - (session.expectedPaisa ?? 0))}${session.discrepancyReason ? ' — ' + session.discrepancyReason : ''}`} tone={(session.countedPaisa ?? 0) === (session.expectedPaisa ?? 0) ? 'teal' : 'red'} />}
      </div>
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card title="Cash movements for the day">
          {moves.length === 0 ? <Empty text="No cash movements on this date." /> : (
            <Table head={['Time', 'Type', 'Reference', 'Amount']}>
              {moves.map(m => <tr key={m.id}><td>{new Date(m.dateTime).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}</td><td>{m.type.replace(/_/g, ' ')}</td><td>{m.reference}</td>
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
          {closed && (
            <Card title="🔒 This day is closed">
              <p className="text-sm text-slate-500 mb-3">Closed {session!.closedAt ? new Date(session!.closedAt).toLocaleString('en-PK') : ''} by {db.users.find(u => u.id === session!.closedBy)?.fullName ?? '—'}. No cash movements can be added to a closed day. If a correction is genuinely needed, an administrator can reopen it — the reopening, reason and the previous snapshot are written to the audit log.</p>
              {can(user.role, 'cash.reopen') && (
                <div className="flex gap-2">
                  <input className={inputCls} placeholder="Reason for reopening *" value={reopenReason} onChange={e => setReopenReason(e.target.value)} />
                  <Btn kind="danger" disabled={!reopenReason.trim()} onClick={() => { if (run(() => engine.reopenDay(user, date, reopenReason), 'Day reopened. You can record the correction and close it again.')) setReopenReason(''); }}>Reopen day</Btn>
                </div>
              )}
            </Card>
          )}
          {!closed && can(user.role, 'cash.adjust') && (
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
                {!backupToday && <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">⚠ No backup has been made today{db.settings.lastBackupAt ? ` (last backup: ${new Date(db.settings.lastBackupAt).toLocaleString('en-PK')})` : ''}. Please back up from <b>Backup &amp; Restore</b> after closing.</div>}
                <Btn className="w-full" onClick={closeIt}>🔒 Close day</Btn>
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
