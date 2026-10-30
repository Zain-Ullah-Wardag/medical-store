/**
 * MedStore Manager — business-logic engine ("backend" layer).
 *
 * Every mutating operation:
 *  1. checks the actor's permission (RBAC enforced HERE, not only in the UI),
 *  2. validates inputs and stock availability,
 *  3. runs inside tx() — a deep-clone transaction: any thrown error rolls the
 *     entire database state back, mirroring an SQLite transaction rollback,
 *  4. writes inventory movements, party-ledger entries, cash movements and an
 *     audit-log row in the SAME transaction.
 *
 * Money is always integer paisa. Stock is allocated FEFO (First Expiry, First
 * Out) from eligible batches only (status=active, qty>0, not expired).
 * See docs/FINANCIAL_RULES.md and database/migrations/001_initial.sql — the
 * in-memory tables below mirror that normalized SQLite schema 1:1, so the
 * Tauri/Rust build persists exactly the same records to SQLite.
 */
import bcrypt from 'bcryptjs';
import { toPaisa, todayStr, nowISO, addDays, percentOf } from './money';
import * as T from './types';
import { parseScan, gtinVariants, type ParsedScan } from './scanner';

export class AppError extends Error {}

export const defaultScannerSettings = (): T.ScannerSettings => ({
  enabled: true, inputMode: 'both', autoDetectWedge: true, suffix: 'both',
  defaultScanQty: 1, beepOnSuccess: true, beepOnError: true,
  unknownBehavior: 'prompt', rapidDuplicateWindowMs: 350, cameraEnabled: true,
});

const emptySettings = (): T.Settings => ({
  storeName: '', address: '', phone: '', email: '', currency: 'PKR', taxRatePct: 0,
  expiryWarnDays: 90, invoicePrefix: 'INV', nextInvoiceSeq: 1, nextSaleReturnSeq: 1,
  nextPurchaseReturnSeq: 1, receiptFooter: 'Thank you for your purchase. Please keep this receipt.',
  paymentMethods: ['Cash', 'Card', 'Bank Transfer', 'JazzCash', 'EasyPaisa'],
  expenseCategories: ['Rent', 'Salaries', 'Electricity', 'Internet', 'Transportation', 'Packaging', 'Maintenance', 'Other'],
  printerName: '', backupRetention: 30, allowCashierReturns: false, allowCashierCredit: false, setupDone: false,
  scanner: defaultScannerSettings(),
});

export const emptyDb = (): T.DbState => ({
  version: 2, seq: {},
  users: [], categories: [], medicines: [], medicineBarcodes: [], batches: [], suppliers: [], customers: [],
  purchases: [], purchaseItems: [], supplierPayments: [], sales: [], saleItems: [], salePayments: [],
  salesReturns: [], salesReturnItems: [], purchaseReturns: [], purchaseReturnItems: [],
  customerPayments: [], ledger: [], expenses: [], cashSessions: [], cashMovements: [],
  movements: [], audit: [], settings: emptySettings(),
});

/**
 * In-place state migration v1 → v2 (mirrors database/migrations/002_barcodes.sql).
 * Non-destructive: every existing medicine's single barcode becomes its PRIMARY
 * packaging barcode (1 base unit per package). No records are deleted or reset.
 * Safe to run repeatedly.
 */
export function migrateDb(db: T.DbState): T.DbState {
  if (!Array.isArray(db.medicineBarcodes)) db.medicineBarcodes = [];
  if (!db.settings.scanner) db.settings.scanner = defaultScannerSettings();
  if ((db.version ?? 1) < 2) {
    let nextId = (db.seq['medicineBarcodes'] ?? 0);
    for (const m of db.medicines) {
      const code = (m.barcode ?? '').trim();
      if (code && !db.medicineBarcodes.some(b => b.barcode === code)) {
        db.medicineBarcodes.push({
          id: ++nextId, medicineId: m.id, barcode: code, packagingLevel: 'strip',
          unitsPerPackage: 1, sellPricePaisa: 0, purchaseCostPaisa: 0, isPrimary: true, active: true,
        });
      }
    }
    db.seq['medicineBarcodes'] = nextId;
    db.version = 2;
  }
  return db;
}

export interface ScanResolution {
  status: 'found' | 'unknown' | 'invalid' | 'blocked';
  parsed: ParsedScan;
  medicine?: T.Medicine;
  barcodeRecord?: T.MedicineBarcode;
  /** Base-unit quantity one scan represents (before scanner defaultScanQty). */
  baseQtyPerScan: number;
  /** Selling price per BASE unit, exact paisa. */
  unitPricePaisa: number;
  packagingLabel: string;
  /** Batch identified from GS1 AI (10) when it exists in stock records. */
  matchedBatch?: T.Batch;
  message: string;
  warnings: string[];
}

type PersistFn = (db: T.DbState) => void;

export class Engine {
  db: T.DbState;
  private persist: PersistFn;
  constructor(db: T.DbState, persist: PersistFn) { this.db = db; this.persist = persist; }

  // ---------- primitives ----------
  private id(table: string): number { const n = (this.db.seq[table] ?? 0) + 1; this.db.seq[table] = n; return n; }
  private save() { this.persist(this.db); }
  private tx<R>(fn: () => R): R {
    const backup = JSON.stringify(this.db);
    try { const r = fn(); this.save(); return r; }
    catch (e) { this.db = JSON.parse(backup) as T.DbState; throw e; }
  }
  private require(actor: T.SessionUser, perm: string) {
    if (!actor || !T.can(actor.role, perm)) throw new AppError(`Permission denied: ${perm} is not allowed for role ${actor?.role ?? 'none'}.`);
  }
  private log(actor: T.SessionUser | null, action: string, details: string) {
    this.db.audit.push({ id: this.id('audit'), dateTime: nowISO(), userId: actor?.id ?? 0, username: actor?.username ?? 'system', action, details });
  }
  private ledger(partyType: 'customer' | 'supplier', partyId: number, type: string, reference: string, debitPaisa: number, creditPaisa: number) {
    if (debitPaisa === 0 && creditPaisa === 0) return;
    this.db.ledger.push({ id: this.id('ledger'), partyType, partyId, dateTime: nowISO(), type, reference, debitPaisa, creditPaisa });
  }
  private cash(type: string, amountPaisa: number, reference: string) {
    if (amountPaisa === 0) return;
    this.db.cashMovements.push({ id: this.id('cashMovements'), dateTime: nowISO(), type, amountPaisa, reference });
    this.ensureSession(todayStr());
  }
  private move(actor: T.SessionUser, medicineId: number, batchId: number, type: string, qty: number, reference: string, reason: string, costPaisa: number) {
    this.db.movements.push({ id: this.id('movements'), dateTime: nowISO(), medicineId, batchId, type, qty, reference, reason, userId: actor.id, costPaisa });
  }
  private ensureSession(date: string): T.CashSession {
    let s = this.db.cashSessions.find(x => x.date === date);
    if (!s) {
      const prev = [...this.db.cashSessions].filter(x => x.closedAt).sort((a, b) => b.date.localeCompare(a.date))[0];
      s = { id: this.id('cashSessions'), date, openingPaisa: prev?.countedPaisa ?? 0, countedPaisa: null, expectedPaisa: null, closedAt: null, closedBy: null, notes: '', discrepancyReason: '' };
      this.db.cashSessions.push(s);
    }
    return s;
  }

  // ---------- lookups ----------
  medicine(id: number): T.Medicine { const m = this.db.medicines.find(x => x.id === id); if (!m) throw new AppError('Medicine not found.'); return m; }
  batch(id: number): T.Batch { const b = this.db.batches.find(x => x.id === id); if (!b) throw new AppError('Batch not found.'); return b; }
  isExpired(b: T.Batch, on = todayStr()): boolean { return b.expiryDate <= on; }
  eligibleBatches(medicineId: number, on = todayStr()): T.Batch[] {
    return this.db.batches
      .filter(b => b.medicineId === medicineId && b.status === 'active' && b.qtyRemaining > 0 && !this.isExpired(b, on))
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.id - b.id);
  }
  saleableStock(medicineId: number): number { return this.eligibleBatches(medicineId).reduce((s, b) => s + b.qtyRemaining, 0); }
  totalStock(medicineId: number): number { return this.db.batches.filter(b => b.medicineId === medicineId && b.status !== 'written_off').reduce((s, b) => s + b.qtyRemaining, 0); }
  customerBalance(id: number): number {
    const c = this.db.customers.find(x => x.id === id); if (!c) return 0;
    return c.openingBalancePaisa + this.db.ledger.filter(l => l.partyType === 'customer' && l.partyId === id).reduce((s, l) => s + l.debitPaisa - l.creditPaisa, 0);
  }
  supplierBalance(id: number): number {
    const s0 = this.db.suppliers.find(x => x.id === id); if (!s0) return 0;
    return s0.openingBalancePaisa + this.db.ledger.filter(l => l.partyType === 'supplier' && l.partyId === id).reduce((s, l) => s + l.creditPaisa - l.debitPaisa, 0);
  }
  returnedQtyForSaleItem(saleItemId: number): number {
    return this.db.salesReturnItems.filter(i => i.saleItemId === saleItemId).reduce((s, i) => s + i.qty, 0);
  }

  // ---------- auth & users ----------
  setupAdmin(input: { storeName: string; address: string; phone: string; fullName: string; username: string; password: string; seedSample: boolean }): T.SessionUser {
    if (this.db.users.length > 0) throw new AppError('Setup is already complete.');
    if (!input.username.trim() || input.password.length < 6) throw new AppError('Username is required and password must be at least 6 characters.');
    return this.tx(() => {
      const s = this.db.settings;
      s.storeName = input.storeName || 'My Medical Store'; s.address = input.address; s.phone = input.phone; s.setupDone = true;
      const u: T.User = { id: this.id('users'), username: input.username.trim().toLowerCase(), fullName: input.fullName || 'Administrator', passwordHash: bcrypt.hashSync(input.password, 10), role: 'admin', active: true, createdAt: nowISO() };
      this.db.users.push(u);
      this.db.customers.push({ id: this.id('customers'), name: 'Walk-in Customer', phone: '', address: '', openingBalancePaisa: 0, notes: 'Default counter customer', active: true });
      const actor = this.toSession(u);
      this.log(actor, 'setup', 'Initial administrator account created');
      if (input.seedSample) this.seedSampleData(actor);
      return actor;
    });
  }
  private toSession(u: T.User): T.SessionUser { return { id: u.id, username: u.username, fullName: u.fullName, role: u.role }; }
  login(username: string, password: string): T.SessionUser {
    const u = this.db.users.find(x => x.username === username.trim().toLowerCase() && x.active);
    if (!u || !bcrypt.compareSync(password, u.passwordHash)) throw new AppError('Invalid username or password.');
    const actor = this.toSession(u);
    this.tx(() => this.log(actor, 'login', 'User logged in'));
    return actor;
  }
  logout(actor: T.SessionUser) { this.tx(() => this.log(actor, 'logout', 'User logged out')); }
  createUser(actor: T.SessionUser, input: { username: string; fullName: string; password: string; role: T.Role }) {
    this.require(actor, 'users.manage');
    const un = input.username.trim().toLowerCase();
    if (!un || input.password.length < 6) throw new AppError('Username required; password must be at least 6 characters.');
    if (this.db.users.some(u => u.username === un)) throw new AppError('That username already exists.');
    return this.tx(() => {
      const u: T.User = { id: this.id('users'), username: un, fullName: input.fullName, passwordHash: bcrypt.hashSync(input.password, 10), role: input.role, active: true, createdAt: nowISO() };
      this.db.users.push(u); this.log(actor, 'user.create', `Created user ${un} (${input.role})`); return this.toSession(u);
    });
  }
  updateUser(actor: T.SessionUser, id: number, patch: { fullName?: string; role?: T.Role; active?: boolean; password?: string }) {
    this.require(actor, 'users.manage');
    return this.tx(() => {
      const u = this.db.users.find(x => x.id === id); if (!u) throw new AppError('User not found.');
      if (u.id === actor.id && patch.active === false) throw new AppError('You cannot deactivate your own account.');
      if (patch.fullName !== undefined) u.fullName = patch.fullName;
      if (patch.role) u.role = patch.role;
      if (patch.active !== undefined) u.active = patch.active;
      if (patch.password) { if (patch.password.length < 6) throw new AppError('Password must be at least 6 characters.'); u.passwordHash = bcrypt.hashSync(patch.password, 10); }
      this.log(actor, 'user.update', `Updated user ${u.username}`);
    });
  }
  changeOwnPassword(actor: T.SessionUser, oldPw: string, newPw: string) {
    return this.tx(() => {
      const u = this.db.users.find(x => x.id === actor.id); if (!u) throw new AppError('User not found.');
      if (!bcrypt.compareSync(oldPw, u.passwordHash)) throw new AppError('Current password is incorrect.');
      if (newPw.length < 6) throw new AppError('New password must be at least 6 characters.');
      u.passwordHash = bcrypt.hashSync(newPw, 10); this.log(actor, 'user.password', 'Changed own password');
    });
  }

  // ---------- categories / medicines ----------
  saveCategory(actor: T.SessionUser, name: string, id?: number) {
    this.require(actor, 'categories.edit');
    if (!name.trim()) throw new AppError('Category name is required.');
    return this.tx(() => {
      if (id) { const c = this.db.categories.find(x => x.id === id); if (!c) throw new AppError('Category not found.'); c.name = name.trim(); return c; }
      const c = { id: this.id('categories'), name: name.trim() }; this.db.categories.push(c);
      this.log(actor, 'category.create', name); return c;
    });
  }
  deleteCategory(actor: T.SessionUser, id: number) {
    this.require(actor, 'categories.edit');
    return this.tx(() => {
      if (this.db.medicines.some(m => m.categoryId === id)) throw new AppError('Category is used by medicines and cannot be deleted. Re-assign those medicines first.');
      this.db.categories = this.db.categories.filter(c => c.id !== id); this.log(actor, 'category.delete', `Category ${id}`);
    });
  }
  /** Keeps Medicine.barcode (legacy display field) and the primary
   *  MedicineBarcode record in sync. Called inside existing transactions. */
  private syncPrimaryBarcode(m: T.Medicine) {
    const code = (m.barcode ?? '').trim();
    let rec = this.db.medicineBarcodes.find(b => b.medicineId === m.id && b.isPrimary);
    if (!code) { if (rec) rec.active = false; return; }
    if (rec) { rec.barcode = code; rec.active = true; return; }
    rec = this.db.medicineBarcodes.find(b => b.barcode === code && b.medicineId === m.id);
    if (rec) { rec.isPrimary = true; rec.active = true; return; }
    this.db.medicineBarcodes.push({
      id: this.id('medicineBarcodes'), medicineId: m.id, barcode: code, packagingLevel: 'strip',
      unitsPerPackage: 1, sellPricePaisa: 0, purchaseCostPaisa: 0, isPrimary: true, active: true,
    });
  }
  private assertBarcodeFree(code: string, exceptMedicineId?: number, exceptRecordId?: number) {
    const rec = this.db.medicineBarcodes.find(b => b.active && b.barcode === code && b.id !== exceptRecordId && b.medicineId !== exceptMedicineId);
    const med = this.db.medicines.find(m => m.barcode && m.barcode === code && m.id !== exceptMedicineId);
    const owner = rec ? this.db.medicines.find(m => m.id === rec.medicineId) : med;
    if (owner) throw new AppError(`Barcode ${code} is already assigned to "${owner.name}". Barcodes must be unique across all medicines and packaging levels.`);
  }
  saveMedicine(actor: T.SessionUser, input: Partial<T.Medicine> & { name: string }): T.Medicine {
    this.require(actor, 'medicines.edit');
    if (!input.name.trim()) throw new AppError('Medicine name is required.');
    const barcode = (input.barcode ?? '').trim();
    if (barcode) this.assertBarcodeFree(barcode, input.id);
    return this.tx(() => {
      if (input.id) {
        const m = this.medicine(input.id);
        Object.assign(m, input, { barcode, updatedAt: nowISO() });
        this.syncPrimaryBarcode(m);
        this.log(actor, 'medicine.update', `${m.name}`); return m;
      }
      const m: T.Medicine = {
        id: this.id('medicines'), name: input.name.trim(), genericName: input.genericName ?? '', brandName: input.brandName ?? '',
        barcode, categoryId: input.categoryId ?? null, manufacturer: input.manufacturer ?? '', strength: input.strength ?? '',
        dosageForm: input.dosageForm ?? 'Tablet', packSize: input.packSize ?? '', unit: input.unit ?? 'strip',
        defaultCostPaisa: input.defaultCostPaisa ?? 0, retailPricePaisa: input.retailPricePaisa ?? 0,
        minStock: input.minStock ?? 10, prescription: input.prescription ?? 'OTC', storage: input.storage ?? '',
        notes: input.notes ?? '', active: input.active ?? true, createdAt: nowISO(), updatedAt: nowISO(),
      };
      this.db.medicines.push(m); this.syncPrimaryBarcode(m);
      this.log(actor, 'medicine.create', m.name); return m;
    });
  }

  // ---------- medicine barcodes & packaging ----------
  barcodesFor(medicineId: number): T.MedicineBarcode[] {
    return this.db.medicineBarcodes.filter(b => b.medicineId === medicineId).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.id - b.id);
  }
  private validatePackagingPrices(units: number, sellPaisa: number, costPaisa: number) {
    if (!Number.isInteger(units) || units < 1) throw new AppError('Units per package must be a whole number of at least 1.');
    if (sellPaisa < 0 || costPaisa < 0) throw new AppError('Package price/cost cannot be negative.');
    if (sellPaisa > 0 && sellPaisa % units !== 0)
      throw new AppError(`Package selling price must divide exactly by ${units} base units (so each unit is a whole number of paisa). Adjust the package price or leave it 0 to inherit the per-unit price.`);
    if (costPaisa > 0 && costPaisa % units !== 0)
      throw new AppError(`Package purchase cost must divide exactly by ${units} base units. Adjust it or leave it 0 to inherit.`);
  }
  addMedicineBarcode(actor: T.SessionUser, input: { medicineId: number; barcode: string; packagingLevel: T.PackagingLevel; unitsPerPackage: number; sellPricePaisa: number; purchaseCostPaisa: number }): T.MedicineBarcode {
    this.require(actor, 'medicines.edit');
    const code = input.barcode.trim();
    if (!code) throw new AppError('Barcode is required.');
    this.medicine(input.medicineId);
    this.assertBarcodeFree(code, input.medicineId);
    if (this.db.medicineBarcodes.some(b => b.active && b.barcode === code && b.medicineId === input.medicineId))
      throw new AppError('This medicine already has that barcode registered.');
    this.validatePackagingPrices(input.unitsPerPackage, input.sellPricePaisa, input.purchaseCostPaisa);
    return this.tx(() => {
      const med = this.medicine(input.medicineId);
      const isPrimary = !med.barcode;
      const rec: T.MedicineBarcode = {
        id: this.id('medicineBarcodes'), medicineId: input.medicineId, barcode: code,
        packagingLevel: input.packagingLevel, unitsPerPackage: input.unitsPerPackage,
        sellPricePaisa: input.sellPricePaisa, purchaseCostPaisa: input.purchaseCostPaisa,
        isPrimary, active: true,
      };
      this.db.medicineBarcodes.push(rec);
      if (isPrimary) med.barcode = code;
      this.log(actor, 'barcode.add', `${med.name}: ${code} (${rec.packagingLevel} ×${rec.unitsPerPackage} ${med.unit})`);
      return rec;
    });
  }
  updateMedicineBarcode(actor: T.SessionUser, id: number, patch: Partial<Pick<T.MedicineBarcode, 'barcode' | 'packagingLevel' | 'unitsPerPackage' | 'sellPricePaisa' | 'purchaseCostPaisa' | 'active'>>) {
    this.require(actor, 'medicines.edit');
    return this.tx(() => {
      const rec = this.db.medicineBarcodes.find(b => b.id === id);
      if (!rec) throw new AppError('Barcode record not found.');
      const next = { ...rec, ...patch, barcode: (patch.barcode ?? rec.barcode).trim() };
      if (!next.barcode) throw new AppError('Barcode is required.');
      this.assertBarcodeFree(next.barcode, rec.medicineId, rec.id);
      this.validatePackagingPrices(next.unitsPerPackage, next.sellPricePaisa, next.purchaseCostPaisa);
      Object.assign(rec, next);
      const med = this.medicine(rec.medicineId);
      if (rec.isPrimary) med.barcode = rec.active ? rec.barcode : '';
      this.log(actor, 'barcode.update', `${med.name}: ${rec.barcode} (${rec.packagingLevel} ×${rec.unitsPerPackage})`);
      return rec;
    });
  }
  deleteMedicineBarcode(actor: T.SessionUser, id: number) {
    this.require(actor, 'medicines.edit');
    return this.tx(() => {
      const rec = this.db.medicineBarcodes.find(b => b.id === id);
      if (!rec) throw new AppError('Barcode record not found.');
      this.db.medicineBarcodes = this.db.medicineBarcodes.filter(b => b.id !== id);
      const med = this.medicine(rec.medicineId);
      if (rec.isPrimary && med.barcode === rec.barcode) med.barcode = '';
      this.log(actor, 'barcode.delete', `${med.name}: ${rec.barcode} removed`);
    });
  }
  /** Finds a barcode record, tolerating GTIN-14 ↔ EAN-13/UPC zero-padding. */
  findBarcodeRecord(code: string): T.MedicineBarcode | undefined {
    const c = code.trim(); if (!c) return undefined;
    const variants = gtinVariants(c);
    return this.db.medicineBarcodes.find(b => b.active && variants.includes(b.barcode));
  }
  similarMedicines(name: string, excludeId?: number): T.Medicine[] {
    const n = name.trim().toLowerCase(); if (n.length < 3) return [];
    return this.db.medicines.filter(m => m.id !== excludeId && (m.name.toLowerCase().includes(n) || n.includes(m.name.toLowerCase())));
  }
  findByBarcode(barcode: string): T.Medicine | undefined {
    const rec = this.findBarcodeRecord(barcode);
    if (rec) return this.db.medicines.find(m => m.id === rec.medicineId);
    return this.db.medicines.find(m => m.barcode && m.barcode === barcode.trim());
  }
  searchMedicines(q: string): T.Medicine[] {
    const s = q.trim().toLowerCase(); if (!s) return [];
    const barcodeHitIds = new Set(this.db.medicineBarcodes.filter(b => b.active && b.barcode.toLowerCase() === s).map(b => b.medicineId));
    return this.db.medicines.filter(m => m.active && (barcodeHitIds.has(m.id) || m.name.toLowerCase().includes(s) || m.genericName.toLowerCase().includes(s) || m.brandName.toLowerCase().includes(s) || m.barcode === s)).slice(0, 15);
  }

  /**
   * Interprets ONE raw scan for the POS/purchasing screens. Read-only:
   * scanning NEVER changes stock — stock moves only in createSale.
   * - GS1 batch AI (10) matches a stock batch when the number exists;
   *   absent data is never invented (FEFO remains the fallback).
   * - A scan identifying an expired / quarantined / damaged batch, or whose
   *   own GS1 expiry date has passed, is BLOCKED, never silently substituted.
   */
  resolveScan(rawCode: string): ScanResolution {
    const parsed = parseScan(rawCode);
    const none: ScanResolution = { status: 'invalid', parsed, baseQtyPerScan: 0, unitPricePaisa: 0, packagingLabel: '', message: '', warnings: [...parsed.errors] };
    if (parsed.kind === 'invalid' || parsed.kind === 'qr-text') {
      none.message = parsed.errors[0] ?? 'This code does not contain a medicine barcode.';
      return none;
    }
    const lookupCode = parsed.kind === 'gs1' ? (parsed.gs1?.gtin ?? '') : parsed.code;
    let rec = lookupCode ? this.findBarcodeRecord(lookupCode) : undefined;
    let med = rec ? this.db.medicines.find(m => m.id === rec!.medicineId) : (lookupCode ? this.findByBarcode(lookupCode) : undefined);
    if (med && !rec) rec = this.db.medicineBarcodes.find(b => b.medicineId === med!.id && b.isPrimary && b.active);
    if (!med) {
      return { ...none, status: 'unknown', message: `Barcode "${lookupCode || parsed.raw}" is not registered to any medicine.` };
    }
    const warnings = [...parsed.errors];
    const units = rec?.unitsPerPackage ?? 1;
    const packagingLabel = rec ? (units > 1 ? `${rec.packagingLevel} ×${units} ${med.unit}` : rec.packagingLevel) : med.unit;
    const firstBatch = this.eligibleBatches(med.id)[0];
    const unitPricePaisa = rec && rec.sellPricePaisa > 0 ? Math.round(rec.sellPricePaisa / units) : (firstBatch?.sellPricePaisa || med.retailPricePaisa);
    const res: ScanResolution = {
      status: 'found', parsed, medicine: med, barcodeRecord: rec,
      baseQtyPerScan: units, unitPricePaisa, packagingLabel, message: med.name, warnings,
    };
    const g = parsed.gs1;
    if (g?.expiryDate && g.expiryDate <= todayStr()) {
      return { ...res, status: 'blocked', message: `${med.name}: the scanned pack itself is EXPIRED (GS1 expiry ${g.expiryDate}). It must not be sold.` };
    }
    if (g?.batchNo) {
      const batch = this.db.batches.find(b => b.medicineId === med!.id && b.batchNo.toLowerCase() === g.batchNo!.toLowerCase() && b.status !== 'written_off');
      if (!batch) {
        warnings.push(`Batch ${g.batchNo} from the code is not in stock records — FEFO allocation will be used. Receive it via Purchases if it is new stock.`);
      } else if (batch.status !== 'active') {
        return { ...res, status: 'blocked', matchedBatch: batch, message: `${med.name} batch ${batch.batchNo} is ${batch.status.replace('_', ' ')} and must not be sold.` };
      } else if (this.isExpired(batch)) {
        return { ...res, status: 'blocked', matchedBatch: batch, message: `${med.name} batch ${batch.batchNo} expired on ${batch.expiryDate} and must not be sold.` };
      } else {
        res.matchedBatch = batch;
        if (g.expiryDate && g.expiryDate !== batch.expiryDate)
          warnings.push(`Code expiry ${g.expiryDate} differs from recorded batch expiry ${batch.expiryDate} — verify the pack.`);
        if (batch.qtyRemaining <= 0) warnings.push(`Batch ${batch.batchNo} has no recorded stock left; checkout will re-check and may reject.`);
      }
    }
    return res;
  }

  // ---------- batches / stock ----------
  adjustStock(actor: T.SessionUser, batchId: number, deltaQty: number, reason: string, type = 'adjustment') {
    this.require(actor, 'inventory.adjust');
    if (!reason.trim()) throw new AppError('A reason is required for every stock adjustment.');
    return this.tx(() => {
      const b = this.batch(batchId);
      const next = b.qtyRemaining + deltaQty;
      if (next < 0) throw new AppError('Adjustment would make stock negative.');
      b.qtyRemaining = next;
      this.move(actor, b.medicineId, b.id, type, deltaQty, `BATCH-${b.id}`, reason, b.costPaisa);
      this.log(actor, 'stock.adjust', `${this.medicine(b.medicineId).name} batch ${b.batchNo}: ${deltaQty > 0 ? '+' : ''}${deltaQty} (${reason})`);
    });
  }
  setBatchStatus(actor: T.SessionUser, batchId: number, status: T.BatchStatus, reason: string) {
    this.require(actor, 'inventory.adjust');
    if (!reason.trim()) throw new AppError('A reason is required.');
    return this.tx(() => {
      const b = this.batch(batchId);
      if (status === 'written_off') {
        this.move(actor, b.medicineId, b.id, 'expired_writeoff', -b.qtyRemaining, `BATCH-${b.id}`, reason, b.costPaisa);
        b.qtyRemaining = 0;
      }
      b.status = status;
      this.log(actor, 'stock.batch_status', `${this.medicine(b.medicineId).name} batch ${b.batchNo} -> ${status} (${reason})`);
    });
  }
  addOpeningBatch(actor: T.SessionUser, input: { medicineId: number; batchNo: string; expiryDate: string; mfgDate?: string; qty: number; costPaisa: number; sellPricePaisa: number }) {
    this.require(actor, 'inventory.adjust');
    if (!input.batchNo.trim() || !input.expiryDate || input.qty <= 0) throw new AppError('Batch number, expiry date and a positive quantity are required.');
    return this.tx(() => {
      const b: T.Batch = { id: this.id('batches'), medicineId: input.medicineId, batchNo: input.batchNo.trim(), supplierId: null, purchaseId: null, mfgDate: input.mfgDate ?? '', expiryDate: input.expiryDate, receivedDate: todayStr(), qtyReceived: input.qty, qtyRemaining: input.qty, costPaisa: input.costPaisa, sellPricePaisa: input.sellPricePaisa, status: 'active' };
      this.db.batches.push(b);
      this.move(actor, input.medicineId, b.id, 'opening_stock', input.qty, `BATCH-${b.id}`, 'Opening stock entry', input.costPaisa);
      this.log(actor, 'stock.opening', `${this.medicine(input.medicineId).name} +${input.qty} batch ${b.batchNo}`);
      return b;
    });
  }

  // ---------- FEFO ----------
  /**
   * Allocates saleable stock. With `preferredBatchId` (from a GS1 scan that
   * identified a physical pack's batch) that batch is used FIRST — but only
   * if eligible; an expired/held scanned batch throws rather than being
   * silently substituted. Any remainder falls back to normal FEFO order.
   * `reserved` carries quantities already claimed by earlier lines of the
   * same sale so two lines can never allocate the same physical units.
   */
  private allocateFEFO(medicineId: number, qty: number, preferredBatchId?: number, reserved?: Map<number, number>): T.Allocation[] {
    if (qty <= 0) throw new AppError('Quantity must be positive.');
    const med = this.medicine(medicineId);
    const free = (b: T.Batch) => b.qtyRemaining - (reserved?.get(b.id) ?? 0);
    let remaining = qty; const allocs: T.Allocation[] = [];
    const eligible = this.eligibleBatches(medicineId);
    let ordered = eligible;
    if (preferredBatchId) {
      const pref = this.db.batches.find(b => b.id === preferredBatchId);
      if (!pref || pref.medicineId !== medicineId) throw new AppError(`Scanned batch does not belong to "${med.name}".`);
      if (pref.status !== 'active' || this.isExpired(pref) || free(pref) <= 0)
        throw new AppError(`Scanned batch ${pref.batchNo} of "${med.name}" is not saleable (status ${pref.status}, expiry ${pref.expiryDate}, remaining ${pref.qtyRemaining}). The sale was not completed.`);
      ordered = [pref, ...eligible.filter(b => b.id !== pref.id)];
    }
    for (const b of ordered) {
      if (remaining <= 0) break;
      const take = Math.min(free(b), remaining);
      if (take <= 0) continue;
      allocs.push({ batchId: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: take, costPaisa: b.costPaisa });
      remaining -= take;
    }
    if (remaining > 0) {
      const avail = eligible.reduce((s, b) => s + Math.max(0, free(b)), 0);
      throw new AppError(`Insufficient saleable stock for "${med.name}". Requested ${qty}, available ${avail} (expired/quarantined batches are excluded).`);
    }
    return allocs;
  }

  // ---------- sales ----------
  createSale(actor: T.SessionUser, input: {
    customerId: number; items: { medicineId: number; qty: number; unitPricePaisa: number; discountPaisa: number; preferredBatchId?: number; packaging?: string }[];
    billDiscountPaisa: number; payments: { method: string; amountPaisa: number }[]; idempotencyKey: string;
  }): T.Sale {
    this.require(actor, 'pos');
    const existing = this.db.sales.find(s => s.idempotencyKey === input.idempotencyKey);
    if (existing) return existing; // double-submit protection
    if (input.items.length === 0) throw new AppError('Cart is empty.');
    return this.tx(() => {
      const s = this.db.settings;
      // merge duplicate lines — keyed by medicine AND scanned batch, so a
      // GS1-identified line keeps its batch instead of merging into FEFO.
      const merged = new Map<string, { medicineId: number; qty: number; unitPricePaisa: number; discountPaisa: number; preferredBatchId?: number; packaging?: string }>();
      for (const it of input.items) {
        const key = `${it.medicineId}|${it.preferredBatchId ?? ''}|${it.packaging ?? ''}`;
        const cur = merged.get(key);
        if (cur) { cur.qty += it.qty; cur.discountPaisa += it.discountPaisa; } else merged.set(key, { ...it });
      }
      // Two lines for the same medicine (e.g. one scanned box, one FEFO strip)
      // must not double-allocate the same units: the allocator is told what
      // earlier lines in THIS sale already reserved from each batch.
      const reserved = new Map<number, number>(); // batchId -> qty reserved in this sale
      const lines: { med: T.Medicine; qty: number; unitPricePaisa: number; discountPaisa: number; lineTotal: number; allocations: T.Allocation[]; packaging?: string }[] = [];
      let subtotal = 0, lineDiscounts = 0;
      for (const it of merged.values()) {
        const med = this.medicine(it.medicineId);
        if (!med.active) throw new AppError(`"${med.name}" is inactive and cannot be sold.`);
        const allocations = this.allocateFEFO(it.medicineId, it.qty, it.preferredBatchId, reserved); // rechecks stock + expiry NOW
        for (const al of allocations) reserved.set(al.batchId, (reserved.get(al.batchId) ?? 0) + al.qty);
        const gross = it.unitPricePaisa * it.qty;
        if (it.discountPaisa < 0 || it.discountPaisa > gross) throw new AppError(`Invalid discount on "${med.name}".`);
        subtotal += gross; lineDiscounts += it.discountPaisa;
        lines.push({ med, qty: it.qty, unitPricePaisa: it.unitPricePaisa, discountPaisa: it.discountPaisa, lineTotal: gross - it.discountPaisa, allocations, packaging: it.packaging });
      }
      const discountTotal = lineDiscounts + (input.billDiscountPaisa || 0);
      if (discountTotal > subtotal) throw new AppError('Total discount cannot exceed the subtotal.');
      const taxable = subtotal - discountTotal;
      const taxPaisa = percentOf(taxable, s.taxRatePct);
      const total = taxable + taxPaisa;
      const paid = input.payments.reduce((x, p) => x + p.amountPaisa, 0);
      if (paid < 0) throw new AppError('Invalid payment amount.');
      const balance = total - paid;
      const walkIn = this.db.customers[0];
      if (balance > 0) {
        if (input.customerId === walkIn?.id) throw new AppError('Credit (udhaar) sale requires selecting a registered customer — not Walk-in.');
        if (actor.role === 'cashier' && !s.allowCashierCredit) throw new AppError('Cashiers are not allowed to make credit sales. Ask an admin/pharmacist.');
      }
      const invoiceNo = `${s.invoicePrefix}-${String(s.nextInvoiceSeq).padStart(6, '0')}`;
      s.nextInvoiceSeq += 1;
      const sale: T.Sale = { id: this.id('sales'), invoiceNo, dateTime: nowISO(), customerId: input.customerId, userId: actor.id, subtotalPaisa: subtotal, discountPaisa: discountTotal, taxPaisa, totalPaisa: total, paidPaisa: paid, idempotencyKey: input.idempotencyKey };
      this.db.sales.push(sale);
      for (const ln of lines) {
        const item: T.SaleItem = { id: this.id('saleItems'), saleId: sale.id, medicineId: ln.med.id, medicineName: `${ln.med.name}${ln.med.strength ? ' ' + ln.med.strength : ''}`, qty: ln.qty, unitPricePaisa: ln.unitPricePaisa, discountPaisa: ln.discountPaisa, lineTotalPaisa: ln.lineTotal, allocations: ln.allocations, packaging: ln.packaging };
        this.db.saleItems.push(item);
        for (const al of ln.allocations) {
          const b = this.batch(al.batchId); b.qtyRemaining -= al.qty;
          this.move(actor, ln.med.id, b.id, 'sale', -al.qty, invoiceNo, 'Sale', al.costPaisa);
        }
      }
      for (const p of input.payments) {
        if (p.amountPaisa <= 0) continue;
        this.db.salePayments.push({ id: this.id('salePayments'), saleId: sale.id, method: p.method, amountPaisa: p.amountPaisa, dateTime: nowISO() });
        if (p.method.toLowerCase() === 'cash') this.cash('sale', p.amountPaisa, invoiceNo);
      }
      if (balance > 0) this.ledger('customer', input.customerId, 'credit_sale', invoiceNo, balance, 0);
      this.log(actor, 'sale.create', `${invoiceNo} total ${total} paid ${paid}`);
      return sale;
    });
  }
  saleOutstanding(saleId: number): number {
    const sale = this.db.sales.find(s => s.id === saleId); if (!sale) return 0;
    const later = this.db.customerPayments.filter(p => p.saleId === saleId).reduce((s, p) => s + p.amountPaisa, 0);
    const refundedCredit = this.db.salesReturns.filter(r => r.saleId === saleId && r.method === 'credit').reduce((s, r) => s + r.refundPaisa, 0);
    const returnedValue = this.db.salesReturnItems.filter(i => this.db.salesReturns.some(r => r.id === i.returnId && r.saleId === saleId)).reduce((s, i) => s + i.amountPaisa, 0);
    return Math.max(0, sale.totalPaisa - sale.paidPaisa - later - refundedCredit - Math.min(returnedValue, 0));
  }

  // ---------- sales returns ----------
  createSalesReturn(actor: T.SessionUser, input: {
    saleId: number; items: { saleItemId: number; qty: number; disposition: 'saleable' | 'quarantine' | 'damaged' }[];
    method: 'cash' | 'credit' | 'card' | 'bank'; reason: string;
  }): T.SalesReturn {
    if (actor.role === 'cashier' && !this.db.settings.allowCashierReturns) throw new AppError('Cashiers are not allowed to process returns.');
    this.require(actor, actor.role === 'cashier' ? 'pos' : 'sales.return');
    if (!input.reason.trim()) throw new AppError('Return reason is required.');
    return this.tx(() => {
      const sale = this.db.sales.find(s => s.id === input.saleId); if (!sale) throw new AppError('Original invoice not found.');
      const returnNo = `SR-${String(this.db.settings.nextSaleReturnSeq).padStart(6, '0')}`; this.db.settings.nextSaleReturnSeq += 1;
      let refundTotal = 0;
      const ret: T.SalesReturn = { id: this.id('salesReturns'), returnNo, saleId: sale.id, dateTime: nowISO(), userId: actor.id, refundPaisa: 0, method: input.method, reason: input.reason };
      this.db.salesReturns.push(ret);
      for (const ri of input.items) {
        if (ri.qty <= 0) continue;
        const item = this.db.saleItems.find(i => i.id === ri.saleItemId && i.saleId === sale.id);
        if (!item) throw new AppError('Return item does not belong to this invoice.');
        const already = this.returnedQtyForSaleItem(item.id);
        if (already + ri.qty > item.qty) throw new AppError(`Return qty for "${item.medicineName}" exceeds sold qty (sold ${item.qty}, already returned ${already}).`);
        // proportional refund incl. line discount share
        const amount = Math.round((item.lineTotalPaisa * ri.qty) / item.qty);
        // reverse allocations in original FEFO order (skip already-reversed portions)
        let toReverse = ri.qty, skip = already, costReversed = 0;
        for (const al of item.allocations) {
          if (toReverse <= 0) break;
          let availInAlloc = al.qty;
          if (skip > 0) { const sk = Math.min(skip, availInAlloc); skip -= sk; availInAlloc -= sk; }
          if (availInAlloc <= 0) continue;
          const take = Math.min(availInAlloc, toReverse); toReverse -= take;
          costReversed += take * al.costPaisa;
          const orig = this.batch(al.batchId);
          const expiredNow = this.isExpired(orig);
          if (ri.disposition === 'saleable' && !expiredNow && orig.status === 'active') {
            orig.qtyRemaining += take;
            this.move(actor, item.medicineId, orig.id, 'sales_return', take, returnNo, input.reason, al.costPaisa);
          } else {
            // expired / opened / questionable returns NEVER re-enter saleable stock
            const status: T.BatchStatus = ri.disposition === 'damaged' ? 'damaged' : 'quarantine';
            const nb: T.Batch = { id: this.id('batches'), medicineId: item.medicineId, batchNo: `${al.batchNo}-RET`, supplierId: orig.supplierId, purchaseId: orig.purchaseId, mfgDate: orig.mfgDate, expiryDate: al.expiryDate, receivedDate: todayStr(), qtyReceived: take, qtyRemaining: take, costPaisa: al.costPaisa, sellPricePaisa: orig.sellPricePaisa, status };
            this.db.batches.push(nb);
            this.move(actor, item.medicineId, nb.id, 'sales_return_' + status, take, returnNo, input.reason, al.costPaisa);
          }
        }
        refundTotal += amount;
        this.db.salesReturnItems.push({ id: this.id('salesReturnItems'), returnId: ret.id, saleItemId: item.id, medicineId: item.medicineId, qty: ri.qty, amountPaisa: amount, costReversedPaisa: costReversed, disposition: ri.disposition });
      }
      if (refundTotal <= 0) throw new AppError('Select at least one item to return.');
      ret.refundPaisa = refundTotal;
      if (input.method === 'cash') this.cash('refund', -refundTotal, returnNo);
      if (input.method === 'credit') this.ledger('customer', sale.customerId, 'sales_return', returnNo, 0, refundTotal);
      this.log(actor, 'sale.return', `${returnNo} for ${sale.invoiceNo}: refund ${refundTotal} via ${input.method}`);
      return ret;
    });
  }

  // ---------- purchases ----------
  createPurchase(actor: T.SessionUser, input: {
    supplierId: number; supplierInvoiceNo: string; date: string;
    items: { medicineId: number; batchNo: string; mfgDate: string; expiryDate: string; qty: number; costPaisa: number; sellPricePaisa: number }[];
    discountPaisa: number; chargesPaisa: number; paidPaisa: number; paymentMethod: string; idempotencyKey: string;
  }): T.Purchase {
    this.require(actor, 'purchases.create');
    const existing = this.db.purchases.find(p => p.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
    if (input.items.length === 0) throw new AppError('Add at least one purchase item.');
    return this.tx(() => {
      let subtotal = 0;
      for (const it of input.items) {
        this.medicine(it.medicineId);
        if (!it.batchNo.trim() || !it.expiryDate) throw new AppError('Every purchase line needs a batch number and expiry date.');
        if (it.qty <= 0 || it.costPaisa < 0) throw new AppError('Invalid quantity or cost on a purchase line.');
        subtotal += it.qty * it.costPaisa;
      }
      const total = subtotal - (input.discountPaisa || 0) + (input.chargesPaisa || 0);
      if (total < 0) throw new AppError('Purchase total cannot be negative.');
      if (input.paidPaisa < 0 || input.paidPaisa > total) throw new AppError('Paid amount must be between 0 and the purchase total.');
      const pur: T.Purchase = { id: this.id('purchases'), supplierId: input.supplierId, supplierInvoiceNo: input.supplierInvoiceNo, date: input.date || todayStr(), subtotalPaisa: subtotal, discountPaisa: input.discountPaisa || 0, chargesPaisa: input.chargesPaisa || 0, totalPaisa: total, paidPaisa: input.paidPaisa, userId: actor.id, idempotencyKey: input.idempotencyKey, createdAt: nowISO() };
      this.db.purchases.push(pur);
      for (const it of input.items) {
        // reuse an existing open batch with same batch no + expiry for this medicine, else create
        let b = this.db.batches.find(x => x.medicineId === it.medicineId && x.batchNo === it.batchNo.trim() && x.expiryDate === it.expiryDate && x.status === 'active' && x.costPaisa === it.costPaisa);
        if (b) { b.qtyReceived += it.qty; b.qtyRemaining += it.qty; }
        else {
          b = { id: this.id('batches'), medicineId: it.medicineId, batchNo: it.batchNo.trim(), supplierId: input.supplierId, purchaseId: pur.id, mfgDate: it.mfgDate || '', expiryDate: it.expiryDate, receivedDate: pur.date, qtyReceived: it.qty, qtyRemaining: it.qty, costPaisa: it.costPaisa, sellPricePaisa: it.sellPricePaisa || this.medicine(it.medicineId).retailPricePaisa, status: 'active' };
          this.db.batches.push(b);
        }
        this.db.purchaseItems.push({ id: this.id('purchaseItems'), purchaseId: pur.id, medicineId: it.medicineId, batchId: b.id, qty: it.qty, costPaisa: it.costPaisa });
        this.move(actor, it.medicineId, b.id, 'purchase', it.qty, `PUR-${pur.id}`, 'Purchase receipt', it.costPaisa);
        const med = this.medicine(it.medicineId);
        med.defaultCostPaisa = it.costPaisa; if (it.sellPricePaisa > 0) med.retailPricePaisa = it.sellPricePaisa; med.updatedAt = nowISO();
      }
      this.ledger('supplier', input.supplierId, 'purchase', `PUR-${pur.id}${input.supplierInvoiceNo ? ' / ' + input.supplierInvoiceNo : ''}`, 0, total);
      if (input.paidPaisa > 0) {
        this.db.supplierPayments.push({ id: this.id('supplierPayments'), supplierId: input.supplierId, date: pur.date, amountPaisa: input.paidPaisa, method: input.paymentMethod, reference: `PUR-${pur.id}`, userId: actor.id, purchaseId: pur.id });
        this.ledger('supplier', input.supplierId, 'payment', `PUR-${pur.id}`, input.paidPaisa, 0);
        if (input.paymentMethod.toLowerCase() === 'cash') this.cash('supplier_payment', -input.paidPaisa, `PUR-${pur.id}`);
      }
      this.log(actor, 'purchase.create', `PUR-${pur.id} total ${total} paid ${input.paidPaisa}`);
      return pur;
    });
  }
  createPurchaseReturn(actor: T.SessionUser, input: { supplierId: number; purchaseId: number | null; items: { batchId: number; qty: number }[]; reason: string }): T.PurchaseReturn {
    this.require(actor, 'purchase.return');
    if (!input.reason.trim()) throw new AppError('Return reason is required.');
    return this.tx(() => {
      const returnNo = `PR-${String(this.db.settings.nextPurchaseReturnSeq).padStart(6, '0')}`; this.db.settings.nextPurchaseReturnSeq += 1;
      const ret: T.PurchaseReturn = { id: this.id('purchaseReturns'), returnNo, supplierId: input.supplierId, purchaseId: input.purchaseId, dateTime: nowISO(), userId: actor.id, totalPaisa: 0, reason: input.reason };
      this.db.purchaseReturns.push(ret);
      let total = 0;
      for (const it of input.items) {
        if (it.qty <= 0) continue;
        const b = this.batch(it.batchId);
        if (it.qty > b.qtyRemaining) throw new AppError(`Batch ${b.batchNo} has only ${b.qtyRemaining} units remaining; cannot return ${it.qty}.`);
        b.qtyRemaining -= it.qty; total += it.qty * b.costPaisa;
        this.db.purchaseReturnItems.push({ id: this.id('purchaseReturnItems'), returnId: ret.id, medicineId: b.medicineId, batchId: b.id, qty: it.qty, costPaisa: b.costPaisa });
        this.move(actor, b.medicineId, b.id, 'purchase_return', -it.qty, returnNo, input.reason, b.costPaisa);
      }
      if (total <= 0) throw new AppError('Select at least one batch quantity to return.');
      ret.totalPaisa = total;
      this.ledger('supplier', input.supplierId, 'purchase_return', returnNo, total, 0);
      this.log(actor, 'purchase.return', `${returnNo} value ${total}`);
      return ret;
    });
  }

  // ---------- parties & payments ----------
  saveSupplier(actor: T.SessionUser, input: Partial<T.Supplier> & { name: string }): T.Supplier {
    this.require(actor, 'suppliers.edit');
    if (!input.name.trim()) throw new AppError('Supplier name is required.');
    return this.tx(() => {
      if (input.id) { const s = this.db.suppliers.find(x => x.id === input.id); if (!s) throw new AppError('Supplier not found.'); Object.assign(s, input); this.log(actor, 'supplier.update', s.name); return s; }
      const s: T.Supplier = { id: this.id('suppliers'), name: input.name.trim(), contactPerson: input.contactPerson ?? '', phone: input.phone ?? '', address: input.address ?? '', email: input.email ?? '', openingBalancePaisa: input.openingBalancePaisa ?? 0, notes: input.notes ?? '', active: true };
      this.db.suppliers.push(s); this.log(actor, 'supplier.create', s.name); return s;
    });
  }
  saveCustomer(actor: T.SessionUser, input: Partial<T.Customer> & { name: string }): T.Customer {
    this.require(actor, 'customers.edit');
    if (!input.name.trim()) throw new AppError('Customer name is required.');
    return this.tx(() => {
      if (input.id) { const c = this.db.customers.find(x => x.id === input.id); if (!c) throw new AppError('Customer not found.'); Object.assign(c, input); this.log(actor, 'customer.update', c.name); return c; }
      const c: T.Customer = { id: this.id('customers'), name: input.name.trim(), phone: input.phone ?? '', address: input.address ?? '', openingBalancePaisa: input.openingBalancePaisa ?? 0, notes: input.notes ?? '', active: true };
      this.db.customers.push(c); this.log(actor, 'customer.create', c.name); return c;
    });
  }
  customerPayment(actor: T.SessionUser, input: { customerId: number; amountPaisa: number; method: string; reference: string; saleId: number | null; date: string }) {
    this.require(actor, 'payments.create');
    if (input.amountPaisa <= 0) throw new AppError('Payment amount must be positive.');
    return this.tx(() => {
      const p: T.CustomerPayment = { id: this.id('customerPayments'), customerId: input.customerId, date: input.date || todayStr(), amountPaisa: input.amountPaisa, method: input.method, reference: input.reference || '', userId: actor.id, saleId: input.saleId };
      this.db.customerPayments.push(p);
      this.ledger('customer', input.customerId, 'payment', input.reference || `PAY-${p.id}`, 0, input.amountPaisa);
      if (input.method.toLowerCase() === 'cash') this.cash('customer_payment', input.amountPaisa, `PAY-${p.id}`);
      this.log(actor, 'customer.payment', `Customer ${input.customerId} paid ${input.amountPaisa}`);
      return p;
    });
  }
  supplierPayment(actor: T.SessionUser, input: { supplierId: number; amountPaisa: number; method: string; reference: string; date: string }) {
    this.require(actor, 'payments.create');
    if (input.amountPaisa <= 0) throw new AppError('Payment amount must be positive.');
    return this.tx(() => {
      const p: T.SupplierPayment = { id: this.id('supplierPayments'), supplierId: input.supplierId, date: input.date || todayStr(), amountPaisa: input.amountPaisa, method: input.method, reference: input.reference || '', userId: actor.id, purchaseId: null };
      this.db.supplierPayments.push(p);
      this.ledger('supplier', input.supplierId, 'payment', input.reference || `SPAY-${p.id}`, input.amountPaisa, 0);
      if (input.method.toLowerCase() === 'cash') this.cash('supplier_payment', -input.amountPaisa, `SPAY-${p.id}`);
      this.log(actor, 'supplier.payment', `Supplier ${input.supplierId} paid ${input.amountPaisa}`);
      return p;
    });
  }
  partyLedger(partyType: 'customer' | 'supplier', partyId: number) {
    const party = partyType === 'customer' ? this.db.customers.find(c => c.id === partyId) : this.db.suppliers.find(s => s.id === partyId);
    let running = party?.openingBalancePaisa ?? 0;
    return this.db.ledger.filter(l => l.partyType === partyType && l.partyId === partyId)
      .sort((a, b) => a.id - b.id)
      .map(l => { running += partyType === 'customer' ? (l.debitPaisa - l.creditPaisa) : (l.creditPaisa - l.debitPaisa); return { ...l, runningPaisa: running }; });
  }

  // ---------- expenses & cash ----------
  createExpense(actor: T.SessionUser, input: { date: string; category: string; description: string; amountPaisa: number; method: string; reference: string }) {
    this.require(actor, 'expenses.create');
    if (input.amountPaisa <= 0 || !input.description.trim()) throw new AppError('Expense description and a positive amount are required.');
    return this.tx(() => {
      const e: T.Expense = { id: this.id('expenses'), date: input.date || todayStr(), category: input.category, description: input.description.trim(), amountPaisa: input.amountPaisa, method: input.method, reference: input.reference || '', userId: actor.id };
      this.db.expenses.push(e);
      if (input.method.toLowerCase() === 'cash') this.cash('expense', -input.amountPaisa, `EXP-${e.id}`);
      this.log(actor, 'expense.create', `${e.category}: ${e.description} ${e.amountPaisa}`);
      return e;
    });
  }
  deleteExpense(actor: T.SessionUser, id: number) {
    this.require(actor, 'expenses.delete');
    return this.tx(() => {
      const e = this.db.expenses.find(x => x.id === id); if (!e) throw new AppError('Expense not found.');
      if (e.method.toLowerCase() === 'cash') this.cash('expense_reversal', e.amountPaisa, `EXP-${e.id}`);
      this.db.expenses = this.db.expenses.filter(x => x.id !== id);
      this.log(actor, 'expense.delete', `EXP-${id} reversed`);
    });
  }
  cashAdjustment(actor: T.SessionUser, amountPaisa: number, reason: string) {
    this.require(actor, 'cash.adjust');
    if (amountPaisa === 0 || !reason.trim()) throw new AppError('Amount and reason are required for cash in/out.');
    return this.tx(() => { this.cash(amountPaisa > 0 ? 'cash_in' : 'cash_out', amountPaisa, reason); this.log(actor, 'cash.adjust', `${amountPaisa} (${reason})`); });
  }
  setOpeningCash(actor: T.SessionUser, date: string, openingPaisa: number) {
    this.require(actor, 'cash.view');
    return this.tx(() => { const s = this.ensureSession(date); if (s.closedAt) throw new AppError('Session already closed.'); s.openingPaisa = openingPaisa; });
  }
  expectedCash(date: string): number {
    const s = this.db.cashSessions.find(x => x.date === date);
    const moves = this.db.cashMovements.filter(m => m.dateTime.slice(0, 10) === date).reduce((x, m) => x + m.amountPaisa, 0);
    return (s?.openingPaisa ?? 0) + moves;
  }
  dayCashSummary(date: string) {
    const moves = this.db.cashMovements.filter(m => m.dateTime.slice(0, 10) === date);
    const by = (t: string) => moves.filter(m => m.type === t).reduce((s, m) => s + m.amountPaisa, 0);
    const daySales = this.db.sales.filter(s => s.dateTime.slice(0, 10) === date);
    const pays = this.db.salePayments.filter(p => daySales.some(s => s.id === p.saleId));
    return {
      totalSalesPaisa: daySales.reduce((s, x) => s + x.totalPaisa, 0),
      cashSalesPaisa: pays.filter(p => p.method.toLowerCase() === 'cash').reduce((s, p) => s + p.amountPaisa, 0),
      nonCashSalesPaisa: pays.filter(p => p.method.toLowerCase() !== 'cash').reduce((s, p) => s + p.amountPaisa, 0),
      customerPaymentsPaisa: by('customer_payment'), refundsPaisa: -by('refund'),
      expensesPaisa: -by('expense') - (-by('expense_reversal') > 0 ? by('expense_reversal') : 0),
      supplierPaymentsPaisa: -by('supplier_payment'), cashInPaisa: by('cash_in'), cashOutPaisa: -by('cash_out'),
      expectedPaisa: this.expectedCash(date),
    };
  }
  closeDay(actor: T.SessionUser, date: string, countedPaisa: number, notes: string, discrepancyReason: string) {
    this.require(actor, 'cash.close');
    return this.tx(() => {
      const s = this.ensureSession(date);
      if (s.closedAt) throw new AppError('This day is already closed.');
      const expected = this.expectedCash(date);
      if (expected !== countedPaisa && !discrepancyReason.trim()) throw new AppError('Cash does not match the expected balance. A discrepancy reason is required.');
      s.expectedPaisa = expected; s.countedPaisa = countedPaisa; s.closedAt = nowISO(); s.closedBy = actor.id; s.notes = notes; s.discrepancyReason = discrepancyReason;
      this.log(actor, 'cash.close', `${date} expected ${expected} counted ${countedPaisa}`);
      return s;
    });
  }

  // ---------- financial aggregates ----------
  rangeStats(from: string, to: string) {
    const inRange = (iso: string) => { const d = iso.slice(0, 10); return d >= from && d <= to; };
    const sales = this.db.sales.filter(s => inRange(s.dateTime));
    const saleIds = new Set(sales.map(s => s.id));
    const items = this.db.saleItems.filter(i => saleIds.has(i.saleId));
    const grossRevenue = sales.reduce((s, x) => s + x.totalPaisa, 0);
    const rets = this.db.salesReturns.filter(r => inRange(r.dateTime));
    const retIds = new Set(rets.map(r => r.id));
    const retItems = this.db.salesReturnItems.filter(i => retIds.has(i.returnId));
    const returnsValue = rets.reduce((s, r) => s + r.refundPaisa, 0);
    const cogsGross = items.reduce((s, i) => s + i.allocations.reduce((a, al) => a + al.qty * al.costPaisa, 0), 0);
    const cogsReversed = retItems.reduce((s, i) => s + i.costReversedPaisa, 0);
    const netRevenue = grossRevenue - returnsValue;
    const cogs = cogsGross - cogsReversed;
    const expenses = this.db.expenses.filter(e => e.date >= from && e.date <= to).reduce((s, e) => s + e.amountPaisa, 0);
    const purchases = this.db.purchases.filter(p => p.date >= from && p.date <= to).reduce((s, p) => s + p.totalPaisa, 0);
    return {
      invoiceCount: sales.length, grossRevenue, returnsValue, netRevenue, cogs,
      grossProfit: netRevenue - cogs, expenses, netOperatingProfit: netRevenue - cogs - expenses, purchases,
    };
  }
  inventoryValuation(): number {
    const on = todayStr();
    return this.db.batches.filter(b => b.status === 'active' && !this.isExpired(b, on)).reduce((s, b) => s + b.qtyRemaining * b.costPaisa, 0);
  }
  alerts() {
    const on = todayStr(); const warnTo = addDays(on, this.db.settings.expiryWarnDays);
    const nearExpiry = this.db.batches.filter(b => b.status === 'active' && b.qtyRemaining > 0 && b.expiryDate > on && b.expiryDate <= warnTo);
    const expired = this.db.batches.filter(b => b.status === 'active' && b.qtyRemaining > 0 && this.isExpired(b, on));
    const lowStock = this.db.medicines.filter(m => m.active && this.saleableStock(m.id) <= m.minStock);
    return { nearExpiry, expired, lowStock };
  }
  topSelling(from: string, to: string, limit = 10) {
    const ids = new Set(this.db.sales.filter(s => { const d = s.dateTime.slice(0, 10); return d >= from && d <= to; }).map(s => s.id));
    const map = new Map<number, { medicineId: number; name: string; qty: number; revenuePaisa: number }>();
    for (const i of this.db.saleItems.filter(x => ids.has(x.saleId))) {
      const cur = map.get(i.medicineId) ?? { medicineId: i.medicineId, name: i.medicineName, qty: 0, revenuePaisa: 0 };
      cur.qty += i.qty; cur.revenuePaisa += i.lineTotalPaisa; map.set(i.medicineId, cur);
    }
    return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, limit);
  }
  salesTrend(days: number) {
    const out: { date: string; salesPaisa: number; invoices: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = addDays(todayStr(), -i);
      const day = this.db.sales.filter(s => s.dateTime.slice(0, 10) === d);
      out.push({ date: d, salesPaisa: day.reduce((s, x) => s + x.totalPaisa, 0), invoices: day.length });
    }
    return out;
  }

  // ---------- settings / backup / integrity ----------
  updateSettings(actor: T.SessionUser, patch: Partial<T.Settings>) {
    this.require(actor, 'settings.edit');
    return this.tx(() => { Object.assign(this.db.settings, patch); this.log(actor, 'settings.update', Object.keys(patch).join(', ')); });
  }
  exportBackup(): string {
    return JSON.stringify({ app: 'MedStore Manager', schemaVersion: this.db.version, exportedAt: nowISO(), data: this.db }, null, 2);
  }
  validateBackup(json: string): { ok: boolean; errors: string[]; summary?: string } {
    const errors: string[] = [];
    let parsed: any;
    try { parsed = JSON.parse(json); } catch { return { ok: false, errors: ['File is not valid JSON.'] }; }
    if (parsed.app !== 'MedStore Manager') errors.push('Not a MedStore Manager backup file.');
    const d = parsed.data;
    if (!d || typeof d !== 'object') errors.push('Backup data section missing.');
    else {
      for (const t of ['users', 'medicines', 'batches', 'sales', 'purchases', 'settings']) if (!(t in d)) errors.push(`Missing table: ${t}`);
      if (Array.isArray(d.batches)) for (const b of d.batches) if (b.qtyRemaining < 0) { errors.push(`Batch ${b.id} has negative stock.`); break; }
    }
    const summary = errors.length === 0 ? `Valid backup from ${parsed.exportedAt}: ${d.medicines?.length ?? 0} medicines, ${d.sales?.length ?? 0} sales, ${d.purchases?.length ?? 0} purchases.` : undefined;
    return { ok: errors.length === 0, errors, summary };
  }
  restoreBackup(actor: T.SessionUser, json: string): string {
    this.require(actor, 'backup.restore');
    const v = this.validateBackup(json);
    if (!v.ok) throw new AppError('Backup validation failed: ' + v.errors.join(' '));
    const safety = this.exportBackup(); // caller downloads this BEFORE the swap
    const parsed = JSON.parse(json);
    this.db = migrateDb({ ...emptyDb(), ...(parsed.data as T.DbState) }); // older (v1) backups upgrade in place
    this.log(actor, 'backup.restore', `Restored backup exported at ${parsed.exportedAt}`);
    this.save();
    const issues = this.integrityCheck();
    if (issues.length) throw new AppError('Restore completed but integrity check found issues: ' + issues.join('; '));
    return safety;
  }
  integrityCheck(): string[] {
    const issues: string[] = [];
    for (const b of this.db.batches) {
      const mvSum = this.db.movements.filter(m => m.batchId === b.id).reduce((s, m) => s + m.qty, 0);
      if (mvSum !== b.qtyRemaining) issues.push(`Batch ${b.batchNo} (id ${b.id}): remaining ${b.qtyRemaining} vs movements sum ${mvSum}`);
      if (b.qtyRemaining < 0) issues.push(`Batch ${b.batchNo} has negative quantity.`);
      if (!this.db.medicines.some(m => m.id === b.medicineId)) issues.push(`Batch ${b.id} references a missing medicine.`);
    }
    const barcodes = new Map<string, number>();
    for (const m of this.db.medicines) if (m.barcode) { const c = (barcodes.get(m.barcode) ?? 0) + 1; barcodes.set(m.barcode, c); if (c === 2) issues.push(`Duplicate barcode ${m.barcode}`); }
    const packBarcodes = new Map<string, number>();
    for (const r of this.db.medicineBarcodes) {
      if (r.active) { const c = (packBarcodes.get(r.barcode) ?? 0) + 1; packBarcodes.set(r.barcode, c); if (c === 2) issues.push(`Duplicate packaging barcode ${r.barcode}`); }
      if (!this.db.medicines.some(m => m.id === r.medicineId)) issues.push(`Barcode ${r.barcode} references a missing medicine.`);
      if (r.unitsPerPackage < 1) issues.push(`Barcode ${r.barcode} has invalid unitsPerPackage.`);
    }
    const invNos = new Set<string>(); for (const s of this.db.sales) { if (invNos.has(s.invoiceNo)) issues.push(`Duplicate invoice ${s.invoiceNo}`); invNos.add(s.invoiceNo); }
    return issues;
  }

  // ---------- sample data (clearly-labelled starter catalog) ----------
  seedSampleData(actor: T.SessionUser) {
    const cat = (name: string) => { const c = { id: this.id('categories'), name }; this.db.categories.push(c); return c.id; };
    const pain = cat('Pain Relief'), anti = cat('Antibiotics'), cold = cat('Cold & Flu'), supp = cat('Supplements');
    const sup: T.Supplier = { id: this.id('suppliers'), name: 'ABC Distribution', contactPerson: 'Osman', phone: '0300-0000000', address: 'Lahore', email: '', openingBalancePaisa: 0, notes: 'Sample supplier', active: true };
    this.db.suppliers.push(sup);
    const med = (m: Partial<T.Medicine> & { name: string }): T.Medicine => {
      const full: T.Medicine = { id: this.id('medicines'), genericName: '', brandName: '', barcode: '', categoryId: null, manufacturer: '', strength: '', dosageForm: 'Tablet', packSize: '', unit: 'strip', defaultCostPaisa: 0, retailPricePaisa: 0, minStock: 20, prescription: 'OTC', storage: 'Cool & dry place', notes: '', active: true, createdAt: nowISO(), updatedAt: nowISO(), ...m };
      this.db.medicines.push(full); this.syncPrimaryBarcode(full); return full;
    };
    const batch = (medicineId: number, batchNo: string, expiry: string, qty: number, costR: number, sellR: number) => {
      const b: T.Batch = { id: this.id('batches'), medicineId, batchNo, supplierId: sup.id, purchaseId: null, mfgDate: '', expiryDate: expiry, receivedDate: todayStr(), qtyReceived: qty, qtyRemaining: qty, costPaisa: toPaisa(costR), sellPricePaisa: toPaisa(sellR), status: 'active' };
      this.db.batches.push(b); this.move(actor, medicineId, b.id, 'opening_stock', qty, `BATCH-${b.id}`, 'Sample opening stock', b.costPaisa);
    };
    const panadol = med({ name: 'Panadol Extra', genericName: 'Paracetamol + Caffeine', brandName: 'Panadol', barcode: '8964001234500', categoryId: pain, manufacturer: 'GSK', strength: '500mg', packSize: '10 tablets/strip', retailPricePaisa: toPaisa(35), defaultCostPaisa: toPaisa(28) });
    batch(panadol.id, 'PN-2401', addDays(todayStr(), 45), 100, 26, 35);           // earlier expiry → FEFO sells this first
    batch(panadol.id, 'PN-2408', addDays(todayStr(), 400), 200, 28, 35);
    const brufen = med({ name: 'Brufen', genericName: 'Ibuprofen', brandName: 'Brufen', barcode: '8964001234517', categoryId: pain, manufacturer: 'Abbott', strength: '400mg', retailPricePaisa: toPaisa(60), defaultCostPaisa: toPaisa(48) });
    batch(brufen.id, 'BR-110', addDays(todayStr(), 300), 80, 48, 60);
    const augmentin = med({ name: 'Augmentin', genericName: 'Co-Amoxiclav', brandName: 'Augmentin', barcode: '8964001234524', categoryId: anti, manufacturer: 'GSK', strength: '375mg', prescription: 'Rx', retailPricePaisa: toPaisa(420), defaultCostPaisa: toPaisa(360) });
    batch(augmentin.id, 'AG-77', addDays(todayStr(), 200), 40, 360, 420);
    batch(augmentin.id, 'AG-OLD', addDays(todayStr(), -20), 15, 350, 420);        // expired on purpose — must never be sold
    const hydryllin = med({ name: 'Hydryllin Syrup', genericName: 'Diphenhydramine', brandName: 'Hydryllin', barcode: '8964001234531', categoryId: cold, manufacturer: 'Searle', strength: '120ml', dosageForm: 'Syrup', unit: 'bottle', retailPricePaisa: toPaisa(180), defaultCostPaisa: toPaisa(145) });
    batch(hydryllin.id, 'HY-31', addDays(todayStr(), 25), 30, 145, 180);          // near expiry alert
    const surbex = med({ name: 'Surbex-Z', genericName: 'Multivitamin + Zinc', brandName: 'Surbex-Z', barcode: '8964001234548', categoryId: supp, manufacturer: 'Abbott', strength: '30 tablets', unit: 'bottle', retailPricePaisa: toPaisa(1450), defaultCostPaisa: toPaisa(1200), minStock: 15 });
    batch(surbex.id, 'SZ-09', addDays(todayStr(), 500), 10, 1200, 1450);          // low stock alert
    const cust: T.Customer = { id: this.id('customers'), name: 'Muhammad (Sample)', phone: '0321-0000000', address: 'Mardan', openingBalancePaisa: 0, notes: 'Sample customer — delete when ready', active: true };
    this.db.customers.push(cust);
    // Sample packaging barcode: one Panadol BOX = 10 strips @ Rs 350/box.
    // Scanning it in POS adds 10 strips worth of stock consumption.
    this.db.medicineBarcodes.push({
      id: this.id('medicineBarcodes'), medicineId: panadol.id, barcode: '8964001234593',
      packagingLevel: 'box', unitsPerPackage: 10, sellPricePaisa: toPaisa(350), purchaseCostPaisa: toPaisa(280),
      isPrimary: false, active: true,
    });
    this.log(actor, 'seed', 'Sample starter catalog loaded');
  }
  clearAllData(actor: T.SessionUser, keepUsers: boolean) {
    this.require(actor, 'settings.edit');
    return this.tx(() => {
      const users = keepUsers ? this.db.users : [];
      const settings = { ...this.db.settings, nextInvoiceSeq: 1, nextSaleReturnSeq: 1, nextPurchaseReturnSeq: 1 };
      this.db = emptyDb(); this.db.users = users; this.db.settings = settings; this.db.settings.setupDone = keepUsers;
      if (keepUsers) this.db.customers.push({ id: this.id('customers'), name: 'Walk-in Customer', phone: '', address: '', openingBalancePaisa: 0, notes: '', active: true });
      this.log(actor, 'data.clear', 'All business data cleared by administrator');
    });
  }
}
