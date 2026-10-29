import { useRef, useState } from 'react';
import { engine } from '../lib/store';
import { Page, Card, Btn, Modal, Field, inputCls, Table, Badge, Empty, run, toast, fmtDateTime, downloadFile, toCSV, Confirm } from '../components/ui';
import { todayStr } from '../core/money';
import type { Role, SessionUser, Settings } from '../core/types';
import { PERMISSIONS } from '../core/types';

export function Users({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [form, setForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [f, setF] = useState({ username: '', fullName: '', password: '', role: 'cashier' as Role });
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  return (
    <Page title="Users & Permissions" sub="Passwords are stored only as bcrypt hashes. Permission checks run in the engine for every operation — hiding a button is never the only protection."
      actions={<Btn onClick={() => { setForm(true); setEditId(null); setF({ username: '', fullName: '', password: '', role: 'cashier' }); }}>+ Add employee</Btn>}>
      <Card>
        <Table head={['Name', 'Username', 'Role', 'Status', 'Actions']}>
          {db.users.map(u => <tr key={u.id}><td className="font-semibold">{u.fullName}</td><td className="font-mono">{u.username}</td>
            <td><Badge color={u.role === 'admin' ? 'red' : u.role === 'pharmacist' ? 'blue' : 'slate'}>{u.role === 'admin' ? 'Owner/Admin' : u.role === 'pharmacist' ? 'Pharmacist/Manager' : 'Cashier'}</Badge></td>
            <td>{u.active ? <Badge color="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
            <td><div className="flex gap-1.5">
              <Btn kind="ghost" onClick={() => { setEditId(u.id); setForm(true); setF({ username: u.username, fullName: u.fullName, password: '', role: u.role }); }}>Edit</Btn>
              <Btn kind="ghost" onClick={() => run(() => engine.updateUser(user, u.id, { active: !u.active }), u.active ? 'User deactivated.' : 'User activated.')}>{u.active ? 'Deactivate' : 'Activate'}</Btn>
            </div></td></tr>)}
        </Table>
      </Card>
      <Card title="What each role can do" className="mt-4">
        <div className="grid md:grid-cols-3 gap-3 text-sm">
          {(Object.keys(PERMISSIONS) as Role[]).map(r => (
            <div key={r}><div className="font-semibold mb-1 capitalize">{r}</div>
              <ul className="text-slate-500 dark:text-slate-400 space-y-0.5">{PERMISSIONS[r].slice(0, 12).map(p => <li key={p}>• {p === '*' ? 'Everything' : p}</li>)}</ul></div>
          ))}
        </div>
      </Card>
      {form && (
        <Modal title={editId ? 'Edit employee' : 'Add employee'} onClose={() => setForm(false)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full name *"><input className={inputCls} value={f.fullName} onChange={e => set('fullName', e.target.value)} /></Field>
            <Field label="Username *"><input className={inputCls} disabled={!!editId} value={f.username} onChange={e => set('username', e.target.value)} /></Field>
            <Field label={editId ? 'New password (blank = unchanged)' : 'Password * (min 6)'}><input type="password" className={inputCls} value={f.password} onChange={e => set('password', e.target.value)} /></Field>
            <Field label="Role"><select className={inputCls} value={f.role} onChange={e => set('role', e.target.value)}>
              <option value="admin">Owner / Administrator</option><option value="pharmacist">Pharmacist / Manager</option><option value="cashier">Cashier</option></select></Field>
          </div>
          <div className="flex justify-end gap-2 mt-5"><Btn kind="ghost" onClick={() => setForm(false)}>Cancel</Btn>
            <Btn onClick={() => {
              const ok = editId
                ? run(() => engine.updateUser(user, editId, { fullName: f.fullName, role: f.role, password: f.password || undefined }), 'User updated.')
                : run(() => engine.createUser(user, f), 'Employee account created.');
              if (ok) setForm(false);
            }}>Save</Btn></div>
        </Modal>
      )}
    </Page>
  );
}

export function AuditLogs() {
  const db = engine.db;
  const [q, setQ] = useState('');
  const rows = [...db.audit].reverse().filter(a => !q || (a.action + a.details + a.username).toLowerCase().includes(q.toLowerCase())).slice(0, 300);
  return (
    <Page title="Audit Logs" sub="Every important action — sales, returns, stock adjustments, payments, logins — with user and time."
      actions={<Btn kind="ghost" onClick={() => downloadFile('audit-log.csv', toCSV(rows.map(a => ({ When: a.dateTime, User: a.username, Action: a.action, Details: a.details }))), 'text/csv')}>Export CSV</Btn>}>
      <Card>
        <input className={inputCls + ' mb-3'} placeholder="Filter by user, action or details…" value={q} onChange={e => setQ(e.target.value)} />
        {rows.length === 0 ? <Empty text="No audit entries." /> : (
          <Table head={['When', 'User', 'Action', 'Details']}>
            {rows.map(a => <tr key={a.id}><td className="whitespace-nowrap">{fmtDateTime(a.dateTime)}</td><td>{a.username}</td><td><Badge>{a.action}</Badge></td><td>{a.details}</td></tr>)}
          </Table>
        )}
      </Card>
    </Page>
  );
}

export function Backup({ user }: { user: SessionUser }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [validation, setValidation] = useState<string>('');
  const [issues, setIssues] = useState<string[] | null>(null);
  const doBackup = () => { downloadFile(`medstore-backup-${todayStr()}-${Date.now() % 100000}.json`, engine.exportBackup(), 'application/json'); toast('Backup file downloaded. Save a copy on a USB drive too.'); };
  const onFile = async (f: File) => {
    const text = await f.text();
    const v = engine.validateBackup(text);
    if (!v.ok) { toast('Invalid backup: ' + v.errors.join(' '), true); return; }
    setValidation(v.summary ?? 'Valid backup.'); setPending(text);
  };
  return (
    <Page title="Backup & Restore" sub="Backups contain your ENTIRE store database. Keep copies on a USB drive outside this computer.">
      <div className="grid md:grid-cols-2 gap-4 items-start">
        <Card title="💾 Create backup">
          <p className="text-sm text-slate-500 mb-3">Downloads one backup file (JSON export of the database; in the Windows build the same button also produces a SQLite <code>.db</code> copy). Recommended: back up at daily closing.</p>
          <Btn onClick={doBackup}>Download backup now</Btn>
          <p className="text-xs text-slate-400 mt-3">Retention setting: keep last {engine.db.settings.backupRetention} backups (configure in Settings). Automatic daily prompt: at cash closing, if no backup was made today.</p>
        </Card>
        <Card title="♻ Restore from backup">
          <p className="text-sm text-slate-500 mb-3">Restore replaces ALL current data. The current database is first downloaded as a safety backup, the selected file is validated, then integrity is verified after restore.</p>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
          <Btn kind="soft" onClick={() => fileRef.current?.click()}>Select backup file…</Btn>
          {validation && <div className="mt-3 text-sm rounded-lg bg-teal-50 dark:bg-teal-900/30 px-3 py-2 text-teal-700 dark:text-teal-200">{validation}</div>}
          {pending && <Btn kind="danger" className="mt-3 block" onClick={() => {
            try {
              const safety = engine.exportBackup();
              downloadFile(`medstore-SAFETY-before-restore-${todayStr()}.json`, safety, 'application/json');
              engine.restoreBackup(user, pending);
              toast('Restore completed and verified. Please log in again.');
              setPending(null); setValidation('');
              setTimeout(() => window.location.reload(), 800);
            } catch (e: any) { toast(e.message, true); }
          }}>⚠ Restore now (replaces all data)</Btn>}
        </Card>
        <Card title="🔍 Database integrity & reconciliation">
          <p className="text-sm text-slate-500 mb-3">Checks that every batch quantity equals the sum of its stock movements, no negative stock, unique barcodes and invoice numbers.</p>
          <Btn kind="soft" onClick={() => setIssues(engine.integrityCheck())}>Run integrity check</Btn>
          {issues !== null && (issues.length === 0
            ? <div className="mt-3 text-sm text-teal-600 font-semibold">✅ All checks passed — stock movements reconcile with batch quantities.</div>
            : <ul className="mt-3 text-sm text-red-600 space-y-1">{issues.map((i, x) => <li key={x}>• {i}</li>)}</ul>)}
        </Card>
      </div>
    </Page>
  );
}

export function SettingsPage({ user, dark, setDark }: { user: SessionUser; dark: boolean; setDark: (v: boolean) => void }) {
  const s = engine.db.settings;
  const [f, setF] = useState<Settings>({ ...s });
  const [pw, setPw] = useState({ old: '', next: '' });
  const [confirmClear, setConfirmClear] = useState(false);
  const set = (k: keyof Settings, v: any) => setF(x => ({ ...x, [k]: v }));
  return (
    <Page title="Settings" sub="Store profile, billing rules and safety controls.">
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card title="Store profile & receipt">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Store name"><input className={inputCls} value={f.storeName} onChange={e => set('storeName', e.target.value)} /></Field>
            <Field label="Phone"><input className={inputCls} value={f.phone} onChange={e => set('phone', e.target.value)} /></Field>
            <div className="col-span-2"><Field label="Address"><input className={inputCls} value={f.address} onChange={e => set('address', e.target.value)} /></Field></div>
            <Field label="Email"><input className={inputCls} value={f.email} onChange={e => set('email', e.target.value)} /></Field>
            <Field label="Currency"><input className={inputCls} value={f.currency} onChange={e => set('currency', e.target.value)} /></Field>
            <div className="col-span-2"><Field label="Receipt footer"><input className={inputCls} value={f.receiptFooter} onChange={e => set('receiptFooter', e.target.value)} /></Field></div>
            <Field label="Printer name (Windows)"><input className={inputCls} value={f.printerName} onChange={e => set('printerName', e.target.value)} placeholder="e.g. XP-80C thermal" /></Field>
            <Field label="Invoice prefix"><input className={inputCls} value={f.invoicePrefix} onChange={e => set('invoicePrefix', e.target.value)} /></Field>
          </div>
        </Card>
        <Card title="Billing, stock & cashier rules">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tax rate % (0 = none)"><input type="number" step="0.1" className={inputCls} value={f.taxRatePct} onChange={e => set('taxRatePct', parseFloat(e.target.value) || 0)} /></Field>
            <Field label="Expiry warning (days)"><input type="number" className={inputCls} value={f.expiryWarnDays} onChange={e => set('expiryWarnDays', parseInt(e.target.value) || 90)} /></Field>
            <Field label="Backup retention (count)"><input type="number" className={inputCls} value={f.backupRetention} onChange={e => set('backupRetention', parseInt(e.target.value) || 30)} /></Field>
            <Field label="Appearance"><select className={inputCls} value={dark ? 'dark' : 'light'} onChange={e => setDark(e.target.value === 'dark')}><option value="light">Light</option><option value="dark">Dark</option></select></Field>
            <div className="col-span-2"><Field label="Payment methods (comma separated)"><input className={inputCls} value={f.paymentMethods.join(', ')} onChange={e => set('paymentMethods', e.target.value.split(',').map(x => x.trim()).filter(Boolean))} /></Field></div>
            <div className="col-span-2"><Field label="Expense categories (comma separated)"><input className={inputCls} value={f.expenseCategories.join(', ')} onChange={e => set('expenseCategories', e.target.value.split(',').map(x => x.trim()).filter(Boolean))} /></Field></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.allowCashierReturns} onChange={e => set('allowCashierReturns', e.target.checked)} /> Cashiers may process returns</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.allowCashierCredit} onChange={e => set('allowCashierCredit', e.target.checked)} /> Cashiers may make credit sales</label>
          </div>
          <Btn className="mt-4" onClick={() => run(() => engine.updateSettings(user, f), 'Settings saved.')}>Save settings</Btn>
        </Card>
        <Card title="Change my password">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Current password"><input type="password" className={inputCls} value={pw.old} onChange={e => setPw({ ...pw, old: e.target.value })} /></Field>
            <Field label="New password"><input type="password" className={inputCls} value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} /></Field>
          </div>
          <Btn className="mt-3" kind="soft" onClick={() => { if (run(() => engine.changeOwnPassword(user, pw.old, pw.next), 'Password changed.')) setPw({ old: '', next: '' }); }}>Change password</Btn>
        </Card>
        <Card title="⚠ Danger zone">
          <p className="text-sm text-slate-500 mb-3">Clear all business data (medicines, sales, purchases…) but keep user accounts. Take a backup first — this cannot be undone.</p>
          <Btn kind="danger" onClick={() => setConfirmClear(true)}>Clear all business data</Btn>
        </Card>
      </div>
      {confirmClear && <Confirm text="This permanently deletes ALL medicines, stock, sales, purchases and ledgers. Users and settings are kept. Continue?" onNo={() => setConfirmClear(false)} onYes={() => { run(() => engine.clearAllData(user, true), 'All business data cleared.'); setConfirmClear(false); }} />}
    </Page>
  );
}
