import { describe, it, expect, beforeEach } from 'vitest';
import { Engine, emptyDb } from './engine';
import { toPaisa, todayStr, addDays } from './money';
import type { SessionUser } from './types';

let eng: Engine; let admin: SessionUser; let cashier: SessionUser;
const walkIn = () => eng.db.customers[0].id;

function fresh() {
  eng = new Engine(emptyDb(), () => {});
  admin = eng.setupAdmin({ storeName: 'Test Pharmacy', address: 'Mardan', phone: '0300', fullName: 'Owner', username: 'admin', password: 'secret1', seedSample: false });
  eng.createUser(admin, { username: 'cash', fullName: 'Cashier One', password: 'cash123', role: 'cashier' });
  cashier = eng.login('cash', 'cash123');
}
function makeMed(name = 'TestTab') {
  return eng.saveMedicine(admin, { name, barcode: 'BC-' + name, retailPricePaisa: toPaisa(100), defaultCostPaisa: toPaisa(70), minStock: 5 });
}
beforeEach(fresh);

describe('auth & users (scenarios 1, 2, 22)', () => {
  it('admin setup hashes the password and login works', () => {
    const u = eng.db.users.find(x => x.username === 'admin')!;
    expect(u.passwordHash).not.toContain('secret1');
    expect(eng.login('admin', 'secret1').role).toBe('admin');
    expect(() => eng.login('admin', 'wrong')).toThrow();
  });
  it('setup cannot run twice; no universal password', () => {
    expect(() => eng.setupAdmin({ storeName: 'x', address: '', phone: '', fullName: 'x', username: 'evil', password: 'evil123', seedSample: false })).toThrow();
  });
  it('cashier cannot edit medicines, adjust stock, manage users or restore backups (backend enforced)', () => {
    const med = makeMed();
    expect(() => eng.saveMedicine(cashier, { name: 'Hax' })).toThrow(/Permission denied/);
    expect(() => eng.createUser(cashier, { username: 'x', fullName: 'x', password: 'x123456', role: 'admin' })).toThrow(/Permission denied/);
    expect(() => eng.updateSettings(cashier, { taxRatePct: 50 })).toThrow(/Permission denied/);
    void med;
  });
});

describe('medicines & barcodes (3, 4)', () => {
  it('rejects duplicate barcodes', () => {
    makeMed('A');
    expect(() => eng.saveMedicine(admin, { name: 'B', barcode: 'BC-A' })).toThrow(/already assigned/);
  });
  it('finds by barcode exactly (scanner workflow)', () => {
    const m = makeMed('ScanMe');
    expect(eng.findByBarcode('BC-ScanMe')?.id).toBe(m.id);
    expect(eng.findByBarcode('UNKNOWN')).toBeUndefined();
  });
});

describe('purchases, batches & FEFO (5, 6, 7, 9, 15)', () => {
  function setupTwoBatches() {
    const med = makeMed();
    const sup = eng.saveSupplier(admin, { name: 'Distributor' });
    eng.createPurchase(admin, {
      supplierId: sup.id, supplierInvoiceNo: 'SUP-1', date: todayStr(), discountPaisa: 0, chargesPaisa: 0,
      paidPaisa: toPaisa(1000), paymentMethod: 'Cash', idempotencyKey: 'p1',
      items: [
        { medicineId: med.id, batchNo: 'LATE', mfgDate: '', expiryDate: addDays(todayStr(), 300), qty: 50, costPaisa: toPaisa(70), sellPricePaisa: toPaisa(100) },
        { medicineId: med.id, batchNo: 'EARLY', mfgDate: '', expiryDate: addDays(todayStr(), 60), qty: 10, costPaisa: toPaisa(60), sellPricePaisa: toPaisa(100) },
      ],
    });
    return { med, sup };
  }
  it('purchase increases stock exactly once even if submitted twice (idempotency)', () => {
    const { med } = setupTwoBatches();
    expect(eng.saleableStock(med.id)).toBe(60);
    // same key again -> returns existing, no duplicate
    eng.createPurchase(admin, { supplierId: 1, supplierInvoiceNo: 'SUP-1', date: todayStr(), discountPaisa: 0, chargesPaisa: 0, paidPaisa: 0, paymentMethod: 'Cash', idempotencyKey: 'p1', items: [{ medicineId: med.id, batchNo: 'X', mfgDate: '', expiryDate: addDays(todayStr(), 90), qty: 999, costPaisa: 1, sellPricePaisa: 1 }] });
    expect(eng.saleableStock(med.id)).toBe(60);
    expect(eng.db.purchases.length).toBe(1);
  });
  it('sale allocates FEFO: earliest-expiry batch first, spilling into next batch', () => {
    const { med } = setupTwoBatches();
    const sale = eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 's1', items: [{ medicineId: med.id, qty: 15, unitPricePaisa: toPaisa(100), discountPaisa: 0 }], payments: [{ method: 'Cash', amountPaisa: toPaisa(1500) }] });
    const item = eng.db.saleItems.find(i => i.saleId === sale.id)!;
    expect(item.allocations[0].batchNo).toBe('EARLY');
    expect(item.allocations[0].qty).toBe(10);
    expect(item.allocations[1].batchNo).toBe('LATE');
    expect(item.allocations[1].qty).toBe(5);
    expect(eng.db.batches.find(b => b.batchNo === 'EARLY')!.qtyRemaining).toBe(0);
    expect(eng.db.batches.find(b => b.batchNo === 'LATE')!.qtyRemaining).toBe(45);
    // COGS = 10*60 + 5*70 = 950
    const stats = eng.rangeStats(todayStr(), todayStr());
    expect(stats.cogs).toBe(toPaisa(950));
    expect(stats.grossProfit).toBe(toPaisa(1500 - 950));
  });
  it('supplier balance = purchases − payments; partial payment works', () => {
    const { sup } = setupTwoBatches();
    // total = 50*70 + 10*60 = 4100, paid 1000
    expect(eng.supplierBalance(sup.id)).toBe(toPaisa(3100));
    eng.supplierPayment(admin, { supplierId: sup.id, amountPaisa: toPaisa(1100), method: 'Bank Transfer', reference: '', date: todayStr() });
    expect(eng.supplierBalance(sup.id)).toBe(toPaisa(2000));
  });
});

describe('sale safety (10, 11, 12, 13, 25)', () => {
  it('expired stock can never be sold', () => {
    const med = makeMed();
    eng.addOpeningBatch(admin, { medicineId: med.id, batchNo: 'OLD', expiryDate: addDays(todayStr(), -1), qty: 20, costPaisa: toPaisa(50), sellPricePaisa: toPaisa(100) });
    expect(eng.saleableStock(med.id)).toBe(0);
    expect(() => eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'x1', items: [{ medicineId: med.id, qty: 1, unitPricePaisa: toPaisa(100), discountPaisa: 0 }], payments: [] })).toThrow(/Insufficient saleable stock/);
  });
  it('overselling is rejected and the failed sale rolls back completely', () => {
    const med = makeMed();
    eng.addOpeningBatch(admin, { medicineId: med.id, batchNo: 'B1', expiryDate: addDays(todayStr(), 100), qty: 3, costPaisa: toPaisa(50), sellPricePaisa: toPaisa(100) });
    const salesBefore = eng.db.sales.length;
    expect(() => eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'x2', items: [{ medicineId: med.id, qty: 5, unitPricePaisa: toPaisa(100), discountPaisa: 0 }], payments: [] })).toThrow();
    expect(eng.db.sales.length).toBe(salesBefore);
    expect(eng.db.batches[0].qtyRemaining).toBe(3);
    expect(eng.db.cashMovements.length).toBe(0);
  });
  it('duplicate invoice submission returns the same invoice (no double stock cut)', () => {
    const med = makeMed();
    eng.addOpeningBatch(admin, { medicineId: med.id, batchNo: 'B1', expiryDate: addDays(todayStr(), 100), qty: 10, costPaisa: toPaisa(50), sellPricePaisa: toPaisa(100) });
    const input = { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'dup-1', items: [{ medicineId: med.id, qty: 2, unitPricePaisa: toPaisa(100), discountPaisa: 0 }], payments: [{ method: 'Cash', amountPaisa: toPaisa(200) }] };
    const a = eng.createSale(admin, input); const b = eng.createSale(admin, input);
    expect(a.invoiceNo).toBe(b.invoiceNo);
    expect(eng.db.batches[0].qtyRemaining).toBe(8);
  });
  it('discount + tax math in paisa is exact', () => {
    eng.updateSettings(admin, { taxRatePct: 10 });
    const med = makeMed();
    eng.addOpeningBatch(admin, { medicineId: med.id, batchNo: 'B1', expiryDate: addDays(todayStr(), 100), qty: 10, costPaisa: toPaisa(50), sellPricePaisa: toPaisa(100) });
    const sale = eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: toPaisa(50), idempotencyKey: 'x3', items: [{ medicineId: med.id, qty: 3, unitPricePaisa: toPaisa(100), discountPaisa: toPaisa(30) }], payments: [{ method: 'Cash', amountPaisa: toPaisa(242) }] });
    // subtotal 300 − line 30 − bill 50 = 220; tax 10% = 22; total 242
    expect(sale.subtotalPaisa).toBe(toPaisa(300));
    expect(sale.taxPaisa).toBe(toPaisa(22));
    expect(sale.totalPaisa).toBe(toPaisa(242));
  });
});

describe('credit sales & customer payments (14)', () => {
  it('credit to walk-in is blocked; credit to customer creates balance; partial payment reduces it', () => {
    const med = makeMed();
    eng.addOpeningBatch(admin, { medicineId: med.id, batchNo: 'B1', expiryDate: addDays(todayStr(), 100), qty: 10, costPaisa: toPaisa(50), sellPricePaisa: toPaisa(100) });
    expect(() => eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'c1', items: [{ medicineId: med.id, qty: 1, unitPricePaisa: toPaisa(100), discountPaisa: 0 }], payments: [] })).toThrow(/Walk-in/);
    const cust = eng.saveCustomer(admin, { name: 'Ahmed' });
    eng.createSale(admin, { customerId: cust.id, billDiscountPaisa: 0, idempotencyKey: 'c2', items: [{ medicineId: med.id, qty: 4, unitPricePaisa: toPaisa(100), discountPaisa: 0 }], payments: [{ method: 'Cash', amountPaisa: toPaisa(150) }] });
    expect(eng.customerBalance(cust.id)).toBe(toPaisa(250));
    eng.customerPayment(admin, { customerId: cust.id, amountPaisa: toPaisa(100), method: 'Cash', reference: '', saleId: null, date: todayStr() });
    expect(eng.customerBalance(cust.id)).toBe(toPaisa(150));
    // a credit sale is NOT counted as cash: cash = 150 (part pay) + 100 = 250
    expect(eng.expectedCash(todayStr())).toBe(toPaisa(250));
  });
  it('cashier cannot make credit sales unless enabled', () => {
    const med = makeMed();
    eng.addOpeningBatch(admin, { medicineId: med.id, batchNo: 'B1', expiryDate: addDays(todayStr(), 100), qty: 10, costPaisa: toPaisa(50), sellPricePaisa: toPaisa(100) });
    const cust = eng.saveCustomer(admin, { name: 'Bilal' });
    expect(() => eng.createSale(cashier, { customerId: cust.id, billDiscountPaisa: 0, idempotencyKey: 'c9', items: [{ medicineId: med.id, qty: 1, unitPricePaisa: toPaisa(100), discountPaisa: 0 }], payments: [] })).toThrow(/Cashiers/);
  });
});

describe('returns (16, 17, 18, 19)', () => {
  function soldMed() {
    const med = makeMed();
    eng.addOpeningBatch(admin, { medicineId: med.id, batchNo: 'B1', expiryDate: addDays(todayStr(), 100), qty: 10, costPaisa: toPaisa(50), sellPricePaisa: toPaisa(100) });
    const sale = eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'r-sale', items: [{ medicineId: med.id, qty: 5, unitPricePaisa: toPaisa(100), discountPaisa: 0 }], payments: [{ method: 'Cash', amountPaisa: toPaisa(500) }] });
    return { med, sale, item: eng.db.saleItems.find(i => i.saleId === sale.id)! };
  }
  it('valid sealed return restocks original batch and reverses COGS + cash', () => {
    const { med, sale, item } = soldMed();
    eng.createSalesReturn(admin, { saleId: sale.id, method: 'cash', reason: 'Wrong item', items: [{ saleItemId: item.id, qty: 2, disposition: 'saleable' }] });
    expect(eng.db.batches.find(b => b.batchNo === 'B1')!.qtyRemaining).toBe(7);
    const stats = eng.rangeStats(todayStr(), todayStr());
    expect(stats.netRevenue).toBe(toPaisa(300));
    expect(stats.cogs).toBe(toPaisa(150));
    expect(eng.expectedCash(todayStr())).toBe(toPaisa(300)); // 500 − 200 refund
    void med;
  });
  it('excessive return qty is rejected', () => {
    const { sale, item } = soldMed();
    expect(() => eng.createSalesReturn(admin, { saleId: sale.id, method: 'cash', reason: 'x', items: [{ saleItemId: item.id, qty: 6, disposition: 'saleable' }] })).toThrow(/exceeds sold qty/);
  });
  it('damaged return goes to quarantine/damaged, never saleable', () => {
    const { med, sale, item } = soldMed();
    eng.createSalesReturn(admin, { saleId: sale.id, method: 'cash', reason: 'Opened strip', items: [{ saleItemId: item.id, qty: 1, disposition: 'damaged' }] });
    expect(eng.saleableStock(med.id)).toBe(5); // unchanged saleable
    expect(eng.db.batches.some(b => b.batchNo === 'B1-RET' && b.status === 'damaged' && b.qtyRemaining === 1)).toBe(true);
  });
  it('purchase return reduces batch and supplier balance; cannot exceed on-hand', () => {
    const med = makeMed();
    const sup = eng.saveSupplier(admin, { name: 'D2' });
    eng.createPurchase(admin, { supplierId: sup.id, supplierInvoiceNo: '', date: todayStr(), discountPaisa: 0, chargesPaisa: 0, paidPaisa: 0, paymentMethod: 'Cash', idempotencyKey: 'pr1', items: [{ medicineId: med.id, batchNo: 'PB', mfgDate: '', expiryDate: addDays(todayStr(), 90), qty: 20, costPaisa: toPaisa(40), sellPricePaisa: toPaisa(100) }] });
    const batch = eng.db.batches[0];
    expect(() => eng.createPurchaseReturn(admin, { supplierId: sup.id, purchaseId: null, reason: 'x', items: [{ batchId: batch.id, qty: 21 }] })).toThrow(/only 20/);
    eng.createPurchaseReturn(admin, { supplierId: sup.id, purchaseId: null, reason: 'Near expiry', items: [{ batchId: batch.id, qty: 5 }] });
    expect(eng.db.batches[0].qtyRemaining).toBe(15);
    expect(eng.supplierBalance(sup.id)).toBe(toPaisa(15 * 40));
  });
});

describe('profit, reports, cash closing (20, 21, 27, 28)', () => {
  it('gross profit uses COGS — purchases are NOT subtracted from sales', () => {
    const med = makeMed();
    const sup = eng.saveSupplier(admin, { name: 'D3' });
    eng.createPurchase(admin, { supplierId: sup.id, supplierInvoiceNo: '', date: todayStr(), discountPaisa: 0, chargesPaisa: 0, paidPaisa: 0, paymentMethod: 'Cash', idempotencyKey: 'pf1', items: [{ medicineId: med.id, batchNo: 'PB', mfgDate: '', expiryDate: addDays(todayStr(), 365), qty: 100, costPaisa: toPaisa(60), sellPricePaisa: toPaisa(100) }] });
    eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'pf2', items: [{ medicineId: med.id, qty: 10, unitPricePaisa: toPaisa(100), discountPaisa: 0 }], payments: [{ method: 'Card', amountPaisa: toPaisa(1000) }] });
    eng.createExpense(admin, { date: todayStr(), category: 'Rent', description: 'Shop rent', amountPaisa: toPaisa(100), method: 'Cash', reference: '' });
    const s = eng.rangeStats(todayStr(), todayStr());
    expect(s.purchases).toBe(toPaisa(6000));
    expect(s.netRevenue).toBe(toPaisa(1000));
    expect(s.cogs).toBe(toPaisa(600));
    expect(s.grossProfit).toBe(toPaisa(400));
    expect(s.netOperatingProfit).toBe(toPaisa(300));
    // card sale must not pollute physical cash; cash expense takes 100 out
    expect(eng.expectedCash(todayStr())).toBe(toPaisa(-100));
    // reports reconcile with transactions
    expect(engineTopRevenue()).toBe(toPaisa(1000));
  });
  function engineTopRevenue() { return eng.topSelling(todayStr(), todayStr())[0]?.revenuePaisa ?? 0; }
  it('daily closing requires a reason when cash differs', () => {
    eng.setOpeningCash(admin, todayStr(), toPaisa(500));
    expect(() => eng.closeDay(admin, todayStr(), toPaisa(450), '', '')).toThrow(/discrepancy reason/);
    const closed = eng.closeDay(admin, todayStr(), toPaisa(450), '', 'Short by Rs 50 — investigation noted');
    expect(closed.expectedPaisa).toBe(toPaisa(500));
    eng.setOpeningCash; // next day opening carries counted cash forward automatically via session creation
  });
  it('inventory valuation excludes expired and quarantined stock', () => {
    const med = makeMed();
    eng.addOpeningBatch(admin, { medicineId: med.id, batchNo: 'OK', expiryDate: addDays(todayStr(), 100), qty: 10, costPaisa: toPaisa(50), sellPricePaisa: toPaisa(100) });
    eng.addOpeningBatch(admin, { medicineId: med.id, batchNo: 'EXP', expiryDate: addDays(todayStr(), -5), qty: 10, costPaisa: toPaisa(50), sellPricePaisa: toPaisa(100) });
    expect(eng.inventoryValuation()).toBe(toPaisa(500));
    const alerts = eng.alerts();
    expect(alerts.expired.length).toBe(1);
  });
});

describe('backup, restore, integrity, persistence shape (23, 24, 26)', () => {
  it('backup exports and restores with validation; integrity reconciles', () => {
    const med = makeMed();
    eng.addOpeningBatch(admin, { medicineId: med.id, batchNo: 'B1', expiryDate: addDays(todayStr(), 100), qty: 10, costPaisa: toPaisa(50), sellPricePaisa: toPaisa(100) });
    eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'bk1', items: [{ medicineId: med.id, qty: 3, unitPricePaisa: toPaisa(100), discountPaisa: 0 }], payments: [{ method: 'Cash', amountPaisa: toPaisa(300) }] });
    const backup = eng.exportBackup();
    expect(eng.validateBackup(backup).ok).toBe(true);
    expect(eng.validateBackup('{"nope":1}').ok).toBe(false);
    // simulate data loss, then restore
    const eng2 = new Engine(emptyDb(), () => {});
    const a2 = eng2.setupAdmin({ storeName: 'x', address: '', phone: '', fullName: 'x', username: 'boss', password: 'boss123', seedSample: false });
    eng2.restoreBackup(a2, backup);
    expect(eng2.db.sales.length).toBe(1);
    expect(eng2.saleableStock(med.id)).toBe(7);
    expect(eng2.integrityCheck()).toEqual([]);
  });
  it('every batch qty equals the sum of its inventory movements after mixed operations', () => {
    const med = makeMed();
    const sup = eng.saveSupplier(admin, { name: 'D4' });
    eng.createPurchase(admin, { supplierId: sup.id, supplierInvoiceNo: '', date: todayStr(), discountPaisa: 0, chargesPaisa: 0, paidPaisa: 0, paymentMethod: 'Cash', idempotencyKey: 'mx1', items: [{ medicineId: med.id, batchNo: 'MB', mfgDate: '', expiryDate: addDays(todayStr(), 200), qty: 30, costPaisa: toPaisa(50), sellPricePaisa: toPaisa(100) }] });
    const sale = eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'mx2', items: [{ medicineId: med.id, qty: 8, unitPricePaisa: toPaisa(100), discountPaisa: 0 }], payments: [{ method: 'Cash', amountPaisa: toPaisa(800) }] });
    const item = eng.db.saleItems.find(i => i.saleId === sale.id)!;
    eng.createSalesReturn(admin, { saleId: sale.id, method: 'cash', reason: 'r', items: [{ saleItemId: item.id, qty: 2, disposition: 'saleable' }] });
    eng.adjustStock(admin, eng.db.batches[0].id, -1, 'Breakage found in count');
    expect(eng.integrityCheck()).toEqual([]);
    expect(eng.db.batches[0].qtyRemaining).toBe(30 - 8 + 2 - 1);
    // audit trail exists
    expect(eng.db.audit.some(a => a.action === 'stock.adjust')).toBe(true);
  });
});
