export type Role = 'admin' | 'pharmacist' | 'cashier';
export interface SessionUser { id: number; username: string; fullName: string; role: Role; }

export interface User extends SessionUser { passwordHash: string; active: boolean; createdAt: string; }
export interface Category { id: number; name: string; }

export interface Medicine {
  id: number; name: string; genericName: string; brandName: string; barcode: string;
  categoryId: number | null; manufacturer: string; strength: string; dosageForm: string;
  packSize: string; unit: string; defaultCostPaisa: number; retailPricePaisa: number;
  minStock: number; prescription: 'OTC' | 'Rx' | 'Controlled'; storage: string; notes: string;
  active: boolean; createdAt: string; updatedAt: string;
}

export type BatchStatus = 'active' | 'quarantine' | 'damaged' | 'recalled' | 'written_off';
export interface Batch {
  id: number; medicineId: number; batchNo: string; supplierId: number | null; purchaseId: number | null;
  mfgDate: string; expiryDate: string; receivedDate: string; qtyReceived: number; qtyRemaining: number;
  costPaisa: number; sellPricePaisa: number; status: BatchStatus;
}

export interface Supplier { id: number; name: string; contactPerson: string; phone: string; address: string; email: string; openingBalancePaisa: number; notes: string; active: boolean; }
export interface Customer { id: number; name: string; phone: string; address: string; openingBalancePaisa: number; notes: string; active: boolean; }

export interface Purchase { id: number; supplierId: number; supplierInvoiceNo: string; date: string; subtotalPaisa: number; discountPaisa: number; chargesPaisa: number; totalPaisa: number; paidPaisa: number; userId: number; idempotencyKey: string; createdAt: string; }
export interface PurchaseItem { id: number; purchaseId: number; medicineId: number; batchId: number; qty: number; costPaisa: number; }
export interface SupplierPayment { id: number; supplierId: number; date: string; amountPaisa: number; method: string; reference: string; userId: number; purchaseId: number | null; }

export interface Allocation { batchId: number; batchNo: string; expiryDate: string; qty: number; costPaisa: number; }
export interface Sale { id: number; invoiceNo: string; dateTime: string; customerId: number; userId: number; subtotalPaisa: number; discountPaisa: number; taxPaisa: number; totalPaisa: number; paidPaisa: number; idempotencyKey: string; }
export interface SaleItem { id: number; saleId: number; medicineId: number; medicineName: string; qty: number; unitPricePaisa: number; discountPaisa: number; lineTotalPaisa: number; allocations: Allocation[]; }
export interface SalePayment { id: number; saleId: number; method: string; amountPaisa: number; dateTime: string; }

export interface SalesReturn { id: number; returnNo: string; saleId: number; dateTime: string; userId: number; refundPaisa: number; method: 'cash' | 'credit' | 'card' | 'bank'; reason: string; }
export interface SalesReturnItem { id: number; returnId: number; saleItemId: number; medicineId: number; qty: number; amountPaisa: number; costReversedPaisa: number; disposition: 'saleable' | 'quarantine' | 'damaged'; }
export interface PurchaseReturn { id: number; returnNo: string; supplierId: number; purchaseId: number | null; dateTime: string; userId: number; totalPaisa: number; reason: string; }
export interface PurchaseReturnItem { id: number; returnId: number; medicineId: number; batchId: number; qty: number; costPaisa: number; }

export interface CustomerPayment { id: number; customerId: number; date: string; amountPaisa: number; method: string; reference: string; userId: number; saleId: number | null; }
export interface LedgerEntry { id: number; partyType: 'customer' | 'supplier'; partyId: number; dateTime: string; type: string; reference: string; debitPaisa: number; creditPaisa: number; }

export interface Expense { id: number; date: string; category: string; description: string; amountPaisa: number; method: string; reference: string; userId: number; }
export interface CashSession { id: number; date: string; openingPaisa: number; countedPaisa: number | null; expectedPaisa: number | null; closedAt: string | null; closedBy: number | null; notes: string; discrepancyReason: string; }
export interface CashMovement { id: number; dateTime: string; type: string; amountPaisa: number; reference: string; }
export interface InventoryMovement { id: number; dateTime: string; medicineId: number; batchId: number; type: string; qty: number; reference: string; reason: string; userId: number; costPaisa: number; }
export interface AuditLog { id: number; dateTime: string; userId: number; username: string; action: string; details: string; }

export interface Settings {
  storeName: string; address: string; phone: string; email: string; currency: string;
  taxRatePct: number; expiryWarnDays: number; invoicePrefix: string; nextInvoiceSeq: number;
  nextSaleReturnSeq: number; nextPurchaseReturnSeq: number; receiptFooter: string;
  paymentMethods: string[]; expenseCategories: string[]; printerName: string;
  backupRetention: number; allowCashierReturns: boolean; allowCashierCredit: boolean; setupDone: boolean;
}

export interface DbState {
  version: number; seq: Record<string, number>;
  users: User[]; categories: Category[]; medicines: Medicine[]; batches: Batch[];
  suppliers: Supplier[]; customers: Customer[]; purchases: Purchase[]; purchaseItems: PurchaseItem[];
  supplierPayments: SupplierPayment[]; sales: Sale[]; saleItems: SaleItem[]; salePayments: SalePayment[];
  salesReturns: SalesReturn[]; salesReturnItems: SalesReturnItem[]; purchaseReturns: PurchaseReturn[];
  purchaseReturnItems: PurchaseReturnItem[]; customerPayments: CustomerPayment[]; ledger: LedgerEntry[];
  expenses: Expense[]; cashSessions: CashSession[]; cashMovements: CashMovement[];
  movements: InventoryMovement[]; audit: AuditLog[]; settings: Settings;
}

export const PERMISSIONS: Record<Role, string[]> = {
  admin: ['*'],
  pharmacist: [
    'dashboard', 'pos', 'medicines.view', 'medicines.edit', 'inventory.view', 'inventory.adjust',
    'categories.edit', 'suppliers.view', 'suppliers.edit', 'purchases.view', 'purchases.create',
    'sales.view', 'sales.return', 'purchase.return', 'customers.view', 'customers.edit',
    'ledgers.view', 'payments.create', 'expenses.view', 'expenses.create', 'cash.view', 'reports.view',
  ],
  cashier: [
    'dashboard.basic', 'pos', 'medicines.view', 'inventory.view', 'sales.view.own',
    'customers.view', 'customers.edit', 'payments.create',
  ],
};

export const can = (role: Role, perm: string): boolean =>
  PERMISSIONS[role].includes('*') || PERMISSIONS[role].includes(perm) ||
  PERMISSIONS[role].some(p => p.endsWith('.*') && perm.startsWith(p.slice(0, -1)));
