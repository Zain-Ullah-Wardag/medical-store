import { useRef, useState } from 'react';
import { engine, isTauri, backupSqliteFile, databaseInfo } from '../lib/store';
import { defaultScannerSettings, type ScanResolution } from '../core/engine';
import { parseScan } from '../core/scanner';
import { beepSuccess, beepError } from '../lib/beep';
import { Page, Card, Btn, Modal, Field, inputCls, Table, Badge, Empty, run, toast, fmtDateTime, ExportBtn, downloadFile, Confirm, medLabel } from '../components/ui';
import { todayStr } from '../core/money';
import type { Role, SessionUser, Settings, ScannerSettings } from '../core/types';
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
      actions={<ExportBtn filename="audit-log.csv" headerLine={`${engine.db.settings.storeName} — Audit logs — generated ${new Date().toLocaleString('en-PK')}`} rows={rows.map(a => ({ When: a.dateTime, User: a.username, Action: a.action, Details: a.details }))} />}>
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
  const [sqliteBusy, setSqliteBusy] = useState(false); const [sqlitePath, setSqlitePath] = useState('');
  const [dbInfo, setDbInfo] = useState<{ databasePath: string; sqliteVersion: string } | null>(null);
  const lastBackup = engine.db.settings.lastBackupAt;
  const doBackup = () => {
    downloadFile(`medstore-backup-${todayStr()}-${Date.now() % 100000}.json`, engine.exportBackup(), 'application/json');
    run(() => engine.markBackupDone(user));
    toast('Backup (JSON) downloaded. Save a copy on a USB drive too.');
  };
  const doSqliteBackup = async () => {
    setSqliteBusy(true);
    try {
      const res = await backupSqliteFile();
      const [path, msg] = res.split('|');
      setSqlitePath(path);
      run(() => engine.markBackupDone(user));
      toast(`SQLite .db backup saved — ${msg || path}`);
    } catch (e: any) { toast('SQLite backup failed: ' + (e?.message ?? e), true); }
    setSqliteBusy(false);
  };
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
          <p className="text-sm text-slate-500 mb-3">Two backup forms, both restorable: a portable <b>JSON export</b> (restore from this page) and, in the Windows app, a verified <b>SQLite .db</b> copy. Recommended: back up at daily closing and keep a copy on USB.</p>
          <p className="text-sm mb-3">Last backup: {lastBackup ? <b>{new Date(lastBackup).toLocaleString('en-PK')}</b> : <b className="text-red-500">none recorded — back up now</b>}</p>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={doBackup}>⬇ Download JSON backup</Btn>
            {isTauri
              ? <Btn kind="soft" disabled={sqliteBusy} onClick={doSqliteBackup}>{sqliteBusy ? 'Creating .db…' : '💾 Create SQLite .db backup'}</Btn>
              : <Btn kind="ghost" disabled>💾 SQLite .db backup (Windows app only)</Btn>}
            {isTauri && <Btn kind="ghost" onClick={async () => setDbInfo(await databaseInfo())}>Show database location</Btn>}
          </div>
          {sqlitePath && <p className="text-xs text-teal-600 mt-2 break-all">Saved to: {sqlitePath}<br />Copy this file to a USB drive for safekeeping.</p>}
          {dbInfo && <p className="text-xs text-slate-400 mt-2 break-all">Live database: {dbInfo.databasePath} · SQLite {dbInfo.sqliteVersion}</p>}
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

/** Live scanner test: shows exactly how the app interprets a scan. */
function ScannerTest() {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<ScanResolution | null>(null);
  // Build the GS1 demo from the ACTUAL recorded batch expiry (a code whose
  // batch/expiry disagrees with stock records is correctly BLOCKED now).
  const demoBatch = engine.db.batches.find(b => b.status === 'active' && engine.db.medicineBarcodes.some(mb => mb.medicineId === b.medicineId && mb.barcode === '8964001234500'))
    ?? engine.db.batches.find(b => b.batchNo === 'PN-2401');
  const SAMPLE = demoBatch
    ? `(01)08964001234500(17)${demoBatch.expiryDate.slice(2, 4)}${demoBatch.expiryDate.slice(5, 7)}${demoBatch.expiryDate.slice(8, 10)}(10)${demoBatch.batchNo}(21)SN001`
    : '(01)08964001234500(17)271231(10)PN-2401(21)SN001';
  const test = (raw: string) => {
    if (!raw.trim()) return;
    const r = engine.resolveScan(raw);
    setResult(r);
    if (engine.db.settings.scanner.beepOnSuccess && r.status === 'found') beepSuccess();
    if (engine.db.settings.scanner.beepOnError && r.status !== 'found') beepError();
    setValue('');
  };
  const p = result?.parsed;
  return (
    <div className="border-t border-dashed border-slate-200 dark:border-slate-600 pt-3">
      <Field label="🧪 Test scanner input — click here and scan any medicine">
        <input className={inputCls} value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); test(value); } }}
          placeholder="Scan a barcode, QR or GS1 DataMatrix…" />
      </Field>
      {result && p && (
        <div className={`mt-2 rounded-lg px-3 py-2 text-xs space-y-1 ${result.status === 'found' ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-900 dark:text-teal-100' : 'bg-red-50 dark:bg-red-900/30 text-red-900 dark:text-red-100'}`}>
          <div><b>Result:</b> {result.status.toUpperCase()} — {result.message}</div>
          <div><b>Format:</b> {p.format} · <b>Lookup code:</b> <span className="font-mono">{p.code || '—'}</span> · <b>Check digit:</b> {p.checkDigitValid === null ? 'n/a' : p.checkDigitValid ? 'valid ✓' : 'INVALID ⚠'}</div>
          {p.gs1 && <div><b>GS1:</b> GTIN {p.gs1.gtin ?? '—'} · Batch {p.gs1.batchNo ?? '—'} · Expiry {p.gs1.expiryDate ?? '—'} · Serial {p.gs1.serial ?? '—'}</div>}
          {result.status === 'found' && <div><b>Would add:</b> {result.baseQtyPerScan} base unit(s) · <b>Packaging:</b> {result.packagingLabel} · <b>Batch:</b> {result.matchedBatch ? `${result.matchedBatch.batchNo} (exp ${result.matchedBatch.expiryDate})` : 'FEFO (no batch in code)'}</div>}
          {result.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Btn kind="soft" onClick={() => test(SAMPLE)}>▶ Run sample GS1 test</Btn>
        <Btn kind="ghost" onClick={() => { const parsed = parseScan(SAMPLE); toast(`Parsed kind=${parsed.kind}, GTIN=${parsed.gs1?.gtin}`); }}>Parser only</Btn>
        <span className="text-[11px] text-slate-400 font-mono break-all">{SAMPLE}</span>
      </div>
      <p className="text-[11px] text-slate-400 mt-1.5">The sample is generated from your actual recorded batch{demoBatch ? ` ${demoBatch.batchNo} (expiry ${demoBatch.expiryDate})` : ''}. A GS1 code whose batch or expiry disagrees with stock records is <b>blocked</b> — the app never substitutes another batch.</p>
    </div>
  );
}

export function SettingsPage({ user, dark, setDark }: { user: SessionUser; dark: boolean; setDark: (v: boolean) => void }) {
  const s = engine.db.settings;
  const [f, setF] = useState<Settings>({ ...s, scanner: { ...defaultScannerSettings(), ...s.scanner } });
  const [sc, setSc] = useState<ScannerSettings>({ ...defaultScannerSettings(), ...s.scanner });
  const setScKey = (k: keyof ScannerSettings, v: any) => setSc(x => ({ ...x, [k]: v }));
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
          <Btn className="mt-4" onClick={() => run(() => engine.updateSettings(user, { ...f, scanner: sc }), 'Settings saved.')}>Save settings</Btn>
        </Card>
        <Card title="🔫 Barcode & Scanner">
          <div className="space-y-3 text-sm">
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={sc.enabled} onChange={e => setScKey('enabled', e.target.checked)} /> Scanner enabled</label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Scanner input mode"><select className={inputCls} value={sc.inputMode} onChange={e => setScKey('inputMode', e.target.value)}>
                <option value="dedicated">Dedicated POS barcode box only</option>
                <option value="wedge-anywhere">Keyboard-wedge anywhere on POS</option>
                <option value="both">Both (recommended)</option></select></Field>
              <Field label="Scan suffix sent by scanner"><select className={inputCls} value={sc.suffix} onChange={e => setScKey('suffix', e.target.value)}>
                <option value="enter">Enter</option><option value="tab">Tab</option><option value="both">Enter or Tab</option></select></Field>
              <Field label="Default quantity per scan (packages)"><input type="number" min={1} className={inputCls} value={sc.defaultScanQty} onChange={e => setScKey('defaultScanQty', Math.max(1, parseInt(e.target.value) || 1))} /></Field>
              <Field label="Unknown barcode behaviour"><select className={inputCls} value={sc.unknownBehavior} onChange={e => setScKey('unknownBehavior', e.target.value)}>
                <option value="prompt">Warn + offer registration</option><option value="warn-only">Warn only</option></select></Field>
              <Field label="Duplicate-scan guard window (ms)"><input type="number" min={0} max={3000} step={50} className={inputCls} value={sc.rapidDuplicateWindowMs} onChange={e => setScKey('rapidDuplicateWindowMs', Math.max(0, parseInt(e.target.value) || 0))} /></Field>
              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2"><input type="checkbox" checked={sc.autoDetectWedge} onChange={e => setScKey('autoDetectWedge', e.target.checked)} /> Automatic scanner detection (fast typing bursts)</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={sc.beepOnSuccess} onChange={e => setScKey('beepOnSuccess', e.target.checked)} /> Beep on successful scan</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={sc.beepOnError} onChange={e => setScKey('beepOnError', e.target.checked)} /> Buzz on unknown / blocked scan</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={sc.cameraEnabled} onChange={e => setScKey('cameraEnabled', e.target.checked)} /> Allow camera scanning (📷 in POS, if device supports it)</label>
              </div>
            </div>
            <p className="text-xs text-slate-400">The guard window treats identical codes arriving within that time as ONE physical scan (some scanners or key handlers double-fire). Deliberate repeat scans after the window increase quantity normally. Settings are stored in the application database (SQLite in the Windows build) and included in backups.</p>
            <Btn onClick={() => run(() => engine.updateSettings(user, { scanner: sc }), 'Scanner settings saved.')}>Save scanner settings</Btn>
            <ScannerTest />
          </div>
        </Card>
        <Card title="🏷 Barcode registry (all medicines)">
          <p className="text-xs text-slate-400 mb-2">Every registered barcode. To add/edit packaging levels, open the medicine under <b>Medicines → View → Barcodes &amp; packaging</b>. New barcodes can also be registered from POS when an unknown code is scanned.</p>
          {engine.db.medicineBarcodes.length === 0 ? <Empty text="No barcodes registered yet." /> : (
            <Table head={['Medicine', 'Barcode', 'Packaging', 'Units/pkg', 'Primary', 'Active']}>
              {engine.db.medicineBarcodes.map(r => { const m = engine.db.medicines.find(x => x.id === r.medicineId); return <tr key={r.id} className={r.active ? '' : 'opacity-50'}>
                <td>{m ? medLabel(m) : '—'}</td><td className="font-mono text-xs">{r.barcode}</td><td>{r.packagingLevel}</td><td>{r.unitsPerPackage}</td>
                <td>{r.isPrimary ? <Badge color="blue">primary</Badge> : '—'}</td><td>{r.active ? <Badge color="green">On</Badge> : <Badge>Off</Badge>}</td></tr>; })}
            </Table>
          )}
        </Card>
        <Card title="Change my password">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Current password *"><input type="password" className={inputCls} value={pw.old} onChange={e => setPw({ ...pw, old: e.target.value })} /></Field>
            <Field label="New password * (min 6 characters)"><input type="password" className={inputCls} value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} /></Field>
          </div>
          {(!pw.old || pw.next.length < 6) && (pw.old || pw.next) && <p className="text-sm text-red-500 mt-2">{!pw.old ? 'Enter your current password.' : pw.next.length < 6 ? 'New password must be at least 6 characters.' : ''}</p>}
          <Btn className="mt-3" kind="soft" disabled={!pw.old || !pw.next} onClick={() => { if (run(() => engine.changeOwnPassword(user, pw.old, pw.next), 'Password changed.')) setPw({ old: '', next: '' }); }}>Change password</Btn>
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
