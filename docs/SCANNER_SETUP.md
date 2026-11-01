# Barcode / QR Scanner Setup — MedStore Manager (Windows)

## 1. Which scanners work?

| Scanner type | Works? | Notes |
|---|---|---|
| USB 1D laser/CCD (EAN, UPC, Code 128) | ✅ | Any brand that works as a **USB HID keyboard** ("keyboard wedge") |
| USB 2D imager (QR + GS1 DataMatrix) | ✅ Recommended for pharma packs | Reads the small square DataMatrix codes printed on many medicine packs |
| Bluetooth / 2.4 GHz dongle scanners | ✅ | If the dongle presents as a USB keyboard (most do) |
| Serial (RS-232 / COM port) scanners | ⚠️ | Switch the scanner to USB-HID/keyboard mode, or use its USB cable |
| PC camera / laptop webcam | ⚠️ Optional | Only where the runtime supports native barcode detection — see §6 |

No internet, driver CD, or vendor software is needed for HID keyboards:
Windows treats them exactly like a keyboard.

## 2. Connect the scanner (2 minutes)

1. Plug the scanner into a USB port. Wait for the Windows "device ready" sound.
2. Open **Notepad**, scan any medicine pack.
   - Numbers/letters appear, followed by a new line → perfect, it is in
     keyboard mode with an **Enter** suffix (the factory default for most models).
   - Nothing appears → the scanner may be in "USB COM / serial" mode. Find the
     **"USB HID Keyboard"** (a.k.a. "Keyboard Wedge", "HID KBW") barcode in its
     manual/paper setup card, scan it, and retry.
3. Open MedStore Manager → **Settings → 🔫 Barcode & Scanner → Test scanner
   input**. Click the test box and scan. You should see how the app interpreted
   the code (format, check digit, and GS1 batch/expiry when present).

## 3. Configure the suffix (Enter vs Tab)

After sending the code, scanners can append **Enter** or **Tab**:

- MedStore Manager accepts **both by default** (Settings → Barcode & Scanner →
  *Scan suffix* = "Enter or Tab"). Usually you do not need to change anything.
- If your scanner appends Tab and focus jumps around other Windows apps, either
  set the app suffix to **Tab**, or reprogram the scanner to Enter using the
  "Add Enter suffix" / "Carriage Return" setup barcode in its manual.
- The same manual page usually has: *Factory reset*, *Beep on/off*, and
  *enable/disable symbologies* (make sure **EAN-13, Code 128, QR Code and
  DataMatrix** are enabled on 2D models — some ship with DataMatrix off).

## 4. How scanning behaves at the counter

- Open **Point of Sale** and just scan — with *Automatic scanner detection* ON
  (default), fast scanner input is captured **anywhere on the POS screen**; you
  never need to click the barcode box first. Pressing **F2** refocuses the box
  manually at any time.
- **Sound + banner** confirm every scan: green = added (medicine, packaging,
  quantity, price, batch), red+buzz = unknown/blocked. Toggle in Settings.
- **Repeat scans:** scan the same pack again → quantity increases. If your
  scanner occasionally double-fires one scan, the *Duplicate-scan guard window*
  (default 350 ms) collapses identical codes arriving inside that window into
  one. Set it to 0 only if you intentionally scan faster than that.
- **Packaging barcodes:** if a medicine has a *box* barcode (Medicines → View →
  Barcodes & packaging), scanning the box adds the box's base units
  (e.g. 10 strips) at the box price. Stock is always counted in base units.
- **GS1 DataMatrix:** when the code carries batch (10)/expiry (17), the app
  identifies that exact batch. An expired/quarantined scanned batch is
  **blocked with a clear warning** — it is never silently replaced by another
  batch. Codes without batch data simply use normal FEFO.
- **Unknown barcode:** nothing is added. Admins/pharmacists can register the
  code on the spot (existing medicine + packaging level, or a new medicine);
  cashiers are asked to call an authorized user.
- Scanning **never reduces stock by itself**. Stock, cash and ledgers change
  only when the sale is completed; cancelling the cart leaves everything
  untouched, and a failed checkout rolls back completely.

## 5. Receiving stock with the scanner

In **Purchases → New purchase**, the scan box adds a line for the scanned
medicine with the quantity converted to base units. If a GS1 DataMatrix
contains the batch number and expiry date, those fields are filled for you —
still verify them against the physical pack before saving.

## 6. Optional camera scanning

The 📷 button on the POS uses the device's **native `BarcodeDetector`** API
(available in Chromium-based runtimes, incl. many WebView2 builds). If your PC
does not support it, the app says so plainly — use the USB scanner instead.
Camera permission in Windows: *Settings → Privacy & security → Camera* →
allow desktop apps. The camera is a convenience fallback, never required.

## 7. Troubleshooting

| Symptom | Likely cause & fix |
|---|---|
| Nothing happens when scanning | Scanner not in HID-keyboard mode (§2), or scanner disabled in Settings → Barcode & Scanner |
| Code appears in Notepad but not in the app | Click inside the app window once (Windows focus), press F2 on POS; check *input mode* isn't "dedicated" while you scan outside the box |
| Quantity sometimes +2 for one pack | Scanner double-fire: increase the *Duplicate-scan guard window* to ~500 ms |
| Quantity won't increase on fast repeat scans | Guard window too large: reduce it (e.g. 200 ms) or set 0 |
| "Check digit INVALID" in the test box | Mis-scan or a non-GS1/local code — the app still looks it up, but verify the pack; genuine EAN/GTIN codes should validate |
| DataMatrix doesn't read at all | Symbology disabled on the scanner — scan the "DataMatrix ON" setup code from its manual |
| Batch from DataMatrix "not in stock records" | That batch was never received via Purchases — receive it first; until then FEFO is used and a warning shows |
| Strange letters (e.g. `]` or capitals shifted) | Scanner keyboard-country mismatch: set its keyboard layout to match Windows (US/UK), via the manual's country codes |

## 8. Test barcodes (sample catalog)

With the sample catalog loaded you can type these into the test box:
- `8964001234500` — Panadol Extra strip (EAN-13, valid check digit)
- `8964001234593` — Panadol Extra **box of 10 strips**
- `(01)08964001234500(17)271231(10)PN-2401(21)SN001` — sample GS1 DataMatrix
  payload (GTIN + expiry 2027-12-31 + batch PN-2401 + serial SN001)


## GS1 batch/expiry verification (important)

When a GS1 code carries a batch number, the app verifies it against stock records:
- batch not in stock records → **scan blocked** (receive it via Purchases first);
- code expiry different from the recorded batch expiry → **scan blocked** (verify the pack, correct the batch record);
- batch quarantined / damaged / written off / expired → **scan blocked**.

The app never silently substitutes a different batch for a scanned pack. Plain barcodes (no batch in the code)
continue to use normal FEFO allocation.
