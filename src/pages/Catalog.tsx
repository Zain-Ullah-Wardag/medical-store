import { useMemo, useState } from 'react';
import { engine } from '../lib/store';
import { Page, Card, Btn, Modal, Field, inputCls, money, toast, Table, Badge, Empty, run, Confirm, fmtDate } from '../components/ui';
import { toPaisa, todayStr, addDays, daysBetween } from '../core/money';
import type { Batch, Medicine, SessionUser } from '../core/types';
import { can } from '../core/types';

const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Cream/Ointment', 'Drops', 'Inhaler', 'Sachet', 'Other'];

function MedicineForm({ user, med, close }: { user: SessionUser; med?: Medicine; close: () => void }) {
  const db = engine.db;
  const [f, setF] = useState({
    name: med?.name ?? '', genericName: med?.genericName ?? '', brandName: med?.brandName ?? '', barcode: med?.barcode ?? '',
    categoryId: String(med?.categoryId ?? ''), manufacturer: med?.manufacturer ?? '', strength: med?.strength ?? '',
    dosageForm: med?.dosageForm ?? 'Tablet', packSize: med?.packSize ?? '', unit: med?.unit ?? 'strip',
    costRs: String((med?.defaultCostPaisa ?? 0) / 100 || ''), priceRs: String((med?.retailPricePaisa ?? 0) / 100 || ''),
    minStock: String(med?.minStock ?? 10), prescription: med?.prescription ?? 'OTC', storage: med?.storage ?? '',
    notes: med?.notes ?? '', active: med?.active ?? true,
  });
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  const similar = useMemo(() => engine.similarMedicines(f.name, med?.id), [f.name]);
  const save = () => {
    const ok = run(() => engine.saveMedicine(user, {
      id: med?.id, name: f.name, genericName: f.genericName, brandName: f.brandName, barcode: f.barcode,
      categoryId: f.categoryId ? Number(f.categoryId) : null, manufacturer: f.manufacturer, strength: f.strength,
      dosageForm: f.dosageForm, packSize: f.packSize, unit: f.unit, defaultCostPaisa: toPaisa(f.costRs || 0),
      retailPricePaisa: toPaisa(f.priceRs || 0), minStock: parseInt(f.minStock) || 0,
      prescription: f.prescription as any, storage: f.storage, notes: f.notes, active: f.active,
    }), med ? 'Medicine updated.' : 'Medicine added.');
    if (ok) close();
  };
  return (
    <Modal title={med ? `Edit medicine — ${med.name}` : 'Add medicine'} onClose={close} wide>
      <div className="grid md:grid-cols-3 gap-3">
        <Field label="Medicine name *"><input className={inputCls} value={f.name} onChange={e => set('name', e.target.value)} /></Field>
        <Field label="Generic name"><input className={inputCls} value={f.genericName} onChange={e => set('genericName', e.target.value)} /></Field>
        <Field label="Brand name"><input className={inputCls} value={f.brandName} onChange={e => set('brandName', e.target.value)} /></Field>
        <Field label="Barcode (unique)"><input className={inputCls} value={f.barcode} onChange={e => set('barcode', e.target.value)} placeholder="Scan or type" /></Field>
        <Field label="Category"><select className={inputCls} value={f.categoryId} onChange={e => set('categoryId', e.target.value)}>
          <option value="">— none —</option>{db.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Manufacturer"><input className={inputCls} value={f.manufacturer} onChange={e => set('manufacturer', e.target.value)} /></Field>
        <Field label="Strength"><input className={inputCls} value={f.strength} onChange={e => set('strength', e.target.value)} placeholder="500mg" /></Field>
        <Field label="Dosage form"><select className={inputCls} value={f.dosageForm} onChange={e => set('dosageForm', e.target.value)}>{FORMS.map(x => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Pack size"><input className={inputCls} value={f.packSize} onChange={e => set('packSize', e.target.value)} placeholder="10 tablets/strip" /></Field>
        <Field label="Unit"><input className={inputCls} value={f.unit} onChange={e => set('unit', e.target.value)} /></Field>
        <Field label="Default cost (Rs)"><input type="number" className={inputCls} value={f.costRs} onChange={e => set('costRs', e.target.value)} /></Field>
        <Field label="Retail price (Rs)"><input type="number" className={inputCls} value={f.priceRs} onChange={e => set('priceRs', e.target.value)} /></Field>
        <Field label="Minimum stock alert"><input type="number" className={inputCls} value={f.minStock} onChange={e => set('minStock', e.target.value)} /></Field>
        <Field label="Classification"><select className={inputCls} value={f.prescription} onChange={e => set('prescription', e.target.value)}>
          <option value="OTC">OTC (no prescription)</option><option value="Rx">Rx (prescription required)</option><option value="Controlled">Controlled</option></select></Field>
        <Field label="Storage"><input className={inputCls} value={f.storage} onChange={e => set('storage', e.target.value)} /></Field>
        <div className="md:col-span-2"><Field label="Notes"><input className={inputCls} value={f.notes} onChange={e => set('notes', e.target.value)} /></Field></div>
        <label className="flex items-center gap-2 text-sm pt-5"><input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} /> Active (can be sold)</label>
      </div>
      {similar.length > 0 && <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
        ⚠ Possible duplicate: {similar.map(m => `${m.name} ${m.strength}`).join(', ')}. Different strength/pack size = separate product; only continue if this is genuinely different.</div>}
      <div className="flex justify-end gap-2 mt-5"><Btn kind="ghost" onClick={close}>Cancel</Btn><Btn onClick={save}>Save medicine</Btn></div>
    </Modal>
  );
}

function OpeningBatchForm({ user, med, close }: { user: SessionUser; med: Medicine; close: () => void }) {
  const [f, setF] = useState({ batchNo: '', expiry: '', mfg: '', qty: '', costRs: String(med.defaultCostPaisa / 100 || ''), sellRs: String(med.retailPricePaisa / 100 || '') });
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  return (
    <Modal title={`Add opening stock — ${med.name}`} onClose={close}>
      <p className="text-sm text-slate-500 mb-3">Use this for stock already on the shelf. For new supplier deliveries, use Purchases instead so supplier balances stay correct.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Batch / lot number *"><input className={inputCls} value={f.batchNo} onChange={e => set('batchNo', e.target.value)} /></Field>
        <Field label="Quantity *"><input type="number" className={inputCls} value={f.qty} onChange={e => set('qty', e.target.value)} /></Field>
        <Field label="Manufacturing date"><input type="date" className={inputCls} value={f.mfg} onChange={e => set('mfg', e.target.value)} /></Field>
        <Field label="Expiry date *"><input type="date" className={inputCls} value={f.expiry} onChange={e => set('expiry', e.target.value)} /></Field>
        <Field label="Cost per unit (Rs)"><input type="number" className={inputCls} value={f.costRs} onChange={e => set('costRs', e.target.value)} /></Field>
        <Field label="Selling price (Rs)"><input type="number" className={inputCls} value={f.sellRs} onChange={e => set('sellRs', e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2 mt-5"><Btn kind="ghost" onClick={close}>Cancel</Btn>
        <Btn onClick={() => { if (run(() => engine.addOpeningBatch(user, { medicineId: med.id, batchNo: f.batchNo, expiryDate: f.expiry, mfgDate: f.mfg, qty: parseInt(f.qty) || 0, costPaisa: toPaisa(f.costRs || 0), sellPricePaisa: toPaisa(f.sellRs || 0) }), 'Stock added.')) close(); }}>Add stock</Btn></div>
    </Modal>
  );
}

export function Medicines({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [q, setQ] = useState(''); const [catId, setCatId] = useState(''); const [status, setStatus] = useState('all');
  const [form, setForm] = useState<Medicine | 'new' | null>(null);
  const [stockFor, setStockFor] = useState<Medicine | null>(null);
  const [detail, setDetail] = useState<Medicine | null>(null);
  const canEdit = can(user.role, 'medicines.edit');
  const rows = db.medicines.filter(m => {
    const s = q.trim().toLowerCase();
    if (s && !(m.name.toLowerCase().includes(s) || m.genericName.toLowerCase().includes(s) || m.brandName.toLowerCase().includes(s) || m.barcode === s)) return false;
    if (catId && String(m.categoryId ?? '') !== catId) return false;
    if (status === 'active' && !m.active) return false;
    if (status === 'inactive' && m.active) return false;
    return true;
  });
  return (
    <Page title="Medicines" sub="Catalog — each strength/pack size is its own product. Barcodes are unique."
      actions={canEdit && <Btn onClick={() => setForm('new')}>+ Add medicine</Btn>}>
      <Card>
        <div className="grid md:grid-cols-3 gap-3 mb-3">
          <input className={inputCls} placeholder="Search name, generic, brand or scan barcode…" value={q} onChange={e => setQ(e.target.value)} />
          <select className={inputCls} value={catId} onChange={e => setCatId(e.target.value)}><option value="">All categories</option>{db.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className={inputCls} value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive/archived</option></select>
        </div>
        {rows.length === 0 ? <Empty text="No medicines match. Add your first medicine to start." action={canEdit && <Btn onClick={() => setForm('new')}>+ Add medicine</Btn>} /> : (
          <Table head={['Medicine', 'Barcode', 'Category', 'Saleable stock', 'Retail price', 'Status', 'Actions']}>
            {rows.map(m => {
              const st = engine.saleableStock(m.id);
              return <tr key={m.id}>
                <td><b>{m.name} {m.strength}</b><span className="block text-xs text-slate-400">{m.genericName} · {m.dosageForm} · {m.packSize}{m.prescription !== 'OTC' ? ` · ${m.prescription}` : ''}</span></td>
                <td className="font-mono text-xs">{m.barcode || '—'}</td>
                <td>{db.categories.find(c => c.id === m.categoryId)?.name ?? '—'}</td>
                <td>{st <= m.minStock ? <Badge color="amber">{st} (low)</Badge> : <Badge color="green">{st}</Badge>}</td>
                <td className="font-semibold">{money(m.retailPricePaisa)}</td>
                <td>{m.active ? <Badge color="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                <td><div className="flex gap-1.5 whitespace-nowrap">
                  <Btn kind="soft" onClick={() => setDetail(m)}>View</Btn>
                  {canEdit && <Btn kind="ghost" onClick={() => setForm(m)}>Edit</Btn>}
                  {can(user.role, 'inventory.adjust') && <Btn kind="ghost" onClick={() => setStockFor(m)}>+ Stock</Btn>}
                </div></td>
              </tr>;
            })}
          </Table>
        )}
      </Card>
      {form && <MedicineForm user={user} med={form === 'new' ? undefined : form} close={() => setForm(null)} />}
      {stockFor && <OpeningBatchForm user={user} med={stockFor} close={() => setStockFor(null)} />}
      {detail && (
        <Modal title={`${detail.name} ${detail.strength}`} onClose={() => setDetail(null)} wide>
          <MedicineDetail med={detail} />
        </Modal>
      )}
    </Page>
  );
}

function MedicineDetail({ med }: { med: Medicine }) {
  const db = engine.db;
  const batches = db.batches.filter(b => b.medicineId === med.id).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const sold = db.saleItems.filter(i => i.medicineId === med.id).reduce((s, i) => s + i.qty, 0);
  const purchased = db.purchaseItems.filter(i => i.medicineId === med.id).reduce((s, i) => s + i.qty, 0);
  const moves = db.movements.filter(m => m.medicineId === med.id).slice(-12).reverse();
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-slate-600 dark:text-slate-300">
        <span>Generic: <b>{med.genericName || '—'}</b></span><span>Manufacturer: <b>{med.manufacturer || '—'}</b></span>
        <span>Sold (all time): <b>{sold}</b></span><span>Purchased: <b>{purchased}</b></span>
      </div>
      <div>
        <div className="font-semibold mb-1">Batches (FEFO order)</div>
        {batches.length === 0 ? <Empty text="No batches yet." /> : (
          <Table head={['Batch', 'Expiry', 'Received', 'Remaining', 'Cost', 'Status']}>
            {batches.map(b => <tr key={b.id}><td>{b.batchNo}</td><td>{fmtDate(b.expiryDate)}{engine.isExpired(b) && <Badge color="red"> expired</Badge>}</td><td>{b.qtyReceived}</td><td className="font-semibold">{b.qtyRemaining}</td><td>{money(b.costPaisa)}</td><td><BatchStatusBadge b={b} /></td></tr>)}
          </Table>
        )}
      </div>
      <div>
        <div className="font-semibold mb-1">Recent stock movements</div>
        {moves.length === 0 ? <Empty text="No movements." /> : (
          <Table head={['When', 'Type', 'Qty', 'Reference', 'Reason']}>
            {moves.map(m => <tr key={m.id}><td>{m.dateTime.slice(0, 16).replace('T', ' ')}</td><td>{m.type}</td><td className={m.qty < 0 ? 'text-red-500' : 'text-teal-600'}>{m.qty > 0 ? '+' : ''}{m.qty}</td><td>{m.reference}</td><td>{m.reason}</td></tr>)}
          </Table>
        )}
      </div>
    </div>
  );
}

export function BatchStatusBadge({ b }: { b: Batch }) {
  if (b.status === 'active' && engine.isExpired(b)) return <Badge color="red">Expired</Badge>;
  if (b.status === 'active') return <Badge color="green">Saleable</Badge>;
  const map: Record<string, any> = { quarantine: 'amber', damaged: 'red', recalled: 'red', written_off: 'slate' };
  return <Badge color={map[b.status] ?? 'slate'}>{b.status.replace('_', ' ')}</Badge>;
}

export function Inventory({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [view, setView] = useState<'saleable' | 'near' | 'expired' | 'held' | 'low' | 'all'>('saleable');
  const [q, setQ] = useState('');
  const [adjust, setAdjust] = useState<Batch | null>(null);
  const on = todayStr(); const warnTo = addDays(on, db.settings.expiryWarnDays);
  const canAdjust = can(user.role, 'inventory.adjust');
  let batches = db.batches;
  if (view === 'saleable') batches = batches.filter(b => b.status === 'active' && !engine.isExpired(b));
  if (view === 'near') batches = batches.filter(b => b.status === 'active' && b.qtyRemaining > 0 && b.expiryDate > on && b.expiryDate <= warnTo);
  if (view === 'expired') batches = batches.filter(b => b.status === 'active' && b.qtyRemaining > 0 && engine.isExpired(b));
  if (view === 'held') batches = batches.filter(b => b.status !== 'active');
  if (q) batches = batches.filter(b => engine.medicine(b.medicineId).name.toLowerCase().includes(q.toLowerCase()) || b.batchNo.toLowerCase().includes(q.toLowerCase()));
  const lowMeds = db.medicines.filter(m => m.active && engine.saleableStock(m.id) <= m.minStock);
  const tabs: [typeof view, string][] = [['saleable', '✅ Saleable'], ['near', '⏳ Near expiry'], ['expired', '⛔ Expired'], ['held', '🚧 Quarantine/Damaged'], ['low', '📉 Low stock'], ['all', 'All batches']];
  return (
    <Page title="Inventory" sub="Batch-wise stock with FEFO. Expired/quarantined/damaged batches can never be sold.">
      <div className="flex gap-2 flex-wrap mb-3">
        {tabs.map(([k, label]) => <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 rounded-full text-sm font-semibold ${view === k ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600'}`}>{label}</button>)}
      </div>
      <Card>
        {view === 'low' ? (
          lowMeds.length === 0 ? <Empty text="No low-stock medicines. 🎉" /> : (
            <Table head={['Medicine', 'Saleable stock', 'Minimum', 'Suggested action']}>
              {lowMeds.map(m => <tr key={m.id}><td><b>{m.name} {m.strength}</b></td><td><Badge color="amber">{engine.saleableStock(m.id)}</Badge></td><td>{m.minStock}</td><td>Reorder from supplier</td></tr>)}
            </Table>)
        ) : (
          <>
            <input className={inputCls + ' mb-3'} placeholder="Filter by medicine or batch number…" value={q} onChange={e => setQ(e.target.value)} />
            {batches.length === 0 ? <Empty text="No batches in this view." /> : (
              <Table head={['Medicine', 'Batch', 'Expiry', 'Remaining', 'Cost', 'Value', 'Status', '']}>
                {[...batches].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)).map(b => {
                  const m = engine.medicine(b.medicineId); const days = daysBetween(on, b.expiryDate);
                  return <tr key={b.id}>
                    <td><b>{m.name} {m.strength}</b></td><td>{b.batchNo}</td>
                    <td>{fmtDate(b.expiryDate)} <span className="text-xs text-slate-400">({days < 0 ? `${-days}d ago` : `${days}d left`})</span></td>
                    <td className="font-semibold">{b.qtyRemaining}</td><td>{money(b.costPaisa)}</td><td>{money(b.qtyRemaining * b.costPaisa)}</td>
                    <td><BatchStatusBadge b={b} /></td>
                    <td>{canAdjust && <Btn kind="ghost" onClick={() => setAdjust(b)}>Adjust</Btn>}</td>
                  </tr>;
                })}
              </Table>
            )}
          </>
        )}
      </Card>
      {adjust && <AdjustForm user={user} batch={adjust} close={() => setAdjust(null)} />}
    </Page>
  );
}

function AdjustForm({ user, batch, close }: { user: SessionUser; batch: Batch; close: () => void }) {
  const [mode, setMode] = useState<'qty' | 'status'>('qty');
  const [delta, setDelta] = useState(''); const [status, setStatus] = useState(batch.status); const [reason, setReason] = useState('');
  const m = engine.medicine(batch.medicineId);
  return (
    <Modal title={`Adjust — ${m.name} · batch ${batch.batchNo}`} onClose={close}>
      <div className="text-sm text-slate-500 mb-3">Current remaining: <b>{batch.qtyRemaining}</b> · Expiry: <b>{fmtDate(batch.expiryDate)}</b>. Every adjustment records user, date and reason in the audit log. History is never edited.</div>
      <div className="flex gap-2 mb-3">
        <Btn kind={mode === 'qty' ? 'primary' : 'ghost'} onClick={() => setMode('qty')}>Quantity correction</Btn>
        <Btn kind={mode === 'status' ? 'primary' : 'ghost'} onClick={() => setMode('status')}>Change status</Btn>
      </div>
      {mode === 'qty' ? (
        <Field label="Quantity change (+ add / − remove)"><input type="number" className={inputCls} value={delta} onChange={e => setDelta(e.target.value)} placeholder="e.g. -5 for breakage found" /></Field>
      ) : (
        <Field label="New status"><select className={inputCls} value={status} onChange={e => setStatus(e.target.value as any)}>
          <option value="active">Saleable (active)</option><option value="quarantine">Quarantine (hold)</option>
          <option value="damaged">Damaged</option><option value="recalled">Recalled</option>
          <option value="written_off">Write off (expired disposal — qty goes to 0)</option></select></Field>
      )}
      <div className="mt-3"><Field label="Reason *"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Physical count 29-Oct, breakage, expired disposal…" /></Field></div>
      <div className="flex justify-end gap-2 mt-5"><Btn kind="ghost" onClick={close}>Cancel</Btn>
        <Btn kind="danger" onClick={() => {
          const ok = mode === 'qty'
            ? run(() => engine.adjustStock(user, batch.id, parseInt(delta) || 0, reason), 'Stock adjusted.')
            : run(() => engine.setBatchStatus(user, batch.id, status as any, reason), 'Batch status updated.');
          if (ok) close();
        }}>Apply adjustment</Btn></div>
    </Modal>
  );
}

export function Categories({ user }: { user: SessionUser }) {
  const db = engine.db;
  const [name, setName] = useState(''); const [editId, setEditId] = useState<number | null>(null); const [del, setDel] = useState<number | null>(null);
  const canEdit = can(user.role, 'categories.edit');
  return (
    <Page title="Categories" sub="Group medicines for faster searching and reports.">
      <Card>
        {canEdit && (
          <div className="flex gap-2 mb-4">
            <input className={inputCls} placeholder="Category name (e.g. Antibiotics)" value={name} onChange={e => setName(e.target.value)} />
            <Btn onClick={() => { if (run(() => engine.saveCategory(user, name, editId ?? undefined), editId ? 'Category updated.' : 'Category added.')) { setName(''); setEditId(null); } }}>{editId ? 'Save' : 'Add'}</Btn>
            {editId && <Btn kind="ghost" onClick={() => { setEditId(null); setName(''); }}>Cancel edit</Btn>}
          </div>
        )}
        {db.categories.length === 0 ? <Empty text="No categories yet." /> : (
          <Table head={['Category', 'Medicines', 'Actions']}>
            {db.categories.map(c => <tr key={c.id}><td className="font-semibold">{c.name}</td><td>{db.medicines.filter(m => m.categoryId === c.id).length}</td>
              <td><div className="flex gap-1.5">{canEdit && <><Btn kind="ghost" onClick={() => { setEditId(c.id); setName(c.name); }}>Edit</Btn><Btn kind="ghost" onClick={() => setDel(c.id)}>Delete</Btn></>}</div></td></tr>)}
          </Table>
        )}
      </Card>
      {del !== null && <Confirm text="Delete this category? (Only possible if no medicines use it.)" onNo={() => setDel(null)} onYes={() => { run(() => engine.deleteCategory(user, del), 'Category deleted.'); setDel(null); }} />}
    </Page>
  );
}
