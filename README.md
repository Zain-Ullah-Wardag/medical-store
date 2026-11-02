# ⚕ MedStore Manager

**Offline Medical Store Management System for Windows** — built for one medical
store in Pakistan: barcode POS billing, medicine **batch & expiry control with
FEFO**, purchases, customer/supplier **ledgers (udhaar)**, returns, expenses,
daily **cash closing**, accurate **profit reports**, user roles with audit logs,
and **SQLite backup/restore**. Works 100% offline. Currency: PKR.

> **Status (honest):** The complete application (all modules below) is
> implemented and covered by 23 automated tests that pass. The Windows
> installer must be compiled on a Windows PC (Rust cannot cross-compile the
> WebView2 shell from Linux) — exact commands are in
> [Building the Windows installer](#-building-the-windows-installer). Test it in
> your browser first with `npm run dev` — every workflow works there too.

---

## 1. What you need (Windows PC)

| Tool | Why | Install |
|---|---|---|
| Node.js 20+ LTS | Runs the frontend tooling | https://nodejs.org |
| Rust (rustup) | Builds the desktop shell | https://rustup.rs |
| Microsoft C++ Build Tools | Required by Rust on Windows | Visual Studio Installer → "Desktop development with C++" |
| WebView2 | Already installed on most Win10/11 | https://developer.microsoft.com/microsoft-edge/webview2 |

Verify:
```powershell
node --version
npm --version
rustc --version
cargo --version
```

## 2. Run it (development mode)

```powershell
git clone https://github.com/Zain-Ullah-Wardag/medical-store.git
cd medical-store
npm install
npm run tauri:dev      # desktop app (needs Rust)
# — or, browser only (no Rust needed):
npm run dev            # open http://localhost:5173
```

**First run:** a setup wizard asks for your store name and creates the
owner/admin account. There is **no default password** — you choose it.
Optionally load the clearly-labelled sample catalog (you can wipe it later in
Settings → Danger zone).

## 3. Run the tests

```powershell
npm test
```
23 tests cover: admin setup & login, duplicate-barcode rejection, purchases,
two-batch **FEFO allocation**, expired-stock blocking, oversell rejection with
full rollback, discount/tax math in paisa, duplicate-invoice protection,
partial customer/supplier payments, credit-sale rules, sales & purchase
returns (incl. quarantine handling), **gross profit via batch COGS**, cash
reconciliation, daily-closing discrepancy rules, inventory valuation,
backup/restore validation, and stock-movement reconciliation.

## 4. 🏭 Building the Windows installer

```powershell
npm run tauri icon src-tauri/icons/icon.png   # generates .ico/.icns set (once)
npm run tauri:build
```
Output (under `src-tauri\target\release\bundle\`):
- `nsis\MedStore Manager_1.0.0_x64-setup.exe` — recommended installer
- `msi\MedStore Manager_1.0.0_x64_en-US.msi`

Install it, launch from the Start Menu, complete the setup wizard. Done —
no internet needed afterwards, ever.

## 5. Where is my data?

- **Windows app:** `%APPDATA%\com.medstore.manager\medstore.db` (SQLite, WAL
  mode). It is **not** inside Program Files, so reinstalling/updating the app
  never deletes your business data.
- **Browser/dev mode:** the same state is kept in the browser's local storage
  so you can evaluate everything before building the installer. Use
  Backup & Restore to move data between them.

**Backup routine (do this!):** At daily closing, open **Backup & Restore →
Download backup now**, and copy the file to a USB drive kept off the PC.
To restore: select the file → it is validated → your current data is first
downloaded as a safety copy → restore runs → integrity is verified.

## 6. Barcode / QR scanner setup

**Full guide: [`docs/SCANNER_SETUP.md`](docs/SCANNER_SETUP.md).** Short version:

- Any USB 1D or 2D scanner in **HID keyboard (wedge) mode** works — no drivers.
  2D models additionally read **QR + GS1 DataMatrix** (GTIN, batch, expiry and
  serial are parsed and matched to stock batches; expired/held scanned batches
  are blocked, never silently swapped). Enter or Tab suffix — both accepted.
- At **Point of Sale** you can scan anywhere on the screen (fast scanner bursts
  are auto-detected), with beep + on-screen confirmation and a configurable
  duplicate-scan guard. **F2** focuses the barcode box, **F4** search,
  **F9** complete sale. Configure everything under
  **Settings → 🔫 Barcode & Scanner**, including a live *Test scanner* tool.
- One medicine can carry **multiple barcodes for packaging levels**
  (box/bottle/strip/unit) — Medicines → View → *Barcodes & packaging*.
  Scanning a box of 10 strips adds 10 strips at the box price; stock is always
  counted in base units. Unknown barcodes are never added to a sale —
  authorized users can register them on the spot.

## 7. Receipt printing

- After each sale (or from Sales History → Reprint), the receipt preview
  prints to any Windows printer — **80mm thermal layout** is built in; regular
  A4 printers also work. Set your thermal printer as the Windows default, or
  pick it in the print dialog. "Save as PDF" in the same dialog gives you a PDF
  invoice. Install your printer's own Windows driver first (e.g. Xprinter /
  Epson TM series drivers from the manufacturer).

## 8. How the money math works

Short version (full document: [`docs/FINANCIAL_RULES.md`](docs/FINANCIAL_RULES.md)):
- All money is stored as **integer paisa** — no floating-point errors.
- **Gross profit = net sales − COGS**, where COGS is the *actual batch cost* of
  the units sold (FEFO). Purchases are **never** subtracted from sales.
- **Net operating profit (est.) = gross profit − recorded expenses.**
- Customer/supplier balances are always computed from ledger entries; cash
  reconciliation counts **physical cash only**.

## 9. Project structure

```
src/
  core/            ← business engine: types, money (paisa), engine, tests
  lib/store.ts     ← persistence + session
  components/      ← UI kit + printable Receipt
  pages/           ← Dashboard, POS, Catalog, Purchasing, SalesOps,
                     Parties (ledgers), Finance (cash), Reports, Admin
database/migrations/001_initial.sql   ← normalized SQLite schema
src-tauri/         ← Rust shell: SQLite file, migrations, online backup/restore
docs/FINANCIAL_RULES.md
```

**Architecture note:** one TypeScript "engine" owns every business rule
(permissions, FEFO, paisa accounting, atomic transactions with rollback,
idempotency keys against double-submits). The frontend only talks to the
engine; the Rust layer persists the engine's state into SQLite
(`app_state` table inside a real SQLite transaction) and maintains the
normalized schema from `database/migrations/` as the canonical relational
design. One rules engine = identical, test-covered behaviour in the browser,
in tests, and in the installed Windows app.

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `cargo`/`rustc` not found | Run rustup-init from https://rustup.rs, restart the terminal |
| `link.exe not found` while building | Install "Desktop development with C++" via Visual Studio Installer |
| App opens but data looks empty | Data is per-Windows-user in `%APPDATA%`; log in with the same Windows account, or restore a backup |
| Scanner types into the wrong box | Press **F2** on the POS screen to focus the barcode input |
| Forgot admin password | There is no backdoor. Restore an older backup, or reset by renaming `medstore.db` (fresh setup — data in the renamed file is recoverable by an expert) |
| Receipt prints blank/too wide | In printer properties set paper to 80mm (or your roll width), margins = none |

## 11. Known limitations (v1.0)

- Single computer / single store (as specified). No multi-branch sync; data
  never leaves the PC.
- Windows installer is unsigned → SmartScreen may show "More info → Run
  anyway" on first install (normal for unsigned apps; a code-signing
  certificate removes this).
- Barcode *label* printing is not included (scanning is fully supported).
- Automatic scheduled backups: the app reminds you at cash closing; keep USB
  copies manually (retention count is configurable in Settings).
- This software manages business records only. It does **not** diagnose,
  prescribe, or replace a licensed pharmacist's judgement.

## 12. Legal/compliance notes for the store owner (Pakistan)

Verify with your district health authority / DRAP: pharmacy & drug-sale
licensing, handling of prescription-only and controlled medicines (the app
flags Rx/Controlled items but proper register-keeping is your legal duty),
sales-tax obligations (tax % is configurable in Settings), and record-retention
periods. MedStore Manager does not claim automatic legal compliance.

## License
For the store owner's use; adapt freely for your own business.
