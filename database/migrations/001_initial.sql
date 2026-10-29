-- ============================================================================
-- MedStore Manager — SQLite schema (migration 001, initial)
-- All money columns are INTEGER PAISA (1 PKR = 100 paisa). Dates are ISO text.
-- Applied automatically by src-tauri on first launch (tracked in schema_migrations).
-- ============================================================================
PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','pharmacist','cashier')),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
-- Roles/permissions are code-defined (PERMISSIONS map) and enforced in the engine;
-- user_roles table kept for future multi-role support.
CREATE TABLE user_roles (user_id INTEGER NOT NULL REFERENCES users(id), role TEXT NOT NULL, PRIMARY KEY (user_id, role));

CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);

CREATE TABLE medicines (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, generic_name TEXT DEFAULT '', brand_name TEXT DEFAULT '',
  barcode TEXT UNIQUE, category_id INTEGER REFERENCES categories(id), manufacturer TEXT DEFAULT '',
  strength TEXT DEFAULT '', dosage_form TEXT DEFAULT 'Tablet', pack_size TEXT DEFAULT '', unit TEXT DEFAULT 'strip',
  default_cost_paisa INTEGER NOT NULL DEFAULT 0, retail_price_paisa INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 10, prescription TEXT NOT NULL DEFAULT 'OTC' CHECK (prescription IN ('OTC','Rx','Controlled')),
  storage TEXT DEFAULT '', notes TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_medicines_name ON medicines(name);
CREATE INDEX idx_medicines_generic ON medicines(generic_name);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact_person TEXT DEFAULT '', phone TEXT DEFAULT '',
  address TEXT DEFAULT '', email TEXT DEFAULT '', opening_balance_paisa INTEGER NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE customers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '', address TEXT DEFAULT '',
  opening_balance_paisa INTEGER NOT NULL DEFAULT 0, notes TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE batches (
  id INTEGER PRIMARY KEY, medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  batch_no TEXT NOT NULL, supplier_id INTEGER REFERENCES suppliers(id), purchase_id INTEGER,
  mfg_date TEXT DEFAULT '', expiry_date TEXT NOT NULL, received_date TEXT NOT NULL,
  qty_received INTEGER NOT NULL CHECK (qty_received >= 0),
  qty_remaining INTEGER NOT NULL CHECK (qty_remaining >= 0),
  cost_paisa INTEGER NOT NULL DEFAULT 0, sell_price_paisa INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','quarantine','damaged','recalled','written_off'))
);
CREATE INDEX idx_batches_fefo ON batches(medicine_id, status, expiry_date);
CREATE INDEX idx_batches_no ON batches(batch_no);

CREATE TABLE purchases (
  id INTEGER PRIMARY KEY, supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  supplier_invoice_no TEXT DEFAULT '', date TEXT NOT NULL,
  subtotal_paisa INTEGER NOT NULL, discount_paisa INTEGER NOT NULL DEFAULT 0, charges_paisa INTEGER NOT NULL DEFAULT 0,
  total_paisa INTEGER NOT NULL, paid_paisa INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER NOT NULL REFERENCES users(id), idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE purchase_items (
  id INTEGER PRIMARY KEY, purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  medicine_id INTEGER NOT NULL REFERENCES medicines(id), batch_id INTEGER NOT NULL REFERENCES batches(id),
  qty INTEGER NOT NULL CHECK (qty > 0), cost_paisa INTEGER NOT NULL
);
CREATE TABLE supplier_payments (
  id INTEGER PRIMARY KEY, supplier_id INTEGER NOT NULL REFERENCES suppliers(id), date TEXT NOT NULL,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0), method TEXT NOT NULL, reference TEXT DEFAULT '',
  user_id INTEGER NOT NULL REFERENCES users(id), purchase_id INTEGER REFERENCES purchases(id)
);
CREATE TABLE purchase_returns (
  id INTEGER PRIMARY KEY, return_no TEXT NOT NULL UNIQUE, supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  purchase_id INTEGER REFERENCES purchases(id), datetime TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
  total_paisa INTEGER NOT NULL, reason TEXT NOT NULL
);
CREATE TABLE purchase_return_items (
  id INTEGER PRIMARY KEY, return_id INTEGER NOT NULL REFERENCES purchase_returns(id),
  medicine_id INTEGER NOT NULL REFERENCES medicines(id), batch_id INTEGER NOT NULL REFERENCES batches(id),
  qty INTEGER NOT NULL CHECK (qty > 0), cost_paisa INTEGER NOT NULL
);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY, invoice_no TEXT NOT NULL UNIQUE, datetime TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id), user_id INTEGER NOT NULL REFERENCES users(id),
  subtotal_paisa INTEGER NOT NULL, discount_paisa INTEGER NOT NULL DEFAULT 0, tax_paisa INTEGER NOT NULL DEFAULT 0,
  total_paisa INTEGER NOT NULL, paid_paisa INTEGER NOT NULL DEFAULT 0, idempotency_key TEXT UNIQUE
);
CREATE INDEX idx_sales_datetime ON sales(datetime);
CREATE TABLE sale_items (
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id),
  medicine_id INTEGER NOT NULL REFERENCES medicines(id), medicine_name TEXT NOT NULL, -- snapshot at sale time
  qty INTEGER NOT NULL CHECK (qty > 0), unit_price_paisa INTEGER NOT NULL,
  discount_paisa INTEGER NOT NULL DEFAULT 0, line_total_paisa INTEGER NOT NULL
);
CREATE TABLE sale_item_allocations ( -- FEFO batch breakdown; the source of batch-level COGS
  id INTEGER PRIMARY KEY, sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id), batch_no TEXT NOT NULL, expiry_date TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0), cost_paisa INTEGER NOT NULL
);
CREATE TABLE sale_payments (
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), method TEXT NOT NULL,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0), datetime TEXT NOT NULL
);
CREATE TABLE sales_returns (
  id INTEGER PRIMARY KEY, return_no TEXT NOT NULL UNIQUE, sale_id INTEGER NOT NULL REFERENCES sales(id),
  datetime TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), refund_paisa INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','credit','card','bank')), reason TEXT NOT NULL
);
CREATE TABLE sales_return_items (
  id INTEGER PRIMARY KEY, return_id INTEGER NOT NULL REFERENCES sales_returns(id),
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id), medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  qty INTEGER NOT NULL CHECK (qty > 0), amount_paisa INTEGER NOT NULL, cost_reversed_paisa INTEGER NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('saleable','quarantine','damaged'))
);
CREATE TABLE customer_payments (
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), date TEXT NOT NULL,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0), method TEXT NOT NULL, reference TEXT DEFAULT '',
  user_id INTEGER NOT NULL REFERENCES users(id), sale_id INTEGER REFERENCES sales(id)
);

-- Single source of truth for party balances: balance = opening + SUM(ledger).
CREATE TABLE ledger_entries (
  id INTEGER PRIMARY KEY, party_type TEXT NOT NULL CHECK (party_type IN ('customer','supplier')),
  party_id INTEGER NOT NULL, datetime TEXT NOT NULL, type TEXT NOT NULL, reference TEXT DEFAULT '',
  debit_paisa INTEGER NOT NULL DEFAULT 0, credit_paisa INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ledger_party ON ledger_entries(party_type, party_id);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0), method TEXT NOT NULL, reference TEXT DEFAULT '',
  user_id INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE cash_sessions (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL UNIQUE, opening_paisa INTEGER NOT NULL DEFAULT 0,
  counted_paisa INTEGER, expected_paisa INTEGER, closed_at TEXT, closed_by INTEGER REFERENCES users(id),
  notes TEXT DEFAULT '', discrepancy_reason TEXT DEFAULT ''
);
CREATE TABLE cash_movements ( -- physical cash only; card/bank never appear here
  id INTEGER PRIMARY KEY, datetime TEXT NOT NULL, type TEXT NOT NULL, amount_paisa INTEGER NOT NULL, reference TEXT DEFAULT ''
);
CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY, datetime TEXT NOT NULL, medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id), type TEXT NOT NULL, qty INTEGER NOT NULL,
  reference TEXT DEFAULT '', reason TEXT DEFAULT '', user_id INTEGER NOT NULL REFERENCES users(id), cost_paisa INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_movements_batch ON inventory_movements(batch_id);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY, datetime TEXT NOT NULL, user_id INTEGER NOT NULL, username TEXT NOT NULL,
  action TEXT NOT NULL, details TEXT DEFAULT ''
);
CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); -- JSON-encoded values
CREATE TABLE entity_sequences (entity TEXT PRIMARY KEY, next_id INTEGER NOT NULL DEFAULT 1);
