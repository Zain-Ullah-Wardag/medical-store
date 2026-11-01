import { describe, it, expect, beforeEach } from 'vitest';
import { Engine, emptyDb, migrateDb } from './engine';
import { toPaisa, todayStr, addDays } from './money';
import type { SessionUser } from './types';
import { GS } from './scanner';

let eng: Engine; let admin: SessionUser;
const walkIn = () => eng.db.customers[0].id;
const STRIP = '8964001234500';       // EAN-13, valid check digit
const BOX = '8964001234593';         // box of 10 strips
const GTIN14 = '08964001234500';     // GTIN-14 form of STRIP

function fresh() {
  eng = new Engine(emptyDb(), () => {});
  admin = eng.setupAdmin({ storeName: 'Scan Test', address: '', phone: '', fullName: 'Owner', username: 'admin', password: 'secret1', seedSample: false });
}
function medWithBatches() {
  const med = eng.saveMedicine(admin, { name: 'Panadol Extra', barcode: STRIP, unit: 'strip', retailPricePaisa: toPaisa(35), defaultCostPaisa: toPaisa(28), minStock: 5 });
  eng.addMedicineBarcode(admin, { medicineId: med.id, barcode: BOX, packagingLevel: 'box', unitsPerPackage: 10, sellPricePaisa: toPaisa(340), purchaseCostPaisa: toPaisa(270) });
  eng.addOpeningBatch(admin, { medicineId: med.id, batchNo: 'PN-EARLY', expiryDate: addDays(todayStr(), 60), qty: 100, costPaisa: toPaisa(26), sellPricePaisa: toPaisa(35) });
  eng.addOpeningBatch(admin, { medicineId: med.id, batchNo: 'PN-LATE', expiryDate: addDays(todayStr(), 400), qty: 100, costPaisa: toPaisa(28), sellPricePaisa: toPaisa(35) });
  return med;
}
beforeEach(fresh);

describe('packaging barcodes & unit conversion', () => {
  it('registers multiple barcodes per medicine and keeps the primary in sync', () => {
    const med = medWithBatches();
    const codes = eng.barcodesFor(med.id);
    expect(codes.length).toBe(2);
    expect(codes.find(c => c.isPrimary)?.barcode).toBe(STRIP);
    expect(eng.findByBarcode(BOX)?.id).toBe(med.id);
  });
  it('scanning a BOX resolves to 10 base units at the exact per-unit package price', () => {
    medWithBatches();
    const r = eng.resolveScan(BOX);
    expect(r.status).toBe('found');
    expect(r.baseQtyPerScan).toBe(10);
    expect(r.unitPricePaisa).toBe(toPaisa(34)); // 340 per box / 10 strips
    expect(r.packagingLabel).toContain('box');
  });
  it('a box sale deducts exactly 10 base units, charged at box price', () => {
    const med = medWithBatches();
    const r = eng.resolveScan(BOX);
    const sale = eng.createSale(admin, {
      customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'box-1',
      items: [{ medicineId: med.id, qty: r.baseQtyPerScan, unitPricePaisa: r.unitPricePaisa, discountPaisa: 0, packaging: r.packagingLabel, barcodeRecordId: r.barcodeRecord!.id }],
      payments: [{ method: 'Cash', amountPaisa: toPaisa(340) }],
    });
    expect(sale.totalPaisa).toBe(toPaisa(340));
    expect(eng.saleableStock(med.id)).toBe(190);
    expect(eng.db.batches.find(b => b.batchNo === 'PN-EARLY')!.qtyRemaining).toBe(90); // FEFO first batch
    expect(eng.db.saleItems.find(i => i.saleId === sale.id)?.packaging).toContain('box');
  });
  it('repeated scans accumulate: 3 box scans = 30 base units in one sale', () => {
    const med = medWithBatches();
    let qty = 0;
    let boxRecId = 0;
    for (let i = 0; i < 3; i++) { const rr = eng.resolveScan(BOX); qty += rr.baseQtyPerScan; boxRecId = rr.barcodeRecord!.id; }
    eng.createSale(admin, {
      customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'box-3',
      items: [{ medicineId: med.id, qty, unitPricePaisa: toPaisa(34), discountPaisa: 0, barcodeRecordId: boxRecId }],
      payments: [{ method: 'Cash', amountPaisa: toPaisa(1020) }],
    });
    expect(eng.saleableStock(med.id)).toBe(170);
  });
  it('rejects duplicate barcodes across medicines and non-divisible package prices', () => {
    const med = medWithBatches();
    const other = eng.saveMedicine(admin, { name: 'OtherMed' });
    expect(() => eng.addMedicineBarcode(admin, { medicineId: other.id, barcode: BOX, packagingLevel: 'box', unitsPerPackage: 5, sellPricePaisa: 0, purchaseCostPaisa: 0 })).toThrow(/already assigned/);
    expect(() => eng.addMedicineBarcode(admin, { medicineId: med.id, barcode: 'NEW-1', packagingLevel: 'box', unitsPerPackage: 3, sellPricePaisa: toPaisa(100), purchaseCostPaisa: 0 })).toThrow(/divide exactly/);
    expect(() => eng.addMedicineBarcode(admin, { medicineId: med.id, barcode: 'NEW-2', packagingLevel: 'box', unitsPerPackage: 0, sellPricePaisa: 0, purchaseCostPaisa: 0 })).toThrow(/at least 1/);
  });
  it('deactivated barcodes no longer resolve', () => {
    const med = medWithBatches();
    const rec = eng.barcodesFor(med.id).find(c => c.barcode === BOX)!;
    eng.updateMedicineBarcode(admin, rec.id, { active: false });
    expect(eng.resolveScan(BOX).status).toBe('unknown');
  });
});

describe('unknown & invalid scans', () => {
  it('unknown barcode is reported, never auto-added (resolution is read-only)', () => {
    const med = medWithBatches();
    const before = JSON.stringify(eng.db.sales.length) + eng.saleableStock(med.id);
    const r = eng.resolveScan('9999999999999');
    expect(r.status).toBe('unknown');
    expect(r.medicine).toBeUndefined();
    expect(JSON.stringify(eng.db.sales.length) + eng.saleableStock(med.id)).toBe(before);
  });
  it('QR text and garbage are invalid, not unknown medicines', () => {
    medWithBatches();
    expect(eng.resolveScan('https://pharmacy-promo.example').status).toBe('invalid');
    expect(eng.resolveScan('').status).toBe('invalid');
  });
});

describe('GS1 batch & expiry identification', () => {
  it('identifies the matching batch from AI (10) and checkout deducts THAT batch first', () => {
    const med = medWithBatches();
    const r = eng.resolveScan(`(01)${GTIN14}(17)${addDays(todayStr(), 400).slice(2, 4)}${addDays(todayStr(), 400).slice(5, 7)}${addDays(todayStr(), 400).slice(8, 10)}(10)PN-LATE(21)SN9`);
    expect(r.status).toBe('found');
    expect(r.matchedBatch?.batchNo).toBe('PN-LATE');
    const sale = eng.createSale(admin, {
      customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'gs1-1',
      items: [{ medicineId: med.id, qty: 5, unitPricePaisa: toPaisa(35), discountPaisa: 0, preferredBatchId: r.matchedBatch!.id }],
      payments: [{ method: 'Cash', amountPaisa: toPaisa(175) }],
    });
    const item = eng.db.saleItems.find(i => i.saleId === sale.id)!;
    expect(item.allocations[0].batchNo).toBe('PN-LATE'); // NOT the FEFO-earlier batch
    expect(eng.db.batches.find(b => b.batchNo === 'PN-LATE')!.qtyRemaining).toBe(95);
    expect(eng.db.batches.find(b => b.batchNo === 'PN-EARLY')!.qtyRemaining).toBe(100);
  });
  it('BLOCKS when the GS1 batch is not in stock records (never silently FEFO)', () => {
    medWithBatches();
    const r = eng.resolveScan(`01${GTIN14}10UNKNOWN-LOT${GS}21SN1`);
    expect(r.status).toBe('blocked');
    expect(r.matchedBatch).toBeUndefined();
    expect(r.message).toMatch(/NOT in stock records/);
  });
  it('BLOCKS on GS1 expiry mismatch vs the recorded batch (SCANNER-GS1-01)', () => {
    medWithBatches(); // PN-EARLY expires today+60; code claims 2027-12-31
    const r = eng.resolveScan(`(01)${GTIN14}(17)271231(10)PN-EARLY`);
    expect(r.status).toBe('blocked');
    expect(r.message).toMatch(/EXPIRY MISMATCH/);
    expect(r.message).toMatch(/2027-12-31/);
  });
  it('blocks a scan whose own GS1 expiry date has passed', () => {
    medWithBatches();
    const past = addDays(todayStr(), -30);
    const yymmdd = past.slice(2, 4) + past.slice(5, 7) + past.slice(8, 10);
    const r = eng.resolveScan(`(01)${GTIN14}(17)${yymmdd}(10)PN-EARLY`);
    expect(r.status).toBe('blocked');
    expect(r.message).toMatch(/EXPIRED/);
  });
  it('blocks when the identified batch is quarantined', () => {
    const med = medWithBatches();
    const batch = eng.db.batches.find(b => b.batchNo === 'PN-LATE')!;
    eng.setBatchStatus(admin, batch.id, 'quarantine', 'Suspected storage damage');
    const r = eng.resolveScan(`(01)${GTIN14}(10)PN-LATE`);
    expect(r.status).toBe('blocked');
    expect(r.message).toMatch(/quarantine/);
    // and even if a stale cart line reaches checkout, the engine refuses:
    expect(() => eng.createSale(admin, {
      customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'gs1-q',
      items: [{ medicineId: med.id, qty: 1, unitPricePaisa: toPaisa(35), discountPaisa: 0, preferredBatchId: batch.id }],
      payments: [{ method: 'Cash', amountPaisa: toPaisa(35) }],
    })).toThrow(/not saleable/);
  });
  it('GTIN-14 scans match a barcode registered in EAN-13 form', () => {
    medWithBatches();
    const r = eng.resolveScan(`(01)${GTIN14}(10)PN-EARLY`);
    expect(r.status).toBe('found');
    expect(r.medicine?.name).toBe('Panadol Extra');
  });
  it('mixed cart lines (scanned batch + FEFO line) never double-allocate units', () => {
    const med = eng.saveMedicine(admin, { name: 'MixMed', barcode: 'MIX-1', retailPricePaisa: toPaisa(10) });
    const b1 = eng.addOpeningBatch(admin, { medicineId: med.id, batchNo: 'M1', expiryDate: addDays(todayStr(), 90), qty: 10, costPaisa: toPaisa(5), sellPricePaisa: toPaisa(10) });
    eng.addOpeningBatch(admin, { medicineId: med.id, batchNo: 'M2', expiryDate: addDays(todayStr(), 200), qty: 10, costPaisa: toPaisa(5), sellPricePaisa: toPaisa(10) });
    // Line A takes 8 from M1 (scanned). Line B wants 5 more FEFO → 2 from M1 + 3 from M2.
    const sale = eng.createSale(admin, {
      customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'mix-1',
      items: [
        { medicineId: med.id, qty: 8, unitPricePaisa: toPaisa(10), discountPaisa: 0, preferredBatchId: b1.id },
        { medicineId: med.id, qty: 5, unitPricePaisa: toPaisa(10), discountPaisa: 0, packaging: 'strip' },
      ],
      payments: [{ method: 'Cash', amountPaisa: toPaisa(130) }],
    });
    const allocQty = eng.db.saleItems.filter(i => i.saleId === sale.id).flatMap(i => i.allocations);
    expect(allocQty.filter(a => a.batchNo === 'M1').reduce((s, a) => s + a.qty, 0)).toBe(10);
    expect(allocQty.filter(a => a.batchNo === 'M2').reduce((s, a) => s + a.qty, 0)).toBe(3);
    expect(eng.integrityCheck()).toEqual([]);
  });
});

describe('cancellation & rollback safety', () => {
  it('scanning into a cart (resolveScan) never changes stock, cash or ledger', () => {
    const med = medWithBatches();
    const snap = JSON.stringify({ b: eng.db.batches, c: eng.db.cashMovements, l: eng.db.ledger, s: eng.db.sales });
    eng.resolveScan(BOX); eng.resolveScan(BOX); eng.resolveScan(STRIP);
    // cashier cancels the sale here in the UI: nothing was ever written
    expect(JSON.stringify({ b: eng.db.batches, c: eng.db.cashMovements, l: eng.db.ledger, s: eng.db.sales })).toBe(snap);
    void med;
  });
  it('a failed checkout (box qty exceeds stock) rolls back EVERYTHING', () => {
    const med = medWithBatches(); // 200 strips
    const before = JSON.stringify(eng.db);
    expect(() => eng.createSale(admin, {
      customerId: walkIn(), billDiscountPaisa: 0, idempotencyKey: 'fail-1',
      items: [{ medicineId: med.id, qty: 21 * 10, unitPricePaisa: toPaisa(34), discountPaisa: 0, barcodeRecordId: eng.resolveScan(BOX).barcodeRecord!.id }], // 21 boxes > stock
      payments: [{ method: 'Cash', amountPaisa: toPaisa(7140) }],
    })).toThrow(/Insufficient saleable stock/);
    expect(JSON.stringify(eng.db)).toBe(before);
  });
});

describe('v1 → v2 migration', () => {
  it('backfills primary barcodes and scanner settings without touching records', () => {
    const db: any = JSON.parse(JSON.stringify(emptyDb()));
    db.version = 1;
    delete db.medicineBarcodes;
    delete db.settings.scanner;
    db.medicines.push({ id: 7, name: 'OldMed', genericName: '', brandName: '', barcode: 'OLD-123', categoryId: null, manufacturer: '', strength: '', dosageForm: 'Tablet', packSize: '', unit: 'strip', defaultCostPaisa: 100, retailPricePaisa: 150, minStock: 5, prescription: 'OTC', storage: '', notes: '', active: true, createdAt: '', updatedAt: '' });
    const out = migrateDb(db);
    expect(out.version).toBe(2);
    expect(out.medicines.length).toBe(1); // nothing removed
    expect(out.medicineBarcodes).toEqual([expect.objectContaining({ medicineId: 7, barcode: 'OLD-123', isPrimary: true, unitsPerPackage: 1 })]);
    expect(out.settings.scanner.enabled).toBe(true);
    // idempotent
    migrateDb(out);
    expect(out.medicineBarcodes.length).toBe(1);
  });
});

describe('seeded sample catalog scanning', () => {
  it('sample Panadol has strip + box barcodes; GS1 sample identifies batch PN-2401', () => {
    const e2 = new Engine(emptyDb(), () => {});
    e2.setupAdmin({ storeName: 'S', address: '', phone: '', fullName: 'O', username: 'boss', password: 'boss123', seedSample: true });
    const panadol = e2.db.medicines.find(m => m.name === 'Panadol Extra')!;
    expect(e2.barcodesFor(panadol.id).length).toBe(2);
    const boxScan = e2.resolveScan('8964001234593');
    expect(boxScan.status).toBe('found');
    expect(boxScan.baseQtyPerScan).toBe(10);
    expect(boxScan.unitPricePaisa).toBe(toPaisa(35)); // Rs 350 box / 10 strips
    const pn = e2.db.batches.find(b => b.batchNo === 'PN-2401')!;
    const yymmdd = pn.expiryDate.slice(2, 4) + pn.expiryDate.slice(5, 7) + pn.expiryDate.slice(8, 10);
    const gs1 = e2.resolveScan(`(01)08964001234500(17)${yymmdd}(10)PN-2401(21)SN001`);
    expect(gs1.status).toBe('found');
    expect(gs1.matchedBatch?.batchNo).toBe('PN-2401');
    expect(gs1.parsed.gs1?.serial).toBe('SN001');
    // invalid check digit on a random QR-style payload is never a medicine
    expect(e2.resolveScan('https://example.com').status).toBe('invalid');
  });
  it('scanner settings have safe defaults and persist through updateSettings', () => {
    const e2 = new Engine(emptyDb(), () => {});
    const a = e2.setupAdmin({ storeName: 'S', address: '', phone: '', fullName: 'O', username: 'boss', password: 'boss123', seedSample: false });
    expect(e2.db.settings.scanner.enabled).toBe(true);
    expect(e2.db.settings.scanner.suffix).toBe('both');
    e2.updateSettings(a, { scanner: { ...e2.db.settings.scanner, suffix: 'tab', rapidDuplicateWindowMs: 0, unknownBehavior: 'warn-only' } });
    expect(e2.db.settings.scanner.suffix).toBe('tab');
    expect(e2.db.settings.scanner.rapidDuplicateWindowMs).toBe(0);
    expect(e2.db.audit.some(x => x.action === 'settings.update')).toBe(true);
  });
});
