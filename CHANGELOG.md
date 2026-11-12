# Changelog

All notable changes should be recorded here.

## Unreleased

- Google Drive sync also in the Android app (Custom Tab + deep link) and the Windows/Linux app (system browser + loopback), with silent token refresh.

- Online (PWA) version: installable, works offline.
- Optional Google Drive sync between devices (hidden app folder, no server). New records use time-based ids; schema v2 adds local `tombstones` and `meta` tables.
- Hardened backup validation before database replacement.
- Improved Electron file path boundary validation and navigation restrictions.
- Standardised AtomBook product metadata and documentation.
- Added contributor, security, architecture, database, GST and backup documentation.
