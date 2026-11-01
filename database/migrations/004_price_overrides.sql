-- 004_price_overrides.sql
-- QA phase 2 (backward-compatible, non-destructive): records of
-- administrator-approved POS price overrides. New table only; no existing
-- table or record is touched. Mirrors the engine's PriceOverride records.

CREATE TABLE IF NOT EXISTS price_overrides (
  id                    INTEGER PRIMARY KEY,
  medicine_id           INTEGER NOT NULL REFERENCES medicines(id),
  barcode_record_id     INTEGER REFERENCES medicine_barcodes(id),
  original_price_paisa  INTEGER NOT NULL,
  new_price_paisa       INTEGER NOT NULL,
  requested_by          INTEGER NOT NULL REFERENCES users(id),
  approved_by           INTEGER NOT NULL REFERENCES users(id),
  reason                TEXT NOT NULL,
  date_time             TEXT NOT NULL,
  sale_id               INTEGER REFERENCES sales(id),
  invoice_no            TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_price_overrides_sale ON price_overrides(sale_id);
