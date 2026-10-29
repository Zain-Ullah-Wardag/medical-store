import { useEffect, useState } from 'react';
import { engine, useDbVersion, loadSession, saveSession } from './lib/store';
import { Btn, Field, inputCls, ToastHost, toast } from './components/ui';
import type { SessionUser } from './core/types';
import { can } from './core/types';
import { Dashboard } from './pages/Dashboard';
import { POS } from './pages/POS';
import { Medicines, Inventory, Categories } from './pages/Catalog';
import { Purchases, Suppliers } from './pages/Purchasing';
import { SalesHistory, SalesReturns, PurchaseReturns } from './pages/SalesOps';
import { Customers, LedgerPage } from './pages/Parties';
import { Expenses, CashManagement } from './pages/Finance';
import { Reports } from './pages/Reports';
import { Users, AuditLogs, Backup, SettingsPage } from './pages/Admin';

type PageKey = 'dashboard' | 'pos' | 'medicines' | 'inventory' | 'categories' | 'suppliers' | 'purchases' | 'sales' | 'salesReturns' | 'purchaseReturns' | 'customers' | 'custLedger' | 'suppLedger' | 'expenses' | 'cash' | 'reports' | 'users' | 'audit' | 'backup' | 'settings';

const NAV: { key: PageKey; label: string; icon: string; perm: string }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: '🏠', perm: 'dashboard.basic' },
  { key: 'pos', label: 'Point of Sale', icon: '🧾', perm: 'pos' },
  { key: 'medicines', label: 'Medicines', icon: '💊', perm: 'medicines.view' },
  { key: 'inventory', label: 'Inventory', icon: '📦', perm: 'inventory.view' },
  { key: 'categories', label: 'Categories', icon: '🗂️', perm: 'categories.edit' },
  { key: 'suppliers', label: 'Suppliers', icon: '🚚', perm: 'suppliers.view' },
  { key: 'purchases', label: 'Purchases', icon: '🛒', perm: 'purchases.view' },
  { key: 'sales', label: 'Sales History', icon: '📜', perm: 'sales.view.own' },
  { key: 'salesReturns', label: 'Sales Returns', icon: '↩️', perm: 'sales.return' },
  { key: 'purchaseReturns', label: 'Purchase Returns', icon: '📤', perm: 'purchase.return' },
  { key: 'customers', label: 'Customers', icon: '👥', perm: 'customers.view' },
  { key: 'custLedger', label: 'Customer Ledger', icon: '📒', perm: 'ledgers.view' },
  { key: 'suppLedger', label: 'Supplier Ledger', icon: '📓', perm: 'ledgers.view' },
  { key: 'expenses', label: 'Expenses', icon: '💸', perm: 'expenses.view' },
  { key: 'cash', label: 'Cash Management', icon: '💵', perm: 'cash.view' },
  { key: 'reports', label: 'Reports', icon: '📊', perm: 'reports.view' },
  { key: 'users', label: 'Users & Permissions', icon: '🔐', perm: 'users.manage' },
  { key: 'audit', label: 'Audit Logs', icon: '🕵️', perm: 'audit.view' },
  { key: 'backup', label: 'Backup & Restore', icon: '💾', perm: 'backup.restore' },
  { key: 'settings', label: 'Settings', icon: '⚙️', perm: 'settings.edit' },
];

export default function App() {
  useDbVersion();
  const db = engine.db;
  const [user, setUser] = useState<SessionUser | null>(() => loadSession());
  const [page, setPage] = useState<PageKey>('dashboard');
  const [ledgerParty, setLedgerParty] = useState<number | undefined>(undefined);
  const [dark, setDark] = useState(() => localStorage.getItem('medstore-dark') === '1');
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('medstore-dark', dark ? '1' : '0');
  }, [dark]);

  const doLogout = () => { if (user) { try { engine.logout(user); } catch { /* ignore */ } } saveSession(null); setUser(null); };
  const onLogin = (u: SessionUser) => { saveSession(u); setUser(u); setPage('dashboard'); };

  if (db.users.length === 0) return <><SetupWizard onDone={onLogin} /><ToastHost /></>;
  if (!user) return <><Login onLogin={onLogin} /><ToastHost /></>;

  const visibleNav = NAV.filter(n => can(user.role, n.perm) || can(user.role, n.perm.replace('.own', '')) || (n.key === 'salesReturns' && user.role === 'cashier' && db.settings.allowCashierReturns));
  const alerts = engine.alerts();
  const alertCount = alerts.expired.length + alerts.nearExpiry.length + alerts.lowStock.length;

  const go = (p: string) => { setPage(p as PageKey); setMobileNav(false); };

  const content = (() => {
    switch (page) {
      case 'dashboard': return <Dashboard user={user} go={go} />;
      case 'pos': return <POS user={user} />;
      case 'medicines': return <Medicines user={user} />;
      case 'inventory': return <Inventory user={user} />;
      case 'categories': return <Categories user={user} />;
      case 'suppliers': return <Suppliers user={user} goLedger={id => { setLedgerParty(id); go('suppLedger'); }} />;
      case 'purchases': return <Purchases user={user} />;
      case 'sales': return <SalesHistory user={user} />;
      case 'salesReturns': return <SalesReturns user={user} />;
      case 'purchaseReturns': return <PurchaseReturns user={user} />;
      case 'customers': return <Customers user={user} goLedger={id => { setLedgerParty(id); go('custLedger'); }} />;
      case 'custLedger': return <LedgerPage kind="customer" preselect={ledgerParty} user={user} />;
      case 'suppLedger': return <LedgerPage kind="supplier" preselect={ledgerParty} user={user} />;
      case 'expenses': return <Expenses user={user} />;
      case 'cash': return <CashManagement user={user} />;
      case 'reports': return <Reports user={user} />;
      case 'users': return <Users user={user} />;
      case 'audit': return <AuditLogs />;
      case 'backup': return <Backup user={user} />;
      case 'settings': return <SettingsPage user={user} dark={dark} setDark={setDark} />;
      default: return <Dashboard user={user} go={go} />;
    }
  })();

  return (
    <div className="h-screen flex bg-slate-50 dark:bg-slate-900 overflow-hidden">
      {/* Sidebar — fixed, own scroll */}
      <aside className={`${mobileNav ? 'fixed inset-y-0 left-0 z-40' : 'hidden'} md:flex md:static w-64 shrink-0 bg-teal-800 dark:bg-slate-950 text-white flex-col`}>
        <div className="px-4 py-4 border-b border-white/10">
          <div className="text-lg font-extrabold leading-tight">⚕ MedStore Manager</div>
          <div className="text-xs text-teal-100/70 truncate">{db.settings.storeName}</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {visibleNav.map(n => (
            <button key={n.key} onClick={() => go(n.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-left transition ${page === n.key ? 'bg-white text-teal-800 shadow' : 'hover:bg-white/10 text-teal-50'}`}>
              <span>{n.icon}</span><span className="flex-1">{n.label}</span>
              {n.key === 'inventory' && alertCount > 0 && <span className="bg-red-500 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full">{alertCount}</span>}
            </button>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-white/10 text-xs text-teal-100/70">Offline · v1.0 · PKR</div>
      </aside>
      {mobileNav && <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={() => setMobileNav(false)} />}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3 px-4 no-print">
          <button className="md:hidden text-2xl" onClick={() => setMobileNav(true)} aria-label="Open menu">☰</button>
          <div className="font-semibold text-slate-700 dark:text-slate-200 truncate">{NAV.find(n => n.key === page)?.label}</div>
          <div className="flex-1" />
          <button onClick={() => go('pos')} className="hidden sm:block bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg">🧾 New Sale</button>
          <button onClick={() => setDark(!dark)} className="text-lg" title="Toggle dark mode">{dark ? '☀️' : '🌙'}</button>
          <div className="text-right leading-tight">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{user.fullName}</div>
            <div className="text-[11px] text-slate-400 capitalize">{user.role === 'admin' ? 'Owner/Admin' : user.role}</div>
          </div>
          <button onClick={doLogout} className="text-sm font-semibold text-red-500 hover:text-red-600">Logout</button>
        </header>
        {/* Only content scrolls */}
        <main className="flex-1 overflow-y-auto">{content}</main>
      </div>
      <ToastHost />
    </div>
  );
}

function SetupWizard({ onDone }: { onDone: (u: SessionUser) => void }) {
  const [f, setF] = useState({ storeName: '', address: '', phone: '', fullName: '', username: 'admin', password: '', confirm: '', seed: true });
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  const submit = () => {
    if (f.password !== f.confirm) { toast('Passwords do not match.', true); return; }
    try {
      const u = engine.setupAdmin({ storeName: f.storeName, address: f.address, phone: f.phone, fullName: f.fullName, username: f.username, password: f.password, seedSample: f.seed });
      toast('Setup complete — welcome to MedStore Manager!');
      onDone(u);
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-700 to-teal-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-xl p-6 md:p-8">
        <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">⚕ Welcome to MedStore Manager</h1>
        <p className="text-sm text-slate-500 mt-1 mb-5">First-time setup (one minute). This creates your store profile and the <b>owner/admin</b> account. There is no default password — you choose it, and it is stored only as a secure hash.</p>
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Store name *"><input className={inputCls} value={f.storeName} onChange={e => set('storeName', e.target.value)} placeholder="e.g. Al-Noor Medical Store" /></Field>
          <Field label="Phone"><input className={inputCls} value={f.phone} onChange={e => set('phone', e.target.value)} /></Field>
          <div className="md:col-span-2"><Field label="Store address"><input className={inputCls} value={f.address} onChange={e => set('address', e.target.value)} placeholder="Main Bazaar Road, Mardan" /></Field></div>
          <Field label="Your full name *"><input className={inputCls} value={f.fullName} onChange={e => set('fullName', e.target.value)} /></Field>
          <Field label="Admin username *"><input className={inputCls} value={f.username} onChange={e => set('username', e.target.value)} /></Field>
          <Field label="Password * (min 6)"><input type="password" className={inputCls} value={f.password} onChange={e => set('password', e.target.value)} /></Field>
          <Field label="Confirm password *"><input type="password" className={inputCls} value={f.confirm} onChange={e => set('confirm', e.target.value)} /></Field>
        </div>
        <label className="flex items-start gap-2 text-sm mt-4 text-slate-600 dark:text-slate-300">
          <input type="checkbox" className="mt-0.5" checked={f.seed} onChange={e => set('seed', e.target.checked)} />
          Add a small <b>sample catalog</b> (Panadol, Augmentin… with sample batches, incl. one expired batch so you can see the safety blocks). You can clear it later in Settings → Danger zone.
        </label>
        <Btn className="w-full mt-5 !py-3" onClick={submit}>Create my store →</Btn>
      </div>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try { onLogin(engine.login(username, password)); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-700 to-teal-900 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-7">
        <div className="text-center mb-5">
          <div className="text-4xl mb-1">⚕</div>
          <h1 className="text-xl font-extrabold text-slate-800 dark:text-white">MedStore Manager</h1>
          <p className="text-sm text-slate-400">{engine.db.settings.storeName} — sign in to continue</p>
        </div>
        <div className="space-y-3">
          <Field label="Username"><input className={inputCls} value={username} onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username" /></Field>
          <Field label="Password"><input type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        </div>
        <Btn type="submit" className="w-full mt-5 !py-3">Login</Btn>
        <p className="text-[11px] text-slate-400 text-center mt-4">Works 100% offline. Your data never leaves this computer.</p>
      </form>
    </div>
  );
}
