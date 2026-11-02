-- 003_quality_fixes.sql
-- Bug-fix / QA stabilization phase (backward-compatible, non-destructive):
--  * expenses gain reversal metadata (original record is never deleted)
--  * nothing else in this phase changes the normalized schema:
--    date handling, cash-day locking, report calculations, payment
--    validation, GS1 strictness and sales visibility are application rules;
--    settings.lastBackupAt lives in the settings/app_state document.
--
-- NOTE (Tauri): SQLite does NOT support "ADD COLUMN IF NOT EXISTS".
-- The Rust shell tracks applied migrations in `schema_migrations` and only
-- runs each file once, which makes these statements safe on first run.

ALTER TABLE expenses ADD COLUMN reversed_at  TEXT;
ALTER TABLE expenses ADD COLUMN reversed_by  INTEGER REFERENCES users(id);
ALTER TABLE expenses ADD COLUMN reversal_reason TEXT NOT NULL DEFAULT '';

-- Optional convenience index for net-expense reporting.
CREATE INDEX IF NOT EXISTS idx_expenses_reversed ON expenses(reversed_at);
