/**
 * Sync engine: keeps several devices in step through a dumb file store (Google Drive).
 *
 * How it works
 *  - Every device owns exactly ONE file in the store (`atombook-<deviceId>.sync`) and only
 *    ever writes that file. There are no write conflicts and no server logic.
 *  - A file is a full snapshot of that device's data plus a list of deletions (tombstones).
 *  - To sync, a device downloads the files of the OTHER devices that changed since last time,
 *    merges them into its own database, then uploads its own snapshot if it changed.
 *  - Merge rule: per record, the newest `updatedAt` wins. A deletion wins over a record that
 *    was last changed before the deletion.
 *  - All devices that sync with each other share one `lineage` id. Ids created before sync
 *    existed (1, 2, 3 ...) are only safe inside one lineage, so a device with its own data can
 *    only join an existing lineage by replacing its data, or start a new lineage and replace
 *    the cloud copy. That choice is returned to the caller as a `conflict`.
 *
 * Nothing here touches the network or the browser directly: the file store is passed in, so
 * the whole thing runs (and is tested) against an in-memory store.
 */
import {
  type BillDB,
  type Counter,
  type SyncTable,
  SYNC_SOURCE,
  SYNC_TABLES,
  type Tombstone,
  formatNumber,
  loadBusiness,
} from '../db';
import type { Business, Customer, DesignConfig, Doc, Item } from '../types';

/* ---------------- file store contract ---------------- */

export interface RemoteFile {
  id: string;
  name: string;
  /** Changes whenever the content changes (Drive md5Checksum). */
  version: string;
  modifiedTime?: string;
  deviceId?: string;
  deviceName?: string;
  lineage?: string;
}

export interface RemoteProps {
  deviceId: string;
  deviceName: string;
  lineage: string;
}

export interface RemoteStore {
  list(): Promise<RemoteFile[]>;
  read(file: RemoteFile): Promise<Uint8Array>;
  create(name: string, body: Uint8Array, props: RemoteProps): Promise<RemoteFile>;
  update(id: string, body: Uint8Array, props: RemoteProps): Promise<RemoteFile>;
  remove(id: string): Promise<void>;
}

/* ---------------- snapshot ---------------- */

export interface Snapshot {
  app: 'atombook-sync';
  version: 1;
  lineage: string;
  deviceId: string;
  deviceName: string;
  writtenAt: number;
  business: Business | null;
  design: DesignConfig | null;
  customers: Customer[];
  items: Item[];
  docs: Doc[];
  counters: Counter[];
  tombstones: Tombstone[];
}

export interface Summary {
  businessName: string;
  docs: number;
  customers: number;
  items: number;
  /** When the other device last wrote its copy (ms since epoch). 0 for the local summary. */
  writtenAt: number;
  deviceName: string;
}

type AnyRec = { id?: number | string; key?: string; updatedAt?: number; createdAt?: number };

const stampOf = (r: AnyRec): number => r.updatedAt ?? r.createdAt ?? 0;
const keyOf = (table: SyncTable, r: AnyRec): number | string => (table === 'counters' ? (r.key as string) : (r.id as number));
const tkey = (table: string, id: number | string) => `${table}|${String(id)}`;

function recordsOf(snap: Snapshot, table: SyncTable): AnyRec[] {
  switch (table) {
    case 'business':
      return snap.business ? [snap.business] : [];
    case 'design':
      return snap.design ? [snap.design] : [];
    default:
      return snap[table] as AnyRec[];
  }
}

const tables = (d: BillDB) => SYNC_TABLES.map((n) => d.table(n));

export async function buildSnapshot(
  d: BillDB,
  who: { lineage: string; deviceId: string; deviceName: string },
  now = Date.now(),
): Promise<Snapshot> {
  return d.transaction('r', [...tables(d), d.tombstones], async () => {
    const [business, design, customers, items, docs, counters, tombstones] = await Promise.all([
      d.business.get(1),
      d.design.get(1),
      d.customers.toArray(),
      d.items.toArray(),
      d.docs.toArray(),
      d.counters.toArray(),
      d.tombstones.toArray(),
    ]);
    return {
      app: 'atombook-sync' as const,
      version: 1 as const,
      lineage: who.lineage,
      deviceId: who.deviceId,
      deviceName: who.deviceName,
      writtenAt: now,
      business: business ?? null,
      design: design ?? null,
      customers,
      items,
      docs,
      counters,
      tombstones,
    };
  });
}

/** Content hash that ignores the volatile header fields, used to skip pointless uploads. */
export async function snapshotHash(s: Snapshot): Promise<string> {
  const body = JSON.stringify([s.lineage, s.business, s.design, s.customers, s.items, s.docs, s.counters, s.tombstones]);
  const bytes = new TextEncoder().encode(body);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------- (de)serialisation ---------------- */

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeSnapshot(s: Snapshot): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(JSON.stringify(s));
  if (typeof CompressionStream === 'undefined') return raw;
  return pipe(raw, new CompressionStream('gzip'));
}

export async function decodeSnapshot(bytes: Uint8Array): Promise<Snapshot> {
  let raw = bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read the compressed sync file.');
    raw = await pipe(bytes, new DecompressionStream('gzip'));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error('A sync file in Google Drive is damaged.');
  }
  const s = parsed as Partial<Snapshot> | null;
  if (!s || s.app !== 'atombook-sync') throw new Error('A file in Google Drive is not an AtomBook sync file.');
  if (s.version !== 1) throw new Error('A sync file was written by a newer version of AtomBook. Please update this app.');
  if (typeof s.lineage !== 'string' || typeof s.deviceId !== 'string') throw new Error('A sync file is missing its header.');
  for (const k of ['customers', 'items', 'docs', 'counters', 'tombstones'] as const) {
    if (!Array.isArray(s[k])) throw new Error(`A sync file is incomplete (${k}).`);
  }
  return s as Snapshot;
}

/* ---------------- local sync state ---------------- */

async function getMeta<T>(d: BillDB, key: string): Promise<T | undefined> {
  return (await d.meta.get(key))?.value as T | undefined;
}
async function setMeta(d: BillDB, key: string, value: unknown): Promise<void> {
  await d.meta.put({ key, value });
}
async function delMeta(d: BillDB, key: string): Promise<void> {
  await d.meta.delete(key);
}

export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getDeviceId(d: BillDB): Promise<string> {
  let id = await getMeta<string>(d, 'deviceId');
  if (!id) {
    id = randomId();
    await setMeta(d, 'deviceId', id);
  }
  return id;
}

export async function getSyncInfo(d: BillDB) {
  const [lineage, lastSyncAt, ownFileId] = await Promise.all([
    getMeta<string>(d, 'lineage'),
    getMeta<number>(d, 'lastSyncAt'),
    getMeta<string>(d, 'ownFileId'),
  ]);
  return { lineage, lastSyncAt, ownFileId };
}

/** Forget everything about the cloud copy (keeps the device id and all local data). */
export async function resetSyncState(d: BillDB): Promise<void> {
  await Promise.all(['lineage', 'ownFileId', 'seen', 'lastUploadHash', 'lastSyncAt'].map((k) => delMeta(d, k)));
}

/* ---------------- local data helpers ---------------- */

export async function summarizeLocal(d: BillDB): Promise<Summary> {
  const [business, docs, customers, items] = await Promise.all([d.business.get(1), d.docs.count(), d.customers.count(), d.items.count()]);
  return { businessName: business?.name ?? '', docs, customers, items, writtenAt: 0, deviceName: '' };
}

export function summarizeSnapshot(s: Snapshot): Summary {
  return {
    businessName: s.business?.name ?? '',
    docs: s.docs.length,
    customers: s.customers.length,
    items: s.items.length,
    writtenAt: s.writtenAt,
    deviceName: s.deviceName,
  };
}

/** A device that was never used (or only just installed) has nothing worth protecting. */
export function isPristine(s: Summary): boolean {
  return s.docs === 0 && s.customers === 0 && s.items === 0 && !s.businessName.trim();
}

/** Records written before sync existed have no `updatedAt`. Give them one, once. */
async function stampLegacyRecords(d: BillDB): Promise<void> {
  if (await getMeta<boolean>(d, 'stamped')) return;
  await d.transaction('rw', [...tables(d), d.meta], async (tx) => {
    (tx as unknown as { source: string }).source = SYNC_SOURCE;
    const now = Date.now();
    for (const t of tables(d)) {
      const rows = (await t.toArray()) as AnyRec[];
      const missing = rows.filter((r) => r.updatedAt == null).map((r) => ({ ...r, updatedAt: r.createdAt ?? now }));
      if (missing.length) await t.bulkPut(missing);
    }
    await setMeta(d, 'stamped', true);
  });
}

/* ---------------- merge ---------------- */

export interface MergeStats {
  added: number;
  updated: number;
  removed: number;
}

/**
 * Merge remote snapshots into the local database (one atomic transaction).
 * With `replace`, the local data is discarded first, i.e. the remote data wins entirely.
 */
export async function applyMerge(d: BillDB, remotes: Snapshot[], opts: { replace?: boolean } = {}): Promise<MergeStats> {
  const stats: MergeStats = { added: 0, updated: 0, removed: 0 };
  await d.transaction('rw', [...tables(d), d.tombstones], async (tx) => {
    (tx as unknown as { source: string }).source = SYNC_SOURCE;
    if (opts.replace) {
      await Promise.all([...tables(d).map((t) => t.clear()), d.tombstones.clear()]);
    }

    // newest deletion per record
    const tombs = new Map<string, number>();
    const tombIds = new Map<string, number | string>();
    const tombRows = new Map<string, Tombstone>();
    const noteTomb = (t: Tombstone) => {
      const k = tkey(t.table, t.id);
      tombIds.set(k, t.id);
      if ((tombs.get(k) ?? -1) < t.deletedAt) tombs.set(k, t.deletedAt);
    };
    const localTombs = await d.tombstones.toArray();
    for (const t of localTombs) {
      tombRows.set(tkey(t.table, t.id), t);
      noteTomb(t);
    }
    for (const s of remotes) for (const t of s.tombstones) noteTomb(t);

    for (const name of SYNC_TABLES) {
      const table = d.table(name);
      const local = new Map<string, AnyRec>();
      for (const r of (await table.toArray()) as AnyRec[]) local.set(tkey(name, keyOf(name, r)), r);

      // pick the newest version of every record
      const best = new Map<string, { rec: AnyRec; remote: boolean }>();
      for (const [k, rec] of local) best.set(k, { rec, remote: false });
      for (const s of remotes) {
        for (const rec of recordsOf(s, name)) {
          const k = tkey(name, keyOf(name, rec));
          const cur = best.get(k);
          if (!cur) {
            best.set(k, { rec, remote: true });
            continue;
          }
          const a = stampOf(rec);
          const b = stampOf(cur.rec);
          // equal timestamps with different content: every device picks the same winner
          if (a > b || (a === b && JSON.stringify(rec) > JSON.stringify(cur.rec))) best.set(k, { rec, remote: true });
        }
      }

      const puts: AnyRec[] = [];
      const deletes: (number | string)[] = [];
      const tombPuts: Tombstone[] = [];
      const tombDeletes: [string, number | string][] = [];

      const keys = new Set<string>([...best.keys()]);
      for (const k of tombs.keys()) if (k.startsWith(`${name}|`)) keys.add(k);

      for (const k of keys) {
        const b = best.get(k);
        const t = tombs.get(k);
        if (b && !(t !== undefined && t >= stampOf(b.rec))) {
          // the record is alive
          if (b.remote) {
            puts.push(b.rec);
            if (local.has(k)) stats.updated++;
            else stats.added++;
          }
          const row = tombRows.get(k);
          if (row) tombDeletes.push([row.table, row.id]);
        } else if (t !== undefined) {
          // the record was deleted
          const id = tombIds.get(k) as number | string;
          if (local.has(k)) {
            deletes.push(keyOf(name, local.get(k) as AnyRec));
            stats.removed++;
          }
          const row = tombRows.get(k);
          if (!row || row.deletedAt < t) tombPuts.push({ table: name, id, deletedAt: t });
        }
      }

      if (puts.length) await table.bulkPut(puts);
      if (deletes.length) await table.bulkDelete(deletes);
      if (tombPuts.length) await d.tombstones.bulkPut(tombPuts);
      if (tombDeletes.length) await d.tombstones.bulkDelete(tombDeletes);
    }
  });
  await reconcileCounters(d);
  return stats;
}

/** A counter must never be behind the highest number already used by a document. */
export async function reconcileCounters(d: BillDB): Promise<void> {
  await d.transaction('rw', [d.docs, d.counters], async (tx) => {
    (tx as unknown as { source: string }).source = SYNC_SOURCE;
    const highest = new Map<string, number>();
    await d.docs.each((doc) => {
      const k = `${doc.type}:${doc.fy}`;
      highest.set(k, Math.max(highest.get(k) ?? 0, doc.seq));
    });
    const now = Date.now();
    const fix: Counter[] = [];
    for (const [key, seq] of highest) {
      const c = await d.counters.get(key);
      if (!c) fix.push({ key, last: seq, updatedAt: now });
      else if (c.last < seq) fix.push({ ...c, last: seq });
    }
    if (fix.length) await d.counters.bulkPut(fix);
  });
}

export interface Renumbered {
  type: Doc['type'];
  from: string;
  to: string;
}

/**
 * Two devices that were offline can each have issued the same number. GST needs unique
 * numbers, so the document that was created later gets the next free number.
 * This is a normal (stamped) write, so the change travels to the other devices too.
 */
export async function resolveDuplicateNumbers(d: BillDB): Promise<Renumbered[]> {
  const business = await loadBusiness(d);
  const changes: Renumbered[] = [];
  await d.transaction('rw', [d.docs, d.counters], async () => {
    const docs = await d.docs.toArray();
    const groups = new Map<string, Doc[]>();
    for (const doc of docs) {
      const k = `${doc.type}|${doc.number}`;
      groups.set(k, [...(groups.get(k) ?? []), doc]);
    }
    const dupes = [...groups.values()].filter((g) => g.length > 1);
    if (!dupes.length) return;

    const highest = new Map<string, number>();
    for (const doc of docs) {
      const k = `${doc.type}:${doc.fy}`;
      highest.set(k, Math.max(highest.get(k) ?? 0, doc.seq));
    }
    const renamed = new Map<string, { old: string; next: string; date: string }>();
    for (const group of dupes) {
      group.sort((a, b) => a.createdAt - b.createdAt || (a.id as number) - (b.id as number));
      for (const doc of group.slice(1)) {
        const key = `${doc.type}:${doc.fy}`;
        const counter = await d.counters.get(key);
        const seq = Math.max(highest.get(key) ?? 0, counter?.last ?? 0) + 1;
        highest.set(key, seq);
        const number = formatNumber(business.numbering[doc.type], doc.fy, seq);
        await d.docs.put({ ...doc, seq, number });
        await d.counters.put({ key, last: seq });
        renamed.set(`${doc.type}|${doc.number}|${doc.id}`, { old: doc.number, next: number, date: doc.date });
        changes.push({ type: doc.type, from: doc.number, to: number });
      }
    }
    // credit / debit notes point at the invoice number they refer to
    if (renamed.size) {
      for (const doc of docs) {
        if (!doc.refNumber) continue;
        for (const r of renamed.values()) {
          if (doc.refNumber === r.old && doc.refDate === r.date) {
            await d.docs.update(doc.id as number, { refNumber: r.next });
            break;
          }
        }
      }
    }
  });
  return changes;
}

/* ---------------- the sync run ---------------- */

export interface SyncContext {
  db: BillDB;
  store: RemoteStore;
  deviceName: string;
}

export type SyncResult =
  | {
      status: 'ok';
      merged: MergeStats;
      uploaded: boolean;
      renumbered: Renumbered[];
      skipped: string[];
      /** true when this run created a brand-new cloud copy */
      started: boolean;
    }
  | { status: 'conflict'; reason: 'first' | 'reset'; local: Summary; remote: Summary }
  | { status: 'unlinked' };

export type Resolution = 'cloud' | 'local';

const FILE_PREFIX = 'atombook-';
export const isSyncFile = (f: RemoteFile) => f.name.startsWith(FILE_PREFIX) && f.name.endsWith('.sync');

async function download(store: RemoteStore, file: RemoteFile): Promise<Snapshot> {
  return decodeSnapshot(await store.read(file));
}

function newestLineage(files: RemoteFile[]): string | undefined {
  const latest = new Map<string, number>();
  for (const f of files) {
    if (!f.lineage) continue;
    const t = f.modifiedTime ? Date.parse(f.modifiedTime) : 0;
    latest.set(f.lineage, Math.max(latest.get(f.lineage) ?? 0, t));
  }
  let best: string | undefined;
  let bestT = -1;
  for (const [l, t] of latest) {
    if (t > bestT) {
      best = l;
      bestT = t;
    }
  }
  return best;
}

export async function runSync(ctx: SyncContext, resolve?: Resolution): Promise<SyncResult> {
  const { db: d, store } = ctx;
  const deviceId = await getDeviceId(d);
  await stampLegacyRecords(d);

  const files = (await store.list()).filter(isSyncFile);
  let lineage = await getMeta<string>(d, 'lineage');
  let ownFileId = await getMeta<string>(d, 'ownFileId');
  let started = false;
  let merged: MergeStats = { added: 0, updated: 0, removed: 0 };
  const skipped: string[] = [];

  /* ---- decide which lineage this device belongs to ---- */
  const inLineage = (l: string | undefined) => files.filter((f) => f.lineage === l);

  if (lineage && inLineage(lineage).length === 0) {
    const foreign = files.filter((f) => f.lineage);
    if (foreign.length === 0) {
      if (ownFileId) {
        // we had a cloud copy and it is gone: someone deleted it on purpose
        await resetSyncState(d);
        return { status: 'unlinked' };
      }
      // linked but never uploaded: carry on, the upload below creates it
    } else {
      // the cloud copy was replaced by another device
      lineage = undefined;
      await resetSyncState(d);
      ownFileId = undefined;
      if (!resolve) {
        return await conflictFor(ctx, files, 'reset');
      }
    }
  }

  if (!lineage) {
    const target = newestLineage(files);
    const local = await summarizeLocal(d);
    if (target) {
      const remoteFiles = inLineage(target);
      const snaps = await Promise.all(remoteFiles.map((f) => download(store, f)));
      const remoteSummary = summarizeSnapshot(newestSnapshot(snaps));
      const choice: Resolution | undefined = isPristine(local) ? 'cloud' : resolve;
      if (!choice) return { status: 'conflict', reason: 'first', local, remote: remoteSummary };

      if (choice === 'cloud') {
        merged = await applyMerge(d, snaps, { replace: true });
        lineage = target;
        const seen: Record<string, string> = {};
        for (const f of remoteFiles) seen[f.id] = f.version;
        await setMeta(d, 'seen', seen);
        await setMeta(d, 'lineage', lineage);
        const mine = remoteFiles.find((f) => f.deviceId === deviceId);
        if (mine) {
          ownFileId = mine.id;
          await setMeta(d, 'ownFileId', ownFileId);
        }
        await delMeta(d, 'lastUploadHash');
      } else {
        // keep this device's data, replace the cloud copy
        lineage = randomId();
        await setMeta(d, 'lineage', lineage);
        await delMeta(d, 'seen');
        await delMeta(d, 'lastUploadHash');
        await delMeta(d, 'ownFileId');
        ownFileId = undefined;
        started = true;
        // upload ours first, then remove the old copies, so the cloud is never empty
        await uploadOwn(ctx, deviceId, lineage, undefined);
        for (const f of files) await safeRemove(store, f.id);
        await setMeta(d, 'lastSyncAt', Date.now());
        return { status: 'ok', merged, uploaded: true, renumbered: [], skipped, started };
      }
    } else {
      // nothing in the cloud yet: this device starts the lineage
      lineage = randomId();
      await setMeta(d, 'lineage', lineage);
      started = true;
    }
  } else {
    /* ---- normal incremental merge ---- */
    const seen = (await getMeta<Record<string, string>>(d, 'seen')) ?? {};
    const changed = inLineage(lineage).filter((f) => f.deviceId !== deviceId && seen[f.id] !== f.version);
    const snaps: Snapshot[] = [];
    const nextSeen = { ...seen };
    for (const f of changed) {
      try {
        snaps.push(await download(store, f));
        nextSeen[f.id] = f.version;
      } catch (e) {
        if ((e as Error).message.includes('newer version')) throw e;
        skipped.push(f.deviceName || f.name);
      }
    }
    if (snaps.length) merged = await applyMerge(d, snaps);
    // forget files that no longer exist
    const live = new Set(files.map((f) => f.id));
    for (const k of Object.keys(nextSeen)) if (!live.has(k)) delete nextSeen[k];
    await setMeta(d, 'seen', nextSeen);
  }

  /* ---- duplicates, then upload ---- */
  const renumbered = await resolveDuplicateNumbers(d);
  const uploaded = await uploadOwn(ctx, deviceId, lineage as string, ownFileId, files);
  await setMeta(d, 'lastSyncAt', Date.now());
  return { status: 'ok', merged, uploaded, renumbered, skipped, started };
}

function newestSnapshot(snaps: Snapshot[]): Snapshot {
  return snaps.reduce((a, b) => (b.writtenAt > a.writtenAt ? b : a));
}

async function conflictFor(ctx: SyncContext, files: RemoteFile[], reason: 'first' | 'reset'): Promise<SyncResult> {
  const target = newestLineage(files);
  const remoteFiles = files.filter((f) => f.lineage === target);
  const snaps = await Promise.all(remoteFiles.map((f) => download(ctx.store, f)));
  return { status: 'conflict', reason, local: await summarizeLocal(ctx.db), remote: summarizeSnapshot(newestSnapshot(snaps)) };
}

async function safeRemove(store: RemoteStore, id: string): Promise<void> {
  try {
    await store.remove(id);
  } catch {
    /* best effort: a leftover file of an old lineage is ignored by every device */
  }
}

/** Upload this device's snapshot if it changed. Returns true when something was written. */
async function uploadOwn(ctx: SyncContext, deviceId: string, lineage: string, ownFileId: string | undefined, files?: RemoteFile[]): Promise<boolean> {
  const { db: d, store } = ctx;
  const snap = await buildSnapshot(d, { lineage, deviceId, deviceName: ctx.deviceName });
  const hash = await snapshotHash(snap);
  const lastHash = await getMeta<string>(d, 'lastUploadHash');
  const existing = files?.find((f) => f.deviceId === deviceId && f.lineage === lineage);
  const id = ownFileId ?? existing?.id;
  if (id && existing && hash === lastHash) return false;

  const body = await encodeSnapshot(snap);
  const props: RemoteProps = { deviceId, deviceName: ctx.deviceName, lineage };
  let file: RemoteFile;
  if (id && existing) file = await store.update(id, body, props);
  else file = await store.create(`${FILE_PREFIX}${deviceId}.sync`, body, props);
  await setMeta(d, 'ownFileId', file.id);
  await setMeta(d, 'lastUploadHash', hash);
  return true;
}

/** Remove every AtomBook sync file from the cloud and forget the link on this device. */
export async function deleteCloudCopy(ctx: SyncContext): Promise<number> {
  const files = (await ctx.store.list()).filter(isSyncFile);
  for (const f of files) await ctx.store.remove(f.id);
  await resetSyncState(ctx.db);
  return files.length;
}
