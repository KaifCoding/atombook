<p align="center">
  <img src="assets/icon.svg" alt="AtomBook" width="96" height="96">
</p>

<h1 align="center">AtomBook</h1>

<p align="center">
  Free GST invoicing and billing software for India. Works offline, keeps your data on your own device.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platforms-Android%20%7C%20Windows%20%7C%20Linux-informational">
</p>

---

AtomBook is a small, open source billing app for shops, freelancers and small businesses. You set up your business once, add your products, and issue invoices, bills, quotations and other documents as PDFs. When the month ends, it produces the files you need for GST filing.

There is no account, no subscription and no server. Everything is stored on the device you install it on.

## Features

**Documents.** Tax Invoice, Bill of Supply, Normal Bill, Quotation, Proforma Invoice, Delivery Challan, Purchase Order, Credit Note, Debit Note and Payment Receipt. Each type has its own numbering with a prefix you choose (for example `INV/2627/0001`), and numbers restart every financial year. A quotation or proforma can be converted to an invoice, and an invoice can raise a credit note, debit note or receipt. Bills of zero value are allowed.

**GST.** CGST and SGST for sales inside your state, IGST for sales outside it, based on the place of supply. Rates can be entered tax-inclusive or tax-exclusive, with discounts and extra charges, and the total is also written in words (lakh and crore).

**Business profile.** Logo, name, address, GSTIN (checked for a valid format and checksum), PAN, contact details, signature, seal, and the name and designation of the signatory.

**PDF output.** Every document downloads or shares as a PDF with your bank details and a payment QR code. The QR is either a UPI QR generated for the invoice amount or an image you upload yourself.

**Invoice design.** Three templates, your own accent colour, font, paper size and logo position, labels you can rename, and switches for most blocks on the page. The seal can sit to the right of the signature, to the left, or over it, and its size is adjustable. A live preview updates as you change things.

**Products, services and customers.** Keep an item list with HSN or SAC code, unit, rate and GST rate, and a customer list that fills in party details for you.

**GST returns.** GSTR-1 as JSON for the GST portal's offline tool (B2B, B2C large, B2C small, credit and debit notes, nil-rated supplies, HSN summary and document summary), a GSTR-3B summary as JSON, an Excel workbook, and CSV reports for your accountant.

**Backup.** Export everything to a single file and restore it on another device.

## Download

Get the latest build from the [Releases page](../../releases/latest).

| Platform | File | Notes |
| --- | --- | --- |
| Android 7+ | `AtomBook-x.y.z.apk` | Sideload install |
| Windows 10 / 11 | `AtomBook-Setup-x.y.z.exe` | Installer |
| Linux (Debian, Ubuntu and derivatives) | `AtomBook-x.y.z-amd64.deb` | Installed with `apt` |

### Installing

**Windows.** Run the installer. The app is not code-signed, so Windows SmartScreen may show a warning the first time. Choose *More info*, then *Run anyway*.

**Android.** Open the APK on your phone. If Android asks, allow installs from the app you opened it with (your browser or file manager). Play Protect may show a notice because the app is not distributed through the Play Store.

**Linux.**

```sh
sudo apt install ./AtomBook-x.y.z-amd64.deb
```

### Updates

The app looks for a newer release when it starts. On Windows and Linux it shows a dialog with a link to the new installer. On Android it shows a banner that opens the new APK. In every case you install over the existing app and your data is kept. Nothing is downloaded or installed without you asking for it.

## Getting started

1. Open **Settings** and fill in your business details, upload your logo, signature and seal, and add your bank details and UPI ID.
2. Choose your GST scheme (regular, composition or unregistered). This decides which documents you can issue.
3. Add your products and services under **Items**.
4. Create your first document from the home screen.
5. Use **Design** to adjust how your invoices look.
6. At the end of the month, open **GST Returns**, pick the period and export.

## Your data

AtomBook stores everything in the browser database of the app itself (IndexedDB). Nothing is sent to any server, and the app makes no network requests except the update check described above.

That also means the data lives only on that device. If you uninstall the app, clear its storage or lose the phone, the data goes with it. Use **Settings > Backup & restore** regularly and keep the file somewhere safe.

## About GST filing

AtomBook prepares the data; it does not file anything for you. GST rules and the portal's file formats change from time to time. Before uploading a return, check the figures against your books and, if you have one, ask your accountant to review them. The B2C large invoice limit (Rs 1 lakh for inter-state supplies) is editable in Settings in case the rule changes again.

This software is provided as is, under the MIT license, and is not tax advice.

## Building from source

You need Node.js 22 or newer. Building the Android app also needs JDK 21 and the Android SDK.

```sh
git clone https://github.com/kaifcoding/atombook.git
cd atombook
npm install
npm run dev          # http://localhost:3000
npm test             # tax, numbering and GSTR-1/3B tests
```

Desktop:

```sh
npm run electron         # build and run
npm run electron:win     # Windows installer, run on Windows
npm run electron:linux   # .deb package, run on Linux
```

Android:

```sh
npm run android:sync     # build the web app and copy it into android/
cd android
./gradlew assembleDebug  # APK in app/build/outputs/apk/debug/
```

If `electron-builder` cannot reach github.com from your network, set `ELECTRON_MIRROR` and `ELECTRON_BUILDER_BINARIES_MIRROR` to a mirror before running the build.

### How it is put together

The interface is a Next.js app exported as static files, with Dexie for local storage and `@react-pdf/renderer` for the PDFs. Electron wraps it for Windows and Linux, and Capacitor wraps it for Android, so all three share one codebase.

```
app/          pages (home, documents, items, customers, reports, design, settings)
components/   shared UI and the PDF layout
lib/          tax calculation, numbering, GST return builders, database
electron/     desktop shell
android/      Capacitor project
tests/        unit tests for the tax and return logic
scripts/      build helpers
```

## Releasing

A release is made by changing the number in `version.json` and pushing to `main`. The workflow in `.github/workflows/release.yml` then builds the APK, the Windows installer and the `.deb`, and attaches the three files to a release tagged `v<version>`. It can also be started by hand from the Actions tab.

One-time setup for maintainers:

1. Create an Android signing key and keep it safe. Every release must be signed with the same key, otherwise phones will refuse to update the app.
   ```sh
   keytool -genkeypair -v -keystore release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias atombook
   ```
2. Add these repository secrets: `ANDROID_KEYSTORE_BASE64` (the keystore file, base64 encoded), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD` and `ANDROID_KEY_ALIAS`.
3. Under *Settings > Actions > General*, give workflows read and write permission.
4. Keep the repository public so that installed apps can check for new releases.

## Contributing

Bug reports and pull requests are welcome. For anything larger than a small fix, please open an issue first so we can agree on the approach. Run `npm test` and `npx tsc --noEmit` before sending a change, and add a test when you touch tax or return logic.

## License

AtomBook is released under the [MIT License](LICENSE).

## Author

Mohammad Kaif, [kaif@atomprod.in](mailto:kaif@atomprod.in)


## Online app + Google Drive sync

AtomBook can be hosted as a static website (installable, works offline) and sync between your
phone and computer through a hidden folder in your own Google Drive, with no database or server.
See [ONLINE-SETUP.md](ONLINE-SETUP.md).
