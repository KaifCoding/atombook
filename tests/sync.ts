/**
 * Sync tests: two (or three) simulated devices, each with its own IndexedDB, talking to an
 * in-memory stand-in for Google Drive. Run with `npm test`.
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { buildDocPayload } from '../lib/build';
import {
  BillDB,
  createDoc,
  deleteAllBillingData,
  deleteCustomer,
  exportBackup,
  importBackup,
  saveBusiness,
  updateDoc,
} from '../lib/db';
import { defaultBusiness } from '../lib/defaults';
import {
  type RemoteFile,
  type RemoteProps,
  type RemoteStore,
  type SyncContext,
  decodeSnapshot,
  deleteCloudCopy,
  encodeSnapshot,
  buildSnapshot,
  runSync,
} from '../lib/sync/engine';
import type { Doc, LineItem } from '../lib/types';

/* ---------- fake Drive ---------- */

class MemStore implements RemoteStore {
  files = new Map<string, { file: RemoteFile; body: Uint8Array }>();
  private n = 0;
  private clock = Date.parse('2026-11-01T00:00:00Z');
  calls = { list: 0, read: 0, create: 0, update: 0, remove: 0 };
  private stamp(id: string, name: string, body: Uint8Array, props: RemoteProps): RemoteFile {
    this.clock += 1000;
    const prev = this.files.get(id)?.file;
    const file: RemoteFile = {
      id,
      name,
      version: `v${++this.n}`,
      modifiedTime: new Date(this.clock).toISOString(),
      deviceId: props.deviceId,
      deviceName: props.deviceName,
      lineage: props.lineage,
    };
    void prev;
    this.files.set(id, { file, body });
    return file;
  }
  async list() {
    this.calls.list++;
    return [...this.files.values()].map((x) => x.file);
  }
  async read(f: RemoteFile) {
    this.calls.read++;
    const x = this.files.get(f.id);
    if (!x) throw new Error('404');
    return x.body;
  }
  async create(name: string, body: Uint8Array, props: RemoteProps) {
    this.calls.create++;
    return this.stamp(`f${++this.n}`, name, body, props);
  }
  async update(id: string, body: Uint8Array, props: RemoteProps) {
    this.calls.update++;
    const cur = this.files.get(id);
    if (!cur) throw new Error('404');
    return this.stamp(id, cur.file.name, body, props);
  }
  async remove(id: string) {
    this.calls.remove++;
    this.files.delete(id);
  }
}

/* ---------- helpers ---------- */

let dbCount = 0;
const device = (store: MemStore, name: string) => {
  const db = new BillDB(`test-${++dbCount}`);
  const ctx: SyncContext = { db, store, deviceName: name };
  return { db, ctx, sync: (resolve?: 'cloud' | 'local') => runSync(ctx, resolve) };
};

const line = (o: Partial<LineItem> = {}): LineItem => ({
  name: 'Widget', description: '', hsn: '8517', unit: 'NOS', qty: 1, rate: 100, discountPct: 0, gstRate: 18, taxInclusive: false, ...o,
});

const biz = { ...defaultBusiness(), name: 'Acme Traders', stateCode: '27', gstin: '27AAPFU0939F1ZV' };

const invoice = (db: BillDB, rate = 100, date = '2026-11-02') =>
  createDoc(
    buildDocPayload(
      {
        type: 'tax_invoice', date, dueDate: date,
        party: { name: 'Walk-in Customer', gstin: '', address: '', stateCode: '27', phone: '', email: '' },
        placeOfSupply: '27', lines: [line({ rate })], extras: [], reverseCharge: false, notes: '', terms: '',
        status: 'unpaid', payments: [], roundOffEnabled: true, showTaxInQuotation: false,
      },
      biz,
    ),
    biz,
    db,
  );

const addCustomer = (db: BillDB, name: string) =>
  db.customers.add({ name, gstin: '', address: '', stateCode: '27', phone: '', email: '', createdAt: Date.now() });

const wait = (ms = 3) => new Promise((r) => setTimeout(r, ms));
const numbers = async (db: BillDB) => (await db.docs.toArray()).map((d) => d.number).sort();

let passed = 0;
const t = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n`, e);
    process.exitCode = 1;
  }
};

/* ---------- tests ---------- */

(async () => {
  await t('new records get large unique ids, stamped with updatedAt', async () => {
    const a = device(new MemStore(), 'A');
    const c1 = await addCustomer(a.db, 'One');
    const c2 = await addCustomer(a.db, 'Two');
    assert.ok(Number.isSafeInteger(c1) && c1 > 1e14, `id ${c1}`);
    assert.notEqual(c1, c2);
    const row = await a.db.customers.get(c1);
    assert.ok((row?.updatedAt ?? 0) > 0);
    const before = row?.updatedAt ?? 0;
    await wait();
    await a.db.customers.update(c1, { name: 'One!' });
    assert.ok(((await a.db.customers.get(c1))?.updatedAt ?? 0) > before);
  });

  await t('snapshot survives gzip round trip', async () => {
    const a = device(new MemStore(), 'A');
    await saveBusiness(biz, a.db);
    await invoice(a.db);
    const snap = await buildSnapshot(a.db, { lineage: 'L', deviceId: 'D', deviceName: 'A' });
    const back = await decodeSnapshot(await encodeSnapshot(snap));
    assert.deepEqual(back, JSON.parse(JSON.stringify(snap)));
    await assert.rejects(decodeSnapshot(new TextEncoder().encode('{"app":"other"}')), /not an AtomBook sync file/);
  });

  await t('first device starts the cloud copy; a fresh device joins it', async () => {
    const store = new MemStore();
    const a = device(store, 'Phone');
    await saveBusiness(biz, a.db);
    await invoice(a.db);
    await addCustomer(a.db, 'Ravi');
    const ra = await a.sync();
    assert.equal(ra.status, 'ok');
    assert.equal(ra.status === 'ok' && ra.started, true);
    assert.equal(store.files.size, 1);

    const b = device(store, 'Laptop');
    const rb = await b.sync();
    assert.equal(rb.status, 'ok');
    assert.equal(await b.db.docs.count(), 1);
    assert.equal((await b.db.customers.toArray())[0].name, 'Ravi');
    assert.equal((await b.db.business.get(1))?.name, 'Acme Traders');
    assert.equal(store.files.size, 2); // one file per device
    // counters came along, so the next number continues the series
    const next = await invoice(b.db);
    assert.ok(next.number.endsWith('0002'), next.number);
  });

  await t('nothing changed: no download, no upload', async () => {
    const store = new MemStore();
    const a = device(store, 'A');
    await a.db.business.put({ ...biz });
    await a.sync();
    const b = device(store, 'B');
    await b.sync();
    await a.sync();
    await b.sync();
    const c = { ...store.calls };
    const r = await b.sync();
    assert.equal(r.status === 'ok' && r.uploaded, false);
    assert.equal(store.calls.read, c.read);
    assert.equal(store.calls.create + store.calls.update, c.create + c.update);
  });

  await t('changes flow both ways and the newest edit wins', async () => {
    const store = new MemStore();
    const a = device(store, 'A');
    const id = await addCustomer(a.db, 'Original');
    await a.sync();
    const b = device(store, 'B');
    await b.sync();
    assert.equal((await b.db.customers.get(id))?.name, 'Original');

    await a.db.customers.update(id, { name: 'Edited on A' });
    await wait(5);
    await b.db.customers.update(id, { name: 'Edited on B (later)' });
    const newOnA = await addCustomer(a.db, 'Only on A');
    await a.sync();
    await b.sync();
    await a.sync();
    assert.equal((await a.db.customers.get(id))?.name, 'Edited on B (later)');
    assert.equal((await b.db.customers.get(id))?.name, 'Edited on B (later)');
    assert.equal((await b.db.customers.get(newOnA))?.name, 'Only on A');
    assert.equal(await a.db.customers.count(), 2);
  });

  await t('a stale device cannot overwrite a newer edit', async () => {
    const store = new MemStore();
    const a = device(store, 'A');
    const id = await addCustomer(a.db, 'v1');
    await a.sync();
    const b = device(store, 'B');
    await b.sync();
    await wait(5);
    await a.db.customers.update(id, { name: 'v2' });
    await a.sync();
    // B syncs without having edited anything: B's old copy must not win
    await b.sync();
    assert.equal((await b.db.customers.get(id))?.name, 'v2');
    await a.sync();
    assert.equal((await a.db.customers.get(id))?.name, 'v2');
  });

  await t('deletes propagate and do not come back', async () => {
    const store = new MemStore();
    const a = device(store, 'A');
    const keep = await addCustomer(a.db, 'Keep');
    const gone = await addCustomer(a.db, 'Gone');
    await a.sync();
    const b = device(store, 'B');
    await b.sync();
    assert.equal(await b.db.customers.count(), 2);

    await deleteCustomer(gone, a.db);
    await a.sync();
    await b.sync();
    assert.equal(await b.db.customers.get(gone), undefined);
    assert.ok(await b.db.customers.get(keep));
    // B's old file still contains "Gone" until it uploads again; syncing back must not resurrect it
    await a.sync();
    await b.sync();
    await a.sync();
    assert.equal(await a.db.customers.get(gone), undefined);
    assert.equal(await b.db.customers.get(gone), undefined);
    assert.equal(await a.db.customers.count(), 1);
  });

  await t('same invoice number issued offline on two devices: later one is renumbered', async () => {
    const store = new MemStore();
    const a = device(store, 'A');
    await a.db.business.put({ ...biz });
    const first = await invoice(a.db);
    assert.ok(first.number.endsWith('0001'));
    await a.sync();
    const b = device(store, 'B');
    await b.sync();

    // both go offline and each issues "the next" invoice
    const onA = await invoice(a.db, 100);
    await wait(5);
    const onB = await invoice(b.db, 200);
    assert.equal(onA.number, onB.number);
    assert.notEqual(onA.id, onB.id);

    await a.sync();
    await b.sync();
    await a.sync();
    await b.sync();

    const na = await numbers(a.db);
    const nb = await numbers(b.db);
    assert.deepEqual(na, nb);
    assert.equal(new Set(na).size, 3, `numbers: ${na.join(', ')}`);
    assert.equal(na.length, 3);
    // the one created first keeps the number
    assert.equal((await a.db.docs.get(onA.id as number))?.number, onA.number);
    const moved = await b.db.docs.get(onB.id as number);
    assert.ok(moved?.number.endsWith('0003'), String(moved?.number));
    // and the next new invoice continues after the highest
    const n = await invoice(a.db);
    assert.ok(n.number.endsWith('0004'), n.number);
  });

  await t('editing an invoice on one device updates it on the other', async () => {
    const store = new MemStore();
    const a = device(store, 'A');
    await a.db.business.put({ ...biz });
    const inv = await invoice(a.db, 100);
    await a.sync();
    const b = device(store, 'B');
    await b.sync();
    await wait(5);
    const onB = (await b.db.docs.get(inv.id as number)) as Doc;
    await updateDoc({ ...onB, notes: 'paid by UPI' }, b.db);
    await b.sync();
    await a.sync();
    assert.equal((await a.db.docs.get(inv.id as number))?.notes, 'paid by UPI');
  });

  await t('a used device cannot silently merge: it must choose cloud or this device', async () => {
    const store = new MemStore();
    const a = device(store, 'A');
    await a.db.business.put({ ...biz });
    await invoice(a.db);
    await a.sync();

    const c = device(store, 'C');
    await c.db.business.put({ ...biz, name: 'Other shop' });
    await invoice(c.db, 999);
    const r = await c.sync();
    assert.equal(r.status, 'conflict');
    assert.equal(r.status === 'conflict' && r.remote.docs, 1);
    assert.equal(r.status === 'conflict' && r.local.businessName, 'Other shop');
    assert.equal(await c.db.docs.count(), 1); // nothing changed yet
    assert.equal(store.files.size, 1);

    await c.sync('cloud');
    assert.equal((await c.db.business.get(1))?.name, 'Acme Traders');
    assert.equal((await c.db.docs.toArray())[0].totals.total, 118); // A's invoice, not C's 999
    assert.equal(await c.db.docs.count(), 1);
  });

  await t('"keep this device" replaces the cloud; other devices must then choose', async () => {
    const store = new MemStore();
    const a = device(store, 'A');
    await a.db.business.put({ ...biz });
    await invoice(a.db);
    await a.sync();
    const b = device(store, 'B');
    await b.sync();

    const c = device(store, 'C');
    await c.db.business.put({ ...biz, name: 'Fresh shop' });
    await invoice(c.db, 500);
    await invoice(c.db, 600);
    assert.equal((await c.sync()).status, 'conflict');
    const r = await c.sync('local');
    assert.equal(r.status, 'ok');
    assert.equal(store.files.size, 1);

    const ra = await a.sync();
    assert.equal(ra.status, 'conflict');
    assert.equal(ra.status === 'conflict' && ra.reason, 'reset');
    assert.equal(await a.db.docs.count(), 1); // untouched until the user chooses
    await a.sync('cloud');
    assert.equal(await a.db.docs.count(), 2);
    assert.equal((await a.db.business.get(1))?.name, 'Fresh shop');
    // B was removed from the cloud too, and learns about the reset
    assert.equal((await b.sync()).status, 'conflict');
  });

  await t('deleting the cloud copy unlinks the other devices instead of recreating it', async () => {
    const store = new MemStore();
    const a = device(store, 'A');
    await a.db.business.put({ ...biz });
    await a.sync();
    const b = device(store, 'B');
    await b.sync();
    assert.equal(await deleteCloudCopy(a.ctx), 2);
    assert.equal(store.files.size, 0);
    const r = await b.sync();
    assert.equal(r.status, 'unlinked');
    assert.equal(store.files.size, 0);
    // the data stays on the device, and sync can be started again later
    assert.equal((await b.db.business.get(1))?.name, 'Acme Traders');
    assert.equal((await b.sync()).status, 'ok');
    assert.equal(store.files.size, 1);
  });

  await t('"delete all billing data" clears documents and numbering everywhere', async () => {
    const store = new MemStore();
    const a = device(store, 'A');
    await a.db.business.put({ ...biz });
    await invoice(a.db);
    await invoice(a.db);
    await a.sync();
    const b = device(store, 'B');
    await b.sync();
    assert.equal(await b.db.docs.count(), 2);

    await deleteAllBillingData(a.db);
    await a.sync();
    await b.sync();
    assert.equal(await b.db.docs.count(), 0);
    assert.equal(await b.db.counters.count(), 0);
    const fresh = await invoice(b.db);
    assert.ok(fresh.number.endsWith('0001'), fresh.number);
  });

  await t('restoring a backup replaces data on the other device as well', async () => {
    const store = new MemStore();
    const a = device(store, 'A');
    await a.db.business.put({ ...biz });
    await addCustomer(a.db, 'Old customer');
    await a.sync();
    const b = device(store, 'B');
    await b.sync();

    // a backup taken elsewhere, with a different customer list and an invoice
    const other = device(new MemStore(), 'X');
    await other.db.business.put({ ...biz });
    await other.db.customers.add({ id: 7, name: 'Restored customer', gstin: '', address: '', stateCode: '27', phone: '', email: '', createdAt: 1 });
    await invoice(other.db, 300);
    const backup = await exportBackup(other.db);

    await wait(5);
    await importBackup(backup, b.db);
    await b.sync();
    await a.sync();
    assert.deepEqual((await a.db.customers.toArray()).map((c) => c.name), ['Restored customer']);
    assert.equal(await a.db.docs.count(), 1);
    // and A's next sync must not bring the old customer back
    await a.sync();
    await b.sync();
    assert.equal(await b.db.customers.count(), 1);
  });

  await t('a damaged file from another device is skipped, not fatal', async () => {
    const store = new MemStore();
    const a = device(store, 'A');
    await a.db.business.put({ ...biz });
    await a.sync();
    const b = device(store, 'B');
    await b.sync();
    const bad = [...store.files.values()].find((x) => x.file.deviceName === 'B');
    assert.ok(bad);
    bad.body = new TextEncoder().encode('not json');
    bad.file = { ...bad.file, version: 'broken' };
    const r = await a.sync();
    assert.equal(r.status, 'ok');
    assert.deepEqual(r.status === 'ok' && r.skipped, ['B']);
  });

  console.log(`\n${passed} sync tests passed`);
})();
