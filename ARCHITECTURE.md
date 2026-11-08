# AtomBook Architecture

AtomBook is an offline-first business invoicing application. The Next.js App Router and React provide the UI; Dexie/IndexedDB persists business data locally; `lib/gst.ts`, `lib/build.ts` and `lib/returns.ts` implement financial and return-related domain logic; `@react-pdf/renderer` creates documents. Electron serves the static export through the stable `app://billbook/` origin. Capacitor packages the web application for Android.

## Data flow
UI actions call local data/domain modules. Data is stored in IndexedDB; no application backend is required for normal operation. The desktop release may contact GitHub to check for updates.

## Compatibility contracts
- IndexedDB database name: `billbook`.
- Electron origin: `app://billbook/`.
- Backup identifier: `billbook`; current backup format version: `1`.
- Existing document IDs, numbers, financial years, sequence values and saved totals must be preserved.

Do not change these identifiers without an explicit migration and upgrade test.
