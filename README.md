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

## Releasing (one workflow, one release page)
Pushing a new number in `version.json` to `main` builds **Android (signed APK), Windows (installer) and Linux (AppImage + deb)** in GitHub Actions and attaches all of them, plus the update files, to one release `v<version>`. You can also run it by hand: **Actions > Release > Run workflow**.

### One-time setup
1. Make the repository public, so phones can check for updates without a login.
2. Create the Android signing key once and **keep it safe**; every release must use the same key or phones refuse to update.
   ```
   keytool -genkeypair -v -keystore release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias atombook
   ```
   Then in PowerShell copy it as text: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("release-key.jks")) | Set-Clipboard`
3. In the repository: **Settings > Secrets and variables > Actions > New repository secret**, add:
   - `ANDROID_KEYSTORE_BASE64` (the copied text)
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_PASSWORD`
   - `ANDROID_KEY_ALIAS` (`atombook`)
4. **Settings > Actions > General > Workflow permissions**: choose *Read and write permissions*.

### Every release
Edit `version.json` (for example `{ "version": "1.0.1" }`), commit, push. The release appears after about 10 minutes.

### How updates reach users
- **Windows** (installer) and **Linux** (AppImage): the app checks the release when it starts, downloads the new version and asks to restart. The `.deb` does not self-update.
- **Android**: the app checks the release on start and shows an **Update** banner that opens the new APK. The user taps it and installs over the old app (Android may ask once to allow installs from the browser). Data is kept.
- The first install of each platform is manual; after that the app tells you.
