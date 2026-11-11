import Dexie, { type Table } from 'dexie';
import { defaultBusiness, defaultDesign } from './defaults';
import { fyCode } from './gst';
import type { Business, Customer, DesignConfig, Doc, DocType, Item, NumberingConfig } from './types';
import { DOC_TYPES } from './types';

export interface Counter {
  key: string; // `${type}:${fy}`
  last: number;
  updatedAt?: number; // set automatically; used by Drive sync
}

/** A record that was deleted. Lets other devices learn about deletes during Drive sync. */
export interface Tombstone {
  table: SyncTable;
  id: number | string;
  deletedAt: number;
}

/** Local-only key/value store for sync state (never exported, never synced). */
export interface MetaRow {
  key: string;
  value: unknown;
}

/** The stores that are shared between devices. */
export const SYNC_TABLES = ['business', 'design', 'customers', 'items', 'docs', 'counters'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/* ---------------- ids ---------------- */

let lastId = 0;
/**
 * New ids for customers, items and documents.
 *
 * Plain auto-increment ids (1, 2, 3 ...) would collide as soon as two devices create
 * records independently, so new records get a time-based id instead. It is still a
 * positive safe integer (~1.8e15), so backups, URLs and every existing reference keep
 * working, and ids from older versions (small numbers) stay valid.
 */
export function newId(): number {
  let rand = Math.floor(Math.random() * 1000);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    rand = crypto.getRandomValues(new Uint16Array(1))[0] % 1000;
  }
  let id = Date.now() * 1000 + rand;
  if (id <= lastId) id = lastId + 1;
  lastId = id;
  return id;
}

/* ---------------- local change notifications ---------------- */

const changeListeners = new Set<() => void>();
/** Called (debounced by the listener) whenever the user changes data on this device. */
export function onLocalChange(cb: () => void): () => void {
  changeListeners.add(cb);
  return () => {
    changeListeners.delete(cb);
  };
}
function notifyLocalChange() {
  for (const cb of changeListeners) {
    try {
      cb();
    } catch {
      /* a listener must never break a database write */
    }
  }
}

/** Writes made by the sync engine run in a transaction tagged with source = 'sync'. */
export const SYNC_SOURCE = 'sync';
export function isSyncTransaction(trans: unknown): boolean {
  return (trans as { source?: string } | null | undefined)?.source === SYNC_SOURCE;
}

export class BillDB extends Dexie {
  business!: Table<Business, number>;
  design!: Table<DesignConfig, number>;
  customers!: Table<Customer, number>;
  items!: Table<Item, number>;
  docs!: Table<Doc, number>;
  counters!: Table<Counter, string>;
  tombstones!: Table<Tombstone, [string, number | string]>;
  meta!: Table<MetaRow, string>;

  /** The name is only ever changed in tests. The app always uses `billbook`. */
  constructor(name = 'billbook') {
    super(name);
    this.version(1).stores({
      business: 'id',
      design: 'id',
      customers: '++id, name, gstin',
      items: '++id, name, hsn',
      docs: '++id, type, number, date, fy, status, [type+fy+seq]',
      counters: 'key',
    });
    // v2 is purely additive: two local-only tables used by Google Drive sync.
    this.version(2).stores({
      tombstones: '[table+id], deletedAt',
      meta: 'key',
    });

    for (const name of SYNC_TABLES) {
      const table = this.table(name);
      const needsId = name === 'customers' || name === 'items' || name === 'docs';
      table.hook('creating', function (primKey, obj, trans) {
        if (isSyncTransaction(trans)) return undefined;
        (obj as { updatedAt?: number }).updatedAt = Date.now();
        notifyLocalChange();
        if (needsId && primKey == null) return newId();
        return undefined;
      });
      table.hook('updating', function (mods, _primKey, _obj, trans) {
        if (isSyncTransaction(trans)) return undefined;
        if (Object.keys(mods).length === 0) return undefined; // put() of an unchanged record
        notifyLocalChange();
        return { updatedAt: Date.now() };
      });
    }
  }
}

export const db = new BillDB();

/* ---------------- business & design ---------------- */

export async function loadBusiness(d: BillDB = db): Promise<Business> {
  const saved = await d.business.get(1);
  const base = defaultBusiness();
  if (!saved) return base;
  // merge so that newly added fields get defaults after upgrades
  return {
    ...base,
    ...saved,
    bank: { ...base.bank, ...saved.bank },
    numbering: { ...base.numbering, ...saved.numbering },
  };
}

export async function saveBusiness(b: Business, d: BillDB = db): Promise<void> {
  await d.business.put({ ...b, id: 1 });
}

export async function loadDesign(d: BillDB = db): Promise<DesignConfig> {
  const saved = await d.design.get(1);
  const base = defaultDesign();
  if (!saved) return base;
  return { ...base, ...saved, labels: { ...base.labels, ...saved.labels } };
}

export async function saveDesign(cfg: DesignConfig, d: BillDB = db): Promise<void> {
  await d.design.put({ ...cfg, id: 1 });
}

/* ---------------- numbering ---------------- */

export function formatNumber(cfg: NumberingConfig, fy: string, seq: number): string {
  return cfg.prefix.replace(/\{FY\}/g, fy) + String(seq).padStart(cfg.padding, '0');
}

/** Peek at the next number without consuming it. */
export async function peekNumber(type: DocType, date: string, business: Business, d: BillDB = db) {
  const fy = fyCode(date);
  const cfg = business.numbering[type];
  const c = await d.counters.get(`${type}:${fy}`);
  const seq = Math.max((c?.last ?? 0) + 1, cfg.start);
  return { fy, seq, number: formatNumber(cfg, fy, seq) };
}

/** Insert a brand-new document, atomically consuming the next number. */
export async function createDoc(doc: Omit<Doc, 'id' | 'number' | 'seq' | 'fy'>, business: Business, d: BillDB = db): Promise<Doc> {
  return d.transaction('rw', d.docs, d.counters, async () => {
    const fy = fyCode(doc.date);
    const key = `${doc.type}:${fy}`;
    const cfg = business.numbering[doc.type];
    const c = await d.counters.get(key);
    const seq = Math.max((c?.last ?? 0) + 1, cfg.start);
    const full: Doc = { ...doc, fy, seq, number: formatNumber(cfg, fy, seq) };
    const id = await d.docs.add(full);
    await d.counters.put({ key, last: seq });
    return { ...full, id };
  });
}

export async function updateDoc(doc: Doc, d: BillDB = db): Promise<void> {
  await d.docs.put({ ...doc, updatedAt: Date.now() });
}

/** Issued numbers must never disappear from the series, so documents are cancelled, not deleted. */
export async function cancelDoc(id: number, d: BillDB = db): Promise<void> {
  await d.docs.update(id, { status: 'cancelled', updatedAt: Date.now() });
}

/** Record a delete so other devices learn about it. Call inside a transaction that includes d.tombstones. */
export async function addTombstone(d: BillDB, table: SyncTable, id: number | string): Promise<void> {
  await d.tombstones.put({ table, id, deletedAt: Date.now() });
  notifyLocalChange();
}

export async function deleteCustomer(id: number, d: BillDB = db): Promise<void> {
  await d.transaction('rw', d.customers, d.tombstones, async () => {
    await d.customers.delete(id);
    await addTombstone(d, 'customers', id);
  });
}

export async function deleteItem(id: number, d: BillDB = db): Promise<void> {
  await d.transaction('rw', d.items, d.tombstones, async () => {
    await d.items.delete(id);
    await addTombstone(d, 'items', id);
  });
}

/** Only drafts / non-GST documents that were never issued may be removed. */
export async function deleteDocIfSafe(doc: Doc, d: BillDB = db): Promise<boolean> {
  if (DOC_TYPES[doc.type].gstReturn) return false;
  const id = doc.id;
  if (id != null) {
    await d.transaction('rw', d.docs, d.tombstones, async () => {
      await d.docs.delete(id);
      await addTombstone(d, 'docs', id);
    });
  }
  return true;
}
/**
 * Wipes every billing document and the numbering counters, so numbering restarts.
 * Business profile, design, customers and items are kept.
 */
export async function deleteAllBillingData(d: BillDB = db): Promise<void> {
  await d.transaction('rw', d.docs, d.counters, d.tombstones, async () => {
    const [docIds, counterKeys] = await Promise.all([d.docs.toCollection().primaryKeys(), d.counters.toCollection().primaryKeys()]);
    await Promise.all([d.docs.clear(), d.counters.clear()]);
    for (const id of docIds) await addTombstone(d, 'docs', id);
    for (const key of counterKeys) await addTombstone(d, 'counters', key);
  });
}

/* ---------------- backup / restore ---------------- */

export interface BackupFile {
  app: 'billbook';
  version: 1;
  exportedAt: string;
  business?: Business;
  design?: DesignConfig;
  customers: Customer[];
  items: Item[];
  docs: Doc[];
  counters: Counter[];
}

export async function exportBackup(d: BillDB = db): Promise<BackupFile> {
  return {
    app: 'billbook',
    version: 1,
    exportedAt: new Date().toISOString(),
    business: await d.business.get(1),
    design: await d.design.get(1),
    customers: await d.customers.toArray(),
    items: await d.items.toArray(),
    docs: await d.docs.toArray(),
    counters: await d.counters.toArray(),
  };
}

type BackupRecord = Record<string, unknown>;

function isRecord(value: unknown): value is BackupRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateBackup(input: unknown): asserts input is BackupFile {
  if (!isRecord(input) || input.app !== 'billbook') {
    throw new Error('This is not an AtomBook backup file.');
  }
  if (input.version !== 1) throw new Error(`Unsupported backup version: ${String(input.version)}.`);
  if (typeof input.exportedAt !== 'string' || Number.isNaN(Date.parse(input.exportedAt))) {
    throw new Error('The backup export date is missing or invalid.');
  }
  for (const key of ['customers', 'items', 'docs', 'counters'] as const) {
    if (!Array.isArray(input[key])) throw new Error(`The backup is incomplete: ${key} must be an array.`);
  }
  for (const key of ['business', 'design'] as const) {
    if (input[key] !== undefined && input[key] !== null && !isRecord(input[key])) {
      throw new Error(`The backup contains an invalid ${key} record.`);
    }
  }
  const validateIds = (records: unknown[], name: string) => {
    const seen = new Set<number>();
    for (const [index, record] of records.entries()) {
      if (!isRecord(record) || !Number.isSafeInteger(record.id) || Number(record.id) <= 0) {
        throw new Error(`Invalid ${name} record at position ${index + 1}: a positive numeric id is required.`);
      }
      const id = Number(record.id);
      if (seen.has(id)) throw new Error(`Duplicate ${name} id ${id} in backup.`);
      seen.add(id);
    }
  };
  validateIds(input.customers as unknown[], 'customer');
  validateIds(input.items as unknown[], 'item');
  validateIds(input.docs as unknown[], 'document');
  const counterKeys = new Set<string>();
  for (const [index, counter] of (input.counters as unknown[]).entries()) {
    if (!isRecord(counter) || typeof counter.key !== 'string' || !counter.key ||
        !Number.isSafeInteger(counter.last) || Number(counter.last) < 0) {
      throw new Error(`Invalid numbering counter at position ${index + 1}.`);
    }
    if (counterKeys.has(counter.key)) throw new Error(`Duplicate numbering counter: ${counter.key}.`);
    counterKeys.add(counter.key);
  }
  const docNumbers = new Set<string>();
  for (const [index, doc] of (input.docs as unknown[]).entries()) {
    if (!isRecord(doc) || typeof doc.type !== 'string' || typeof doc.number !== 'string' ||
        typeof doc.date !== 'string' || typeof doc.fy !== 'string' ||
        !Number.isSafeInteger(doc.seq) || Number(doc.seq) <= 0) {
      throw new Error(`Invalid document at position ${index + 1}: required numbering/date fields are missing.`);
    }
    const key = `${doc.type}:${doc.number}`;
    if (docNumbers.has(key)) throw new Error(`Duplicate document number ${doc.number} for ${doc.type}.`);
    docNumbers.add(key);
  }
}

/**
 * Validate the complete payload before touching IndexedDB. Dexie's transaction
 * makes the replacement atomic: a failed write aborts and retains the old data.
 * The v1 export format and the legacy database name intentionally remain stable.
 */
export async function importBackup(data: BackupFile, d: BillDB = db): Promise<void> {
  validateBackup(data);
  await d.transaction('rw', [d.business, d.design, d.customers, d.items, d.docs, d.counters, d.tombstones], async () => {
    // Remember what disappears, so that a restore also removes it on the other synced devices.
    const before = {
      customers: await d.customers.toCollection().primaryKeys(),
      items: await d.items.toCollection().primaryKeys(),
      docs: await d.docs.toCollection().primaryKeys(),
      counters: await d.counters.toCollection().primaryKeys(),
    };
    await Promise.all([
      d.business.clear(), d.design.clear(), d.customers.clear(),
      d.items.clear(), d.docs.clear(), d.counters.clear(),
    ]);
    // These writes are stamped with the current time, so the restored data wins over
    // older copies of the same records on other devices.
    if (data.business) await d.business.put(data.business);
    if (data.design) await d.design.put(data.design);
    await d.customers.bulkPut(data.customers);
    await d.items.bulkPut(data.items);
    await d.docs.bulkPut(data.docs);
    await d.counters.bulkPut(data.counters);
    const kept = {
      customers: new Set<number | string>(data.customers.map((r) => r.id as number)),
      items: new Set<number | string>(data.items.map((r) => r.id as number)),
      docs: new Set<number | string>(data.docs.map((r) => r.id as number)),
      counters: new Set<number | string>(data.counters.map((r) => r.key)),
    };
    for (const table of ['customers', 'items', 'docs', 'counters'] as const) {
      for (const id of before[table]) if (!kept[table].has(id)) await addTombstone(d, table, id);
    }
  });
  const [customers, items, docs, counters] = await Promise.all([
    d.customers.count(), d.items.count(), d.docs.count(), d.counters.count(),
  ]);
  if (customers !== data.customers.length || items !== data.items.length ||
      docs !== data.docs.length || counters !== data.counters.length) {
    throw new Error('Restore verification failed. Please restore your pre-restore backup.');
  }
}
