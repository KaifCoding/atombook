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


## Google Drive sync (online version)

`lib/sync/engine.ts` is storage-agnostic: every device owns one snapshot file and merges the
other devices' files into IndexedDB (newest `updatedAt` wins, tombstones record deletes, a shared
`lineage` id guards the id space). `lib/sync/drive.ts` is the Drive `appDataFolder` client,
`lib/sync/google.ts` is Google Identity Services sign-in (token model, scope `drive.appdata`),
and `components/SyncProvider.tsx` runs it (on start, focus, online, every 60 s, 3 s after edits).
Dexie hooks in `lib/db.ts` stamp `updatedAt` and create time-based ids so devices never collide.
Schema v2 adds the local-only `tombstones` and `meta` tables. Tests: `tests/sync.ts`.

Sign-in per platform (`lib/sync/auth.ts`): web uses Google Identity Services; the Windows/Linux app
uses `electron/google-auth.js` (system browser, PKCE, loopback redirect, tokens in the main process,
`electron/preload.js` bridge); Android uses `lib/sync/android.ts` (Custom Tab, PKCE, deep link
`in.atomprod.atombook:/oauth2redirect`). Tests: `tests/desktop-auth.ts`, `tests/android-auth.ts`.
