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


## Clarified rules (QA stabilization phase)

- **Business day = local calendar day.** Transaction timestamps are stored in UTC, but every day-level filter,
  dashboard figure, report and cash closing uses the LOCAL date. A sale at 2:00 AM PKT belongs to that local day.
- **Returns and COGS.** Both sealed and damaged returns reduce net sales (by the RETURN's date). COGS is reversed
  only when the returned goods go back to SALEABLE stock ("Sealed & good"). Damaged/quarantined returns do not
  re-enter inventory value, so their batch cost remains a cost of the period (this avoids overstating profit).
  The profit summary, by-medicine and by-category views all share this one calculation and must always reconcile.
- **Closed cash days are sealed.** After daily closing, no cash movement (sale payment, refund, expense,
  cash-in/out, opening-cash change) can be added to that date. The expected/counted snapshot never changes.
  An administrator may reopen a day with a reason; the reopening and the previous snapshot are audit-logged.
- **Supplier payments.** Paying more than the outstanding payable requires explicitly confirming an advance;
  the excess becomes supplier credit (negative balance) and is consumed by future purchases. Zero/negative
  payments are always rejected.
- **Customer payments & advances.** Zero/negative payments are rejected. Paying more than the outstanding udhaar
  is allowed and recorded as a customer advance (a liability), never as sales income. Advances should belong to
  a named customer, not the shared "Walk-in Customer" record.
- **Expense reversal.** Expenses are never deleted. Reversal flags the record with a reason, restores cash if it
  was cash-paid, excludes it from reports, and writes an `expense.reverse` audit entry.
- **Opening balances are immutable.** Corrections use an audited ledger adjustment (reason required); history is
  preserved and the adjustment appears on the party statement.
- **Inventory valuation** consistently means saleable stock at batch cost (active, non-expired batches only) —
  in the valuation report, dashboard and slow-moving report alike.


## POS price integrity & discounts (QA phase 2)

- **Authorized selling price** (per base unit) is defined once: packaging-barcode price when that barcode sets
  one, else the first FEFO batch's sell price, else the medicine retail price. Scans, manual adds and checkout
  validation all use this rule.
- **Price overrides.** The POS price field is locked for every role. Selling at any other price requires an
  administrator-approved override with a reason (`pos.price.override`, administrators only). A cashier may
  request one; the administrator's own credentials approve it (verified by the engine, never stored). Each
  override records medicine, original/new price, requester, approver, reason and time, is written to Audit
  Logs (`pos.price.override`), can be used once, and is stamped with the invoice it was consumed by.
- **Discounts are separate from price.** Line discounts and the bill discount (fixed Rs or % of
  subtotal-after-line-discounts, capped at 100%) remain available to POS roles because they are recorded on
  the invoice and visible on receipts/reports — unlike a silent price edit. The engine rejects any discount
  that would exceed the subtotal, so totals can never go negative.
- **Cashier data policy.** Cashiers see only their own sales everywhere (Sales History, Dashboard figures,
  trends, top-selling, recent sales — enforced in the engine). Purchases, supplier finances, customer/supplier
  exports and balance adjustments are not cashier functions. Cashiers keep counter essentials: selling,
  registering customers, viewing customer statements and receiving validated payments.
