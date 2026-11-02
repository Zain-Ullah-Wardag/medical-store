-- ============================================================================
-- MedStore Manager — migration 002: multi-barcode packaging support
-- NON-DESTRUCTIVE. Existing records are preserved; each medicine's current
-- single barcode is backfilled as its PRIMARY packaging barcode (1 base unit).
-- Mirrors migrateDb() (v1 -> v2) in src/core/engine.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS medicine_barcodes (
  id                  INTEGER PRIMARY KEY,
  medicine_id         INTEGER NOT NULL REFERENCES medicines(id),
  barcode             TEXT    NOT NULL,
  packaging_level     TEXT    NOT NULL DEFAULT 'strip'
                        CHECK (packaging_level IN ('box','bottle','strip','unit')),
  units_per_package   INTEGER NOT NULL DEFAULT 1 CHECK (units_per_package >= 1),
  -- Price/cost of ONE package in paisa; 0 = inherit per-unit medicine/batch price.
  -- App-level rule: when > 0 it must divide exactly by units_per_package.
  sell_price_paisa    INTEGER NOT NULL DEFAULT 0 CHECK (sell_price_paisa >= 0),
  purchase_cost_paisa INTEGER NOT NULL DEFAULT 0 CHECK (purchase_cost_paisa >= 0),
  is_primary          INTEGER NOT NULL DEFAULT 0,
  active              INTEGER NOT NULL DEFAULT 1
);

-- A physical barcode must identify exactly one product packaging.
CREATE UNIQUE INDEX IF NOT EXISTS idx_medicine_barcodes_code
  ON medicine_barcodes(barcode) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_medicine_barcodes_medicine
  ON medicine_barcodes(medicine_id);

-- Backfill: existing medicines.barcode -> primary strip-level record (1 unit).
INSERT INTO medicine_barcodes (medicine_id, barcode, packaging_level, units_per_package, is_primary, active)
SELECT id, barcode, 'strip', 1, 1, 1
FROM medicines
WHERE barcode IS NOT NULL AND TRIM(barcode) <> ''
  AND NOT EXISTS (SELECT 1 FROM medicine_barcodes mb WHERE mb.barcode = medicines.barcode);

-- Record which packaging level a sale line was sold at (receipts/reports).
ALTER TABLE sale_items ADD COLUMN packaging TEXT;

-- Scanner preferences live with the rest of the settings (app_settings key
-- 'scanner', JSON). Example defaults:
--   {"enabled":true,"inputMode":"both","autoDetectWedge":true,"suffix":"both",
--    "defaultScanQty":1,"beepOnSuccess":true,"beepOnError":true,
--    "unknownBehavior":"prompt","rapidDuplicateWindowMs":350,"cameraEnabled":true}
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('scanner',
  '{"enabled":true,"inputMode":"both","autoDetectWedge":true,"suffix":"both","defaultScanQty":1,"beepOnSuccess":true,"beepOnError":true,"unknownBehavior":"prompt","rapidDuplicateWindowMs":350,"cameraEnabled":true}');
