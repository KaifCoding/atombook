import Dexie, { type Table } from 'dexie';
import { defaultBusiness, defaultDesign } from './defaults';
import { fyCode } from './gst';
import type { Business, Customer, DesignConfig, Doc, DocType, Item, NumberingConfig } from './types';
import { DOC_TYPES } from './types';

interface Counter {
  key: string; // `${type}:${fy}`
  last: number;
}

class BillDB extends Dexie {
  business!: Table<Business, number>;
  design!: Table<DesignConfig, number>;
  customers!: Table<Customer, number>;
  items!: Table<Item, number>;
  docs!: Table<Doc, number>;
  counters!: Table<Counter, string>;

  constructor() {
    super('billbook');
    this.version(1).stores({
      business: 'id',
      design: 'id',
      customers: '++id, name, gstin',
      items: '++id, name, hsn',
      docs: '++id, type, number, date, fy, status, [type+fy+seq]',
      counters: 'key',
    });
  }
}

export const db = new BillDB();

/* ---------------- business & design ---------------- */

export async function loadBusiness(): Promise<Business> {
  const saved = await db.business.get(1);
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

export async function saveBusiness(b: Business): Promise<void> {
  await db.business.put({ ...b, id: 1 });
}

export async function loadDesign(): Promise<DesignConfig> {
  const saved = await db.design.get(1);
  const base = defaultDesign();
  if (!saved) return base;
  return { ...base, ...saved, labels: { ...base.labels, ...saved.labels } };
}

export async function saveDesign(d: DesignConfig): Promise<void> {
  await db.design.put({ ...d, id: 1 });
}

/* ---------------- numbering ---------------- */

export function formatNumber(cfg: NumberingConfig, fy: string, seq: number): string {
  return cfg.prefix.replace(/\{FY\}/g, fy) + String(seq).padStart(cfg.padding, '0');
}

/** Peek at the next number without consuming it. */
export async function peekNumber(type: DocType, date: string, business: Business) {
  const fy = fyCode(date);
  const cfg = business.numbering[type];
  const c = await db.counters.get(`${type}:${fy}`);
  const seq = Math.max((c?.last ?? 0) + 1, cfg.start);
  return { fy, seq, number: formatNumber(cfg, fy, seq) };
}

/** Insert a brand-new document, atomically consuming the next number. */
export async function createDoc(doc: Omit<Doc, 'id' | 'number' | 'seq' | 'fy'>, business: Business): Promise<Doc> {
  return db.transaction('rw', db.docs, db.counters, async () => {
    const fy = fyCode(doc.date);
    const key = `${doc.type}:${fy}`;
    const cfg = business.numbering[doc.type];
    const c = await db.counters.get(key);
    const seq = Math.max((c?.last ?? 0) + 1, cfg.start);
    const full: Doc = { ...doc, fy, seq, number: formatNumber(cfg, fy, seq) };
    const id = await db.docs.add(full);
    await db.counters.put({ key, last: seq });
    return { ...full, id };
  });
}

export async function updateDoc(doc: Doc): Promise<void> {
  await db.docs.put({ ...doc, updatedAt: Date.now() });
}

/** Issued numbers must never disappear from the series, so documents are cancelled, not deleted. */
export async function cancelDoc(id: number): Promise<void> {
  await db.docs.update(id, { status: 'cancelled', updatedAt: Date.now() });
}

/** Only drafts / non-GST documents that were never issued may be removed. */
export async function deleteDocIfSafe(doc: Doc): Promise<boolean> {
  if (DOC_TYPES[doc.type].gstReturn) return false;
  if (doc.id != null) await db.docs.delete(doc.id);
  return true;
}
/**
 * Wipes every billing document and the numbering counters, so numbering restarts.
 * Business profile, design, customers and items are kept.
 */
export async function deleteAllBillingData(): Promise<void> {
  await db.transaction('rw', db.docs, db.counters, async () => {
    await Promise.all([db.docs.clear(), db.counters.clear()]);
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

export async function exportBackup(): Promise<BackupFile> {
  return {
    app: 'billbook',
    version: 1,
    exportedAt: new Date().toISOString(),
    business: await db.business.get(1),
    design: await db.design.get(1),
    customers: await db.customers.toArray(),
    items: await db.items.toArray(),
    docs: await db.docs.toArray(),
    counters: await db.counters.toArray(),
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
export async function importBackup(data: BackupFile): Promise<void> {
  validateBackup(data);
  await db.transaction('rw', [db.business, db.design, db.customers, db.items, db.docs, db.counters], async () => {
    await Promise.all([
      db.business.clear(), db.design.clear(), db.customers.clear(),
      db.items.clear(), db.docs.clear(), db.counters.clear(),
    ]);
    if (data.business) await db.business.put(data.business);
    if (data.design) await db.design.put(data.design);
    await db.customers.bulkPut(data.customers);
    await db.items.bulkPut(data.items);
    await db.docs.bulkPut(data.docs);
    await db.counters.bulkPut(data.counters);
  });
  const [customers, items, docs, counters] = await Promise.all([
    db.customers.count(), db.items.count(), db.docs.count(), db.counters.count(),
  ]);
  if (customers !== data.customers.length || items !== data.items.length ||
      docs !== data.docs.length || counters !== data.counters.length) {
    throw new Error('Restore verification failed. Please restore your pre-restore backup.');
  }
}
