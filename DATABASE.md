# Local Database and Compatibility

AtomBook uses Dexie over IndexedDB. The current database is named `billbook` and includes `business`, `design`, `customers`, `items`, `docs` and `counters` stores. The current schema is version 1.

Database changes must use Dexie version upgrades and tested migrations. Prefer additive fields with safe defaults. Never clear stores during application startup. Never reuse issued document numbers. Review duplicate document numbers and stale counters before introducing uniqueness constraints.

The current JSON backup format uses `app: "billbook"` and `version: 1`. Maintain compatibility or provide an explicit import migration.


## Schema v2 (Google Drive sync)

Additive only. `tombstones` (`[table+id]`, `deletedAt`) records deletions and `meta` (`key`) holds
local sync state; neither is exported in backups. Synced records carry `updatedAt`. New customers,
items and documents get time-based integer ids (~1.8e15) instead of 1, 2, 3 ...; old ids stay valid.
