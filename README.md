# Atombook

Offline GST invoicing for **Windows, Linux and Android** from one Next.js codebase.
All data stays on the device (IndexedDB). No server, no signup.

## Features
- **Business setup**: logo, name, address, GSTIN (checksum validated), PAN, email, phone, signature, seal, signatory name and designation, per-document custom prefix / digits / start number (`{FY}` token supported).
- **Documents (10 types)**: Tax Invoice, Bill of Supply, Normal Bill, Quotation, Proforma Invoice, Delivery Challan, Purchase Order, Credit Note, Debit Note, Payment Receipt. Each has its own numbering prefix. Quotation/Proforma/Challan convert to invoice; invoices can issue credit/debit notes and payment receipts (a receipt also records the payment on the invoice). Zero-value bills are allowed.
- **GST**: CGST/SGST vs IGST from place of supply, tax-inclusive or exclusive rates, discounts, extra charges, round-off, amount in words (lakh/crore).
- **Products and services** with HSN/SAC, unit, rate, GST %. Customer book.
- **PDF**: download for every document. Custom payment QR (UPI QR generated with the invoice amount, or upload your own QR image) and bank details.
- **Design editor**: 3 templates, accent colours, fonts, paper size, logo position/size, show/hide ~20 blocks, editable labels, watermark, header/footer text, with live preview.
- **GST returns**: GSTR-1 JSON (B2B, B2CL, B2CS, CDNR, nil-rated, HSN B2B/B2C split, document summary), GSTR-3B JSON + summary, Excel workbook, sales register / HSN / 3B CSVs.
- **Backup / restore** to a JSON file.

## Develop
```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 31 logic tests (tax math, numbering, GSTR-1/3B)
npm run build      # static export to out/
```

## Windows / Linux (Electron)
```bash
npm run electron         # build and run
npm run electron:win     # NSIS installer  (run on Windows)
npm run electron:linux   # AppImage + deb  (run on Linux)
```
Installers land in `dist/`. The app serves `out/` from a private `app://` origin, fully offline.

## Android (Capacitor)
Requires Android Studio + JDK 17.
```bash
npm run android:sync     # build + copy into android/
npm run android:open     # open in Android Studio -> Build > Build APK
```
PDFs and exports open the Android share sheet (save to Files, WhatsApp, email).

## Please verify before filing
GST rules change often. Check generated GSTR-1/3B JSON on the GST offline tool or a CA's review before uploading. Rules applied here: B2C-large limit ₹1 lakh inter-state (from 1 Aug 2024, editable in Settings), HSN 4 digits up to ₹5 cr turnover and 6 digits above, B2B/B2C HSN tabs separate.

## If the Windows build fails with `ENOTFOUND github.com` or `electronDist does not exist`
Electron and the installer tools are downloaded from github.com. If your network blocks it, use a mirror (PowerShell):
```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
node node_modules\electron\install.js
npm run electron:win
```
The variables only last for that PowerShell window. If it still fails, try a mobile hotspot, or turn off VPN/proxy and set DNS to 8.8.8.8, then run the same commands.
The finished installer is in `dist\`.

## Build the Android APK without Android Studio
**Option A, free cloud build (easiest):**
1. Create a free GitHub account and a new repository, then upload this whole folder (without `node_modules`).
2. Open the repository's **Actions** tab, choose **Build Atombook APK**, press **Run workflow**.
3. After 5 to 8 minutes open the finished run and download **Atombook-apk**. Unzip it to get `app-debug.apk`.
4. Copy it to your phone, open it, and allow "Install unknown apps" when asked.

**Option B, on your own PC, command line only:** install JDK 17 and the Android "command-line tools", then
```
npm run build
npx cap sync android
cd android
gradlew assembleDebug
```
The APK is `android\app\build\outputs\apk\debug\app-debug.apk`. This downloads from Google and Maven servers, so it needs open internet.

The debug APK is fine for your own phone. For the Play Store you need a signed release build.

## Build Windows and Linux installers in the cloud
The `.github/workflows` folder has one workflow per platform: **Build Atombook Windows installer**, **Build Atombook Linux packages** and **Build Atombook APK**.
Upload the project to a GitHub repository, open **Actions**, pick a workflow and press **Run workflow**. When it finishes, download the result from the **Artifacts** section of that run:
- Windows: `Atombook-windows` contains the setup `.exe`.
- Linux: `Atombook-linux` contains the `.AppImage` and `.deb`.
- Android: `Atombook-apk` contains `app-debug.apk`.
Change the author email in `package.json` to your own before publishing the `.deb`.