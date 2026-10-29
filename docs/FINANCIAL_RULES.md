# Financial Calculation Rules — MedStore Manager

These rules are implemented in `src/core/engine.ts` and covered by automated
tests in `src/core/engine.test.ts`.

## Money representation
- All amounts are stored and computed as **integer paisa** (1 PKR = 100 paisa).
  Floating point is never used for stored money. User-typed rupees are converted
  with round-half-up (`Math.round(rupees * 100)`).
- Percentage tax/discount amounts are rounded half-up to the nearest paisa.

## Inventory costing
- **Batch-specific costing.** Every batch carries its own purchase cost.
  When a medicine is sold, FEFO picks batches in earliest-expiry order and each
  sale line records the exact batch costs of the units sold (`allocations`).

## Definitions (exactly as computed)
- **Net sales revenue** = Σ sale totals (each total already net of line + bill
  discounts, plus tax) − Σ sales-return refunds in the period.
- **Cost of goods sold (COGS)** = Σ (batch cost × units) for all units sold in
  the period − Σ batch costs reversed by sales returns in the period.
  *Purchases are NEVER subtracted from sales to get profit.*
- **Gross profit** = Net sales revenue − COGS.
- **Net operating profit (estimate)** = Gross profit − recorded operating
  expenses. Excludes income tax, owner drawings and financing costs unless they
  are recorded as expenses. Labeled "estimate" in the UI for this reason.
- **Customer balance** = opening balance + Σ(debits − credits) of that
  customer's ledger entries. Debits: unpaid part of credit sales. Credits:
  payments received, credit-method sales returns.
- **Supplier balance** = opening balance + Σ(credits − debits). Credits:
  purchases. debits: payments, purchase returns (at batch cost).
- **Balances are always derived from ledger entries** — never typed in or edited
  directly. Opening balances cannot be edited after a party is created.
- **Inventory quantity (per batch)** = Σ of all inventory movements for that
  batch. The integrity checker (Backup & Restore page) verifies
  `batch.qty_remaining == Σ movements` for every batch.
- **Inventory valuation** = Σ(qty_remaining × batch cost) over batches that are
  `active` AND not expired. Expired/quarantined/damaged stock is excluded.
- **Expected cash** = opening cash + Σ cash movements. Cash movements are only
  created for **physical cash**: cash sale receipts, cash customer payments,
  cash refunds (−), cash supplier payments (−), cash expenses (−), and manual
  authorized cash in/out. Card/bank/JazzCash/EasyPaisa never enter cash
  reconciliation. A credit sale creates **no** cash movement and the customer's
  later payment is counted **once**, when received.

## Returns
- Sales-return refund per line = `line_total × return_qty / sold_qty`
  (proportional, so line discounts are handled correctly), rounded to paisa.
- COGS reversal restores the **original batch costs** of the returned units,
  following the original FEFO allocations in order.
- Returned units re-enter saleable stock only if disposition = "saleable" AND
  the original batch is still active and unexpired; otherwise they are moved to
  a quarantine/damaged batch record and can never be auto-sold.

## Worked example (from the test suite)
Buy 100 × Rs 60 = Rs 6,000 of stock. Sell 10 × Rs 100. Rent Rs 100.
→ Net revenue 1,000 · COGS 600 · Gross profit 400 · Net operating profit 300.
Purchases (6,000) appear in their own column and are **not** part of profit.
