import { describe, it, expect, beforeEach } from 'vitest';
import { Engine, emptyDb } from './engine';
import { toPaisa, todayStr, addDays, localDateOf } from './money';
import type { SessionUser } from './types';

let eng: Engine; let admin: SessionUser; let pharm: SessionUser; let cashier: SessionUser;
const walkIn = () => eng.db.customers[0].id;

function fresh() {
  eng = new Engine(emptyDb(), () => {});
  admin = eng.setupAdmin({ storeName: 'Fix Test', address: '', phone: '', fullName: 'Owner', username: 'admin', password: 'secret1', seedSample: false });
  eng.createUser(admin, { username: 'pharm', fullName: 'Pharmacist', password: 'pharm123', role: 'pharmacist' });
  eng.createUser(admin, { username: 'cash', fullName: 'Cashier', password: 'cash123', role: 'cashier' });
  pharm = eng.login('pharm', 'pharm123');
  cashier = eng.login('cash', 'cash123');
}
function stockedMed(cost = 26, price = 35, qty = 100) {
  const med = eng.saveMedicine(admin, { name: 'Panadol Extra', barcode: 'T-1', retailPricePaisa: toPaisa(price), defaultCostPaisa: toPaisa(cost) });
  eng.addOpeningBatch(admin, { medicineId: med.id, batchNo: 'PN-1', expiryDate: addDays(todayStr(), 200), qty, costPaisa: toPaisa(cost), sellPricePaisa: toPaisa(price) });
  return med;
}
beforeEach(fresh);

describe('local-date attribution (REPORT-02/03/04 root fix)', () => {
  it('localDateOf uses the LOCAL calendar day, not the UTC slice', () => {
    const local = new Date(); local.setHours(0, 30, 0, 0); // 00:30 local today
    expect(localDateOf(local.toISOString())).toBe(todayStr());
    expect(localDateOf('2026-03-05')).toBe('2026-03-05'); // plain dates pass through
  });
  it('a transaction at 00:30 local time belongs to that business day in stats, cash and lists', () => {
    const med = stockedMed();
    const sale = eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'tz-1', items: [{ medicineId: med.id, qty: 2, unitPricePaisa: toPaisa(35), discountPaisa: 0 }], payments: [{ method: 'Cash', amountPaisa: toPaisa(70) }] });
    // Move the sale (and its cash movement) to 00:30 local time TODAY — in UTC that
    // timestamp falls on the previous calendar day for timezones ahead of UTC.
    const local = new Date(); local.setHours(0, 30, 0, 0);
    const iso = local.toISOString();
    eng.db.sales.find(s => s.id === sale.id)!.dateTime = iso;
    eng.db.cashMovements.forEach(m => { m.dateTime = iso; });
    const stats = eng.rangeStats(todayStr(), todayStr());
    expect(stats.invoiceCount).toBe(1);
    expect(stats.netRevenue).toBe(toPaisa(70));
    expect(eng.expectedCash(todayStr())).toBe(toPaisa(70));
    expect(eng.listSales(admin, { from: todayStr(), to: todayStr() }).length).toBe(1);
    expect(eng.rangeStats(addDays(todayStr(), -1), addDays(todayStr(), -1)).invoiceCount).toBe(0);
  });
});

describe('report reconciliation (REPORT-01/03)', () => {
  it('summary, by-medicine and by-category COGS all reconcile; both returns reduce net sales', () => {
    const med = stockedMed(26, 35, 100);
    // Sell 10 (gross 350) + sell 1 more on a second invoice => reproducible totals
    const s1 = eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'rc-1', items: [{ medicineId: med.id, qty: 10, unitPricePaisa: toPaisa(35), discountPaisa: 0 }], payments: [{ method: 'Cash', amountPaisa: toPaisa(350) }] });
    const item = eng.db.saleItems.find(i => i.saleId === s1.id)!;
    // Sealed return of 1 (refund 35, cost 26 reverses) and damaged return of 1 (refund 35, cost stays)
    eng.createSalesReturn(admin, { saleId: s1.id, method: 'cash', reason: 'sealed', items: [{ saleItemId: item.id, qty: 1, disposition: 'saleable' }] });
    eng.createSalesReturn(admin, { saleId: s1.id, method: 'cash', reason: 'opened', items: [{ saleItemId: item.id, qty: 1, disposition: 'damaged' }] });

    const stats = eng.rangeStats(todayStr(), todayStr());
    expect(stats.grossRevenue).toBe(toPaisa(350));
    expect(stats.returnsValue).toBe(toPaisa(70));       // BOTH returns counted
    expect(stats.netRevenue).toBe(toPaisa(280));
    expect(stats.cogs).toBe(toPaisa(260 - 26));          // only the saleable return reverses COGS
    const byMed = eng.salesGrouped(todayStr(), todayStr(), 'medicine');
    const byCat = eng.salesGrouped(todayStr(), todayStr(), 'category');
    expect(byMed.reduce((s, r) => s + r.cogsPaisa, 0)).toBe(stats.cogs);
    expect(byCat.reduce((s, r) => s + r.cogsPaisa, 0)).toBe(stats.cogs);
    expect(byMed[0].qty).toBe(8);
    expect(byMed[0].revenuePaisa).toBe(toPaisa(280));
    // stock movements include BOTH returns (REPORT-04)
    const mv = eng.db.movements.filter(m => m.type.startsWith('sales_return'));
    expect(mv.length).toBe(2);
    // damaged unit did not rejoin saleable stock: 100 - 10 + 1 = 91 saleable
    expect(eng.saleableStock(med.id)).toBe(91);
    expect(eng.integrityCheck()).toEqual([]);
  });
});

describe('cash closing lock (CASH-01)', () => {
  it('after closing, cash-in/out, cash sales and opening-cash changes are blocked; snapshot stays intact', () => {
    const med = stockedMed();
    eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'cc-1', items: [{ medicineId: med.id, qty: 2, unitPricePaisa: toPaisa(35), discountPaisa: 0 }], payments: [{ method: 'Cash', amountPaisa: toPaisa(70) }] });
    const closed = eng.closeDay(admin, todayStr(), toPaisa(70), '', '');
    expect(closed.expectedPaisa).toBe(toPaisa(70));

    expect(() => eng.cashAdjustment(admin, toPaisa(100), 'owner top-up')).toThrow(/already closed/);
    expect(() => eng.setOpeningCash(admin, todayStr(), 0)).toThrow(/already closed/);
    const salesBefore = eng.db.sales.length;
    expect(() => eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'cc-2', items: [{ medicineId: med.id, qty: 1, unitPricePaisa: toPaisa(35), discountPaisa: 0 }], payments: [{ method: 'Cash', amountPaisa: toPaisa(35) }] })).toThrow(/already closed/);
    expect(eng.db.sales.length).toBe(salesBefore); // rolled back
    const session = eng.db.cashSessions.find(s => s.date === todayStr())!;
    expect(session.expectedPaisa).toBe(toPaisa(70)); // snapshot untouched
    expect(session.countedPaisa).toBe(toPaisa(70));

    // Reopen requires a reason and an admin; the reopening is audited with the old snapshot.
    expect(() => eng.reopenDay(admin, todayStr(), '')).toThrow(/reason/);
    eng.reopenDay(admin, todayStr(), 'Forgot to record morning float');
    expect(eng.db.audit.some(a => a.action === 'cash.reopen' && /previous snapshot/.test(a.details))).toBe(true);
    eng.cashAdjustment(admin, toPaisa(100), 'owner top-up'); // now allowed
    expect(eng.expectedCash(todayStr())).toBe(toPaisa(170));
    eng.closeDay(admin, todayStr(), toPaisa(170), '', ''); // can close again
  });
  it('non-cash sales still work on a closed cash day (no cash movement created)', () => {
    const med = stockedMed();
    eng.closeDay(admin, todayStr(), 0, '', '');
    const sale = eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'cc-3', items: [{ medicineId: med.id, qty: 1, unitPricePaisa: toPaisa(35), discountPaisa: 0 }], payments: [{ method: 'Card', amountPaisa: toPaisa(35) }] });
    expect(sale.totalPaisa).toBe(toPaisa(35));
  });
});

describe('payment validation (SUPPLIER-PAY-01 / CUSTOMER-PAY-01)', () => {
  it('supplier overpayment requires explicit advance confirmation', () => {
    const med = stockedMed();
    const sup = eng.saveSupplier(admin, { name: 'Dist' });
    eng.createPurchase(admin, { supplierId: sup.id, supplierInvoiceNo: '', date: todayStr(), discountPaisa: 0, chargesPaisa: 0, paidPaisa: 0, paymentMethod: 'Cash', idempotencyKey: 'sp-1', items: [{ medicineId: med.id, batchNo: 'B2', mfgDate: '', expiryDate: addDays(todayStr(), 365), qty: 10, costPaisa: toPaisa(20), sellPricePaisa: toPaisa(35) }] });
    expect(eng.supplierBalance(sup.id)).toBe(toPaisa(200));
    expect(() => eng.supplierPayment(admin, { supplierId: sup.id, amountPaisa: toPaisa(250), method: 'Bank Transfer', reference: '', date: todayStr() })).toThrow(/exceeds the outstanding/);
    eng.supplierPayment(admin, { supplierId: sup.id, amountPaisa: toPaisa(250), method: 'Bank Transfer', reference: '', date: todayStr(), allowAdvance: true });
    expect(eng.supplierBalance(sup.id)).toBe(toPaisa(-50)); // 50 supplier credit
    expect(eng.db.audit.some(a => a.action === 'supplier.advance')).toBe(true);
  });
  it('customer payments reject zero/negative; legitimate advances are allowed', () => {
    const cust = eng.saveCustomer(admin, { name: 'Ali' });
    expect(() => eng.customerPayment(admin, { customerId: cust.id, amountPaisa: 0, method: 'Cash', reference: '', saleId: null, date: todayStr() })).toThrow(/positive/);
    expect(() => eng.customerPayment(admin, { customerId: cust.id, amountPaisa: -100, method: 'Cash', reference: '', saleId: null, date: todayStr() })).toThrow(/positive/);
    eng.customerPayment(admin, { customerId: cust.id, amountPaisa: toPaisa(500), method: 'Cash', reference: '', saleId: null, date: todayStr() });
    expect(eng.customerBalance(cust.id)).toBe(toPaisa(-500)); // advance held
  });
});

describe('expense reversal (EXPENSE-REVERSAL-01)', () => {
  it('keeps the record, restores cash, audits expense.reverse, and reports exclude it', () => {
    const e = eng.createExpense(admin, { date: todayStr(), category: 'Rent', description: 'October rent', amountPaisa: toPaisa(1000), method: 'Cash', reference: '' });
    expect(eng.expectedCash(todayStr())).toBe(toPaisa(-1000));
    eng.reverseExpense(admin, e.id, 'Entered twice');
    const after = eng.db.expenses.find(x => x.id === e.id)!;
    expect(after).toBeTruthy(); // NOT deleted
    expect(after.reversedAt).toBeTruthy();
    expect(after.reversalReason).toBe('Entered twice');
    expect(eng.expectedCash(todayStr())).toBe(0);
    expect(eng.rangeStats(todayStr(), todayStr()).expenses).toBe(0);
    expect(eng.db.audit.some(a => a.action === 'expense.reverse')).toBe(true);
    expect(eng.db.audit.some(a => a.action === 'expense.delete')).toBe(false);
    expect(() => eng.reverseExpense(admin, e.id, 'again')).toThrow(/already been reversed/);
    expect(eng.dayCashSummary(todayStr()).expensesPaisa).toBe(0);
  });
});

describe('sales visibility & balance adjustment (CASHIER-PERM-01 / CUSTOMER-OPENING-01)', () => {
  it('cashier lists only own sales at engine level; admin sees all', () => {
    const med = stockedMed();
    eng.createSale(cashier, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'sv-1', items: [{ medicineId: med.id, qty: 1, unitPricePaisa: toPaisa(35), discountPaisa: 0 }], payments: [{ method: 'Cash', amountPaisa: toPaisa(35) }] });
    eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'sv-2', items: [{ medicineId: med.id, qty: 1, unitPricePaisa: toPaisa(35), discountPaisa: 0 }], payments: [{ method: 'Cash', amountPaisa: toPaisa(35) }] });
    const mine = eng.listSales(cashier, { from: todayStr(), to: todayStr() });
    expect(mine.length).toBe(1);
    expect(mine[0].userId).toBe(cashier.id);
    // cashier cannot widen the filter to someone else
    expect(eng.listSales(cashier, { from: todayStr(), to: todayStr(), cashierId: admin.id }).length).toBe(0);
    expect(eng.listSales(admin, { from: todayStr(), to: todayStr() }).length).toBe(2);
    expect(eng.listSales(pharm, { from: todayStr(), to: todayStr() }).length).toBe(2);
  });
  it('balance adjustments are audited ledger entries; opening balance itself is untouched', () => {
    const cust = eng.saveCustomer(admin, { name: 'Bibi', openingBalancePaisa: toPaisa(100) } as any);
    expect(() => eng.adjustPartyBalance(pharm, 'customer', cust.id, toPaisa(50), 'correction')).toThrow(/Permission denied/);
    eng.adjustPartyBalance(admin, 'customer', cust.id, toPaisa(-40), 'Old disputed amount written off by owner');
    expect(eng.customerBalance(cust.id)).toBe(toPaisa(60));
    expect(eng.db.customers.find(c => c.id === cust.id)!.openingBalancePaisa).toBe(toPaisa(100));
    expect(eng.db.audit.some(a => a.action === 'ledger.adjust')).toBe(true);
    const sup = eng.saveSupplier(admin, { name: 'D9', openingBalancePaisa: toPaisa(300) } as any);
    eng.adjustPartyBalance(admin, 'supplier', sup.id, toPaisa(50), 'Missed delivery charge agreed');
    expect(eng.supplierBalance(sup.id)).toBe(toPaisa(350));
  });
});

describe('password validation (PASSWORD-VALIDATION-01)', () => {
  it('empty fields get field-specific messages before any verification', () => {
    expect(() => eng.changeOwnPassword(admin, '', '')).toThrow('Enter your current password.');
    expect(() => eng.changeOwnPassword(admin, 'secret1', '')).toThrow('Enter a new password.');
    expect(() => eng.changeOwnPassword(admin, 'secret1', 'short')).toThrow(/at least 6/);
    expect(() => eng.changeOwnPassword(admin, 'secret1', 'secret1')).toThrow(/different/);
    expect(() => eng.changeOwnPassword(admin, 'wrong', 'newpass1')).toThrow('Current password is incorrect.');
  });
});

describe('backup metadata & data preservation (BACKUP-01)', () => {
  it('markBackupDone records the timestamp; restore preserves barcodes, settings and reversals', () => {
    const med = stockedMed();
    eng.addMedicineBarcode(admin, { medicineId: med.id, barcode: 'BOX-9', packagingLevel: 'box', unitsPerPackage: 10, sellPricePaisa: toPaisa(340), purchaseCostPaisa: 0 });
    const e = eng.createExpense(admin, { date: todayStr(), category: 'Other', description: 'x', amountPaisa: toPaisa(10), method: 'Cash', reference: '' });
    eng.reverseExpense(admin, e.id, 'test');
    eng.markBackupDone(admin);
    expect(eng.db.settings.lastBackupAt).toBeTruthy();
    const json = eng.exportBackup();
    const e2 = new Engine(emptyDb(), () => {});
    const a2 = e2.setupAdmin({ storeName: 'x', address: '', phone: '', fullName: 'x', username: 'boss', password: 'boss123', seedSample: false });
    e2.restoreBackup(a2, json);
    expect(e2.db.medicineBarcodes.some(b => b.barcode === 'BOX-9')).toBe(true);
    expect(e2.db.expenses[0].reversedAt).toBeTruthy();
    expect(e2.db.settings.scanner.enabled).toBe(true);
    expect(e2.integrityCheck()).toEqual([]);
  });
});

describe('engine-level permission enforcement (verification)', () => {
  it('only admin can reopen a cash day, reverse expenses, or adjust balances', () => {
    eng.closeDay(admin, todayStr(), 0, '', '');
    expect(() => eng.reopenDay(pharm, todayStr(), 'try')).toThrow(/Permission denied/);
    eng.reopenDay(admin, todayStr(), 'legit');
    const e = eng.createExpense(admin, { date: todayStr(), category: 'Other', description: 'x', amountPaisa: 100, method: 'Bank Transfer', reference: '' });
    expect(() => eng.reverseExpense(cashier, e.id, 'nope')).toThrow(/Permission denied/);
    expect(() => eng.reverseExpense(pharm, e.id, 'nope')).toThrow(/Permission denied/);
    const cust = eng.saveCustomer(admin, { name: 'Test' });
    expect(() => eng.adjustPartyBalance(cashier, 'customer', cust.id, 100, 'x')).toThrow(/Permission denied/);
  });
});

describe('POS price permissions (Priority 2)', () => {
  const sellAt = (actor: SessionUser, medId: number, pricePaisa: number, overrideId?: number, key = 'pp-' + Math.random()) =>
    eng.createSale(actor, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: key, items: [{ medicineId: medId, qty: 1, unitPricePaisa: pricePaisa, discountPaisa: 0, priceOverrideId: overrideId ?? null }], payments: [{ method: 'Cash', amountPaisa: pricePaisa }] });

  it('authorized price: batch sell price wins, retail is fallback, packaging price divides', () => {
    const med = stockedMed(26, 35, 50); // batch sell 35
    expect(eng.authorizedUnitPrice(med.id)).toBe(toPaisa(35));
    const box = eng.addMedicineBarcode(admin, { medicineId: med.id, barcode: 'BOX-PP', packagingLevel: 'box', unitsPerPackage: 10, sellPricePaisa: toPaisa(320), purchaseCostPaisa: 0 });
    expect(eng.authorizedUnitPrice(med.id, box.id)).toBe(toPaisa(32));
  });
  it('cashier (and pharmacist) cannot sell at a changed price without an override — engine rejects', () => {
    const med = stockedMed();
    expect(() => sellAt(cashier, med.id, toPaisa(30))).toThrow(/differs from the authorized price/);
    expect(() => sellAt(pharm, med.id, toPaisa(40))).toThrow(/differs from the authorized price/);
    expect(() => sellAt(admin, med.id, toPaisa(40))).toThrow(/differs from the authorized price/); // even admin needs a recorded override
    expect(eng.db.sales.length).toBe(0);
    // normal price works for everyone
    expect(sellAt(cashier, med.id, toPaisa(35)).totalPaisa).toBe(toPaisa(35));
  });
  it('administrator-supervised override: cashier requests, admin credentials approve, audit + invoice recorded', () => {
    const med = stockedMed();
    expect(() => eng.authorizePriceOverride(cashier, { medicineId: med.id, newUnitPricePaisa: toPaisa(30), reason: 'x' })).toThrow(/Administrator approval is required/);
    expect(() => eng.authorizePriceOverride(cashier, { medicineId: med.id, newUnitPricePaisa: toPaisa(30), reason: 'x', approverUsername: 'admin', approverPassword: 'wrong' })).toThrow(/incorrect/);
    expect(() => eng.authorizePriceOverride(cashier, { medicineId: med.id, newUnitPricePaisa: toPaisa(30), reason: 'x', approverUsername: 'pharm', approverPassword: 'pharm123' })).toThrow(/not authorized to approve/);
    expect(() => eng.authorizePriceOverride(cashier, { medicineId: med.id, newUnitPricePaisa: toPaisa(30), reason: '', approverUsername: 'admin', approverPassword: 'secret1' })).toThrow(/reason is required/);
    const ov = eng.authorizePriceOverride(cashier, { medicineId: med.id, newUnitPricePaisa: toPaisa(30), reason: 'Box damaged — owner agreed', approverUsername: 'admin', approverPassword: 'secret1' });
    const sale = sellAt(cashier, med.id, toPaisa(30), ov.id);
    expect(sale.totalPaisa).toBe(toPaisa(30));
    const saved = eng.db.priceOverrides.find(o => o.id === ov.id)!;
    expect(saved.originalPricePaisa).toBe(toPaisa(35));
    expect(saved.newPricePaisa).toBe(toPaisa(30));
    expect(saved.approvedBy).toBe(admin.id);
    expect(saved.requestedBy).toBe(cashier.id);
    expect(saved.saleId).toBe(sale.id);
    expect(saved.invoiceNo).toBe(sale.invoiceNo);
    const audit = eng.db.audit.find(a => a.action === 'pos.price.override')!;
    expect(audit.details).toMatch(/3500 -> 3000/);
    expect(audit.details).toMatch(/Box damaged/);
    // a consumed override cannot be reused
    expect(() => sellAt(cashier, med.id, toPaisa(30), ov.id)).toThrow(/differs from the authorized price/);
  });
  it('admin can self-approve; override for a different price/medicine does not validate', () => {
    const med = stockedMed();
    const ov = eng.authorizePriceOverride(admin, { medicineId: med.id, newUnitPricePaisa: toPaisa(33), reason: 'Regular customer' });
    expect(() => sellAt(admin, med.id, toPaisa(31), ov.id)).toThrow(/differs from the authorized price/);
    expect(sellAt(admin, med.id, toPaisa(33), ov.id).totalPaisa).toBe(toPaisa(33));
  });
});

describe('cashier dashboard scoping (Priority 3)', () => {
  it('engine aggregates for a cashier include ONLY their own sales', () => {
    const med = stockedMed();
    const sell = (actor: SessionUser, qty: number, key: string) => eng.createSale(actor, { customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: key, items: [{ medicineId: med.id, qty, unitPricePaisa: toPaisa(35), discountPaisa: 0 }], payments: [{ method: 'Cash', amountPaisa: toPaisa(35 * qty) }] });
    sell(cashier, 2, 'ds-1'); sell(admin, 3, 'ds-2');
    const mine = eng.rangeStats(todayStr(), todayStr(), cashier);
    expect(mine.invoiceCount).toBe(1);
    expect(mine.netRevenue).toBe(toPaisa(70));
    expect(mine.purchases).toBe(0); // business totals not exposed in scoped view
    const all = eng.rangeStats(todayStr(), todayStr(), admin);
    expect(all.invoiceCount).toBe(2);
    expect(all.netRevenue).toBe(toPaisa(175));
    // unscoped call (Reports page, already permission-gated) unchanged
    expect(eng.rangeStats(todayStr(), todayStr()).netRevenue).toBe(toPaisa(175));
    expect(eng.recentSales(cashier).every(s => s.userId === cashier.id)).toBe(true);
    expect(eng.recentSales(cashier).length).toBe(1);
    expect(eng.salesTrend(1, cashier)[0].salesPaisa).toBe(toPaisa(70));
    expect(eng.topSelling(todayStr(), todayStr(), 5, cashier)[0].qty).toBe(2);
    expect(eng.topSelling(todayStr(), todayStr(), 5, admin)[0].qty).toBe(5);
  });
});

describe('purchase access restrictions (Priority 4)', () => {
  it('cashier cannot list or create purchases, nor pay suppliers; authorized roles can', () => {
    const med = stockedMed();
    const sup = eng.saveSupplier(admin, { name: 'DistCo' });
    expect(() => eng.listPurchases(cashier)).toThrow(/Permission denied/);
    expect(() => eng.createPurchase(cashier, { supplierId: sup.id, supplierInvoiceNo: '', date: todayStr(), discountPaisa: 0, chargesPaisa: 0, paidPaisa: 0, paymentMethod: 'Cash', idempotencyKey: 'p4-1', items: [{ medicineId: med.id, batchNo: 'BX', mfgDate: '', expiryDate: addDays(todayStr(), 365), qty: 5, costPaisa: toPaisa(20), sellPricePaisa: toPaisa(35) }] })).toThrow(/Permission denied/);
    expect(() => eng.supplierPayment(cashier, { supplierId: sup.id, amountPaisa: toPaisa(10), method: 'Cash', reference: '', date: todayStr() })).toThrow(/Permission denied/);
    eng.createPurchase(pharm, { supplierId: sup.id, supplierInvoiceNo: 'INV-9', date: todayStr(), discountPaisa: 0, chargesPaisa: 0, paidPaisa: 0, paymentMethod: 'Cash', idempotencyKey: 'p4-2', items: [{ medicineId: med.id, batchNo: 'BX', mfgDate: '', expiryDate: addDays(todayStr(), 365), qty: 5, costPaisa: toPaisa(20), sellPricePaisa: toPaisa(35) }] });
    expect(eng.listPurchases(admin).length).toBe(1);
    expect(eng.listPurchases(pharm).length).toBe(1);
  });
});

describe('customer permissions & exports (Priorities 5-6)', () => {
  it('cashier keeps counter operations: add customer, receive validated payment', () => {
    const cust = eng.saveCustomer(cashier, { name: 'Counter Customer', openingBalancePaisa: toPaisa(200) });
    eng.customerPayment(cashier, { customerId: cust.id, amountPaisa: toPaisa(50), method: 'Cash', reference: '', saleId: null, date: todayStr() });
    expect(eng.customerBalance(cust.id)).toBe(toPaisa(150));
  });
  it('opening balance cannot be changed by direct engine call (customer or supplier)', () => {
    const cust = eng.saveCustomer(admin, { name: 'Fixed Opening', openingBalancePaisa: toPaisa(500) });
    expect(() => eng.saveCustomer(cashier, { id: cust.id, name: 'Fixed Opening', openingBalancePaisa: 0 })).toThrow(/Opening balance cannot be changed/);
    eng.saveCustomer(cashier, { id: cust.id, name: 'Fixed Opening', phone: '0300-1', openingBalancePaisa: toPaisa(500) }); // same value edits fine
    expect(eng.customerBalance(cust.id)).toBe(toPaisa(500));
    const sup = eng.saveSupplier(admin, { name: 'FixedSup', openingBalancePaisa: toPaisa(700) });
    expect(() => eng.saveSupplier(admin, { id: sup.id, name: 'FixedSup', openingBalancePaisa: 0 })).toThrow(/Opening balance cannot be changed/);
  });
  it('Walk-in payments require a reference at engine level', () => {
    const walkInId = eng.db.customers[0].id;
    expect(() => eng.customerPayment(admin, { customerId: walkInId, amountPaisa: toPaisa(100), method: 'Cash', reference: '', saleId: null, date: todayStr() })).toThrow(/shared counter record/);
    eng.customerPayment(admin, { customerId: walkInId, amountPaisa: toPaisa(100), method: 'Cash', reference: 'Counter token #5', saleId: null, date: todayStr() });
    expect(eng.customerBalance(walkInId)).toBe(toPaisa(-100));
  });
  it('customer/supplier/ledger exports are permission-gated in the engine', () => {
    const cust = eng.saveCustomer(admin, { name: 'ExportMe' });
    expect(() => eng.customerExportRows(cashier)).toThrow(/Permission denied/);
    expect(() => eng.supplierExportRows(cashier)).toThrow(/Permission denied/);
    expect(() => eng.partyLedgerExportRows(cashier, 'customer', cust.id)).toThrow(/Permission denied/);
    expect(eng.customerExportRows(admin).length).toBeGreaterThan(0);
    expect(eng.customerExportRows(pharm, 'exportme').length).toBe(1);
    expect(eng.customerExportRows(admin, 'no-such-person').length).toBe(0);
  });
});

describe('expense reversal history traceability (Priority 8)', () => {
  it('original record keeps who/when/why of the reversal and stays out of net totals', () => {
    const e = eng.createExpense(admin, { date: todayStr(), category: 'Electricity', description: 'Bill Oct', amountPaisa: toPaisa(2500), method: 'Bank Transfer', reference: 'TXN-1' });
    eng.reverseExpense(admin, e.id, 'Wrong meter number');
    const saved = eng.db.expenses.find(x => x.id === e.id)!;
    expect(saved.description).toBe('Bill Oct'); // original data intact
    expect(saved.reversedBy).toBe(admin.id);
    expect(saved.reversalReason).toBe('Wrong meter number');
    expect(Number.isNaN(Date.parse(saved.reversedAt!))).toBe(false); // valid timestamp
    // audit trail has BOTH events, consistent with the record
    expect(eng.db.audit.some(a => a.action === 'expense.create')).toBe(true);
    expect(eng.db.audit.some(a => a.action === 'expense.reverse' && a.details.includes('Wrong meter number'))).toBe(true);
    expect(eng.rangeStats(todayStr(), todayStr()).expenses).toBe(0);
  });
});

describe('bill discount validation (Priority 9)', () => {
  it('percentage discount math: 10% of subtotal after line discounts; totals never go negative', () => {
    const med = stockedMed(26, 35, 50);
    // POS sends the COMPUTED paisa amount: 10% of (350 - 50 line discount) = 30
    const sale = eng.createSale(cashier, { customerId: walkIn(), billDiscountPaisa: toPaisa(30), idempotencyKey: 'dp-1',
      items: [{ medicineId: med.id, qty: 10, unitPricePaisa: toPaisa(35), discountPaisa: toPaisa(50) }],
      payments: [{ method: 'Cash', amountPaisa: toPaisa(270) }] });
    expect(sale.subtotalPaisa).toBe(toPaisa(350));
    expect(sale.discountPaisa).toBe(toPaisa(80)); // 50 line + 30 bill
    expect(sale.totalPaisa).toBe(toPaisa(270));
    // discount beyond subtotal is rejected by the engine
    expect(() => eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: toPaisa(9999), idempotencyKey: 'dp-2',
      items: [{ medicineId: med.id, qty: 1, unitPricePaisa: toPaisa(35), discountPaisa: 0 }],
      payments: [] })).toThrow(/discount cannot exceed/i);
    // 100% discount -> total exactly 0, no negative amounts anywhere
    const free = eng.createSale(admin, { customerId: walkIn(), billDiscountPaisa: toPaisa(35), idempotencyKey: 'dp-3',
      items: [{ medicineId: med.id, qty: 1, unitPricePaisa: toPaisa(35), discountPaisa: 0 }], payments: [] });
    expect(free.totalPaisa).toBe(0);
    expect(eng.integrityCheck()).toEqual([]);
  });
});
