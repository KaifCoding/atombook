# Backup and Restore

Export backups regularly and store copies somewhere separate from the device. A backup may contain sensitive business and customer information; protect it accordingly.

Restore validates the backup identifier, format version, required collections, record IDs, document numbering fields and counters before replacing local data. The database replacement is performed in a Dexie read-write transaction so failed writes abort rather than leave a partial import. Verify the restored business, documents and counts before continuing work. Keep an independent copy of the original backup.
