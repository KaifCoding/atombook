# Local Database and Compatibility

AtomBook uses Dexie over IndexedDB. The current database is named `billbook` and includes `business`, `design`, `customers`, `items`, `docs` and `counters` stores. The current schema is version 1.

Database changes must use Dexie version upgrades and tested migrations. Prefer additive fields with safe defaults. Never clear stores during application startup. Never reuse issued document numbers. Review duplicate document numbers and stale counters before introducing uniqueness constraints.

The current JSON backup format uses `app: "billbook"` and `version: 1`. Maintain compatibility or provide an explicit import migration.
