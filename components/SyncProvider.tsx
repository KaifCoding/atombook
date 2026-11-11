'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, toast } from '@/components/ui';
import { db, exportBackup, onLocalChange } from '@/lib/db';
import { saveJson } from '@/lib/files';
import { todayStr } from '@/lib/gst';
import { AuthRequiredError, DriveStore, NetworkError } from '@/lib/sync/drive';
import { deleteCloudCopy, type Resolution, runSync, type Summary } from '@/lib/sync/engine';
import { clientIdFromBuild, getClientId, GoogleAuth, setClientId as storeClientId } from '@/lib/sync/google';

export type SyncPhase =
  | 'unsupported' // native app shells / insecure origins: no Google sign-in there
  | 'unconfigured' // no Google OAuth client id yet
  | 'off'
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'needs-auth'
  | 'error'
  | 'conflict';

interface Conflict {
  reason: 'first' | 'reset';
  local: Summary;
  remote: Summary;
}

interface SyncApi {
  phase: SyncPhase;
  error: string;
  account: string;
  lastSyncAt: number | undefined;
  clientId: string;
  clientIdFromBuild: boolean;
  /** Sign in (must be called from a click) and start syncing. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  syncNow(): Promise<void>;
  /** Best effort: fetch other devices' changes before doing something that uses numbering. */
  pullLatest(timeoutMs?: number): Promise<void>;
  deleteCloud(): Promise<void>;
  saveClientId(id: string): void;
}

const Ctx = createContext<SyncApi | null>(null);

export function useSync(): SyncApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSync must be used inside <SyncProvider>');
  return v;
}

const LS_ENABLED = 'atombook.sync.enabled';
const LS_ACCOUNT = 'atombook.sync.account';

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string | null) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

/** Google sign-in only works from a real web origin, not inside the Android / desktop shells. */
function environmentSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (!/^https?:$/.test(location.protocol)) return false; // Electron app://, file://
  if (!window.isSecureContext) return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !cap?.isNativePlatform?.();
}

function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${os}`;
}

const describe = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong while syncing.');

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [supported, setSupported] = useState(true); // corrected after mount; keeps the static HTML and first render identical
  const [clientId, setClientIdState] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<SyncPhase>('off');
  const [error, setError] = useState('');
  const [account, setAccount] = useState('');
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [busy, setBusy] = useState(false);

  const lastSyncAt = useLiveQuery(async () => (await db.meta.get('lastSyncAt'))?.value as number | undefined, []);

  const authRef = useRef<GoogleAuth | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const authFailed = useRef(false);
  const dirtyDuringRun = useRef(false);
  const running = useRef(false);
  const phaseRef = useRef<SyncPhase>('off');
  phaseRef.current = phase;
  const enabledRef = useRef(false);
  enabledRef.current = enabled;

  /* ---------- environment ---------- */
  useEffect(() => {
    const ok = environmentSupported();
    setSupported(ok);
    const id = getClientId();
    setClientIdState(id);
    setAccount(lsGet(LS_ACCOUNT) || '');
    if (!ok) return setPhase('unsupported');
    if (!id) return setPhase('unconfigured');
    authRef.current = new GoogleAuth(id);
    if (lsGet(LS_ENABLED) === '1') {
      setEnabled(true);
      setPhase('idle');
    } else setPhase('off');
  }, []);

  const store = useCallback(() => {
    const auth = authRef.current;
    if (!auth) throw new AuthRequiredError();
    return new DriveStore((force) => auth.getToken({ force }));
  }, []);

  /* ---------- one sync run (serialised) ---------- */
  const executeRef = useRef<(resolve?: Resolution, opts?: { quiet?: boolean }) => Promise<void>>(async () => undefined);
  const execute = useCallback(
    async (resolve?: Resolution, opts: { quiet?: boolean } = {}): Promise<void> => {
      const job = async () => {
        if (!enabledRef.current || !authRef.current) return;
        running.current = true;
        dirtyDuringRun.current = false;
        setPhase('syncing');
        setError('');
        try {
          const s = store();
          const res = await runSync({ db, store: s, deviceName: deviceName() }, resolve);
          if (res.status === 'conflict') {
            setConflict({ reason: res.reason, local: res.local, remote: res.remote });
            setPhase('conflict');
            return;
          }
          setConflict(null);
          if (res.status === 'unlinked') {
            enabledRef.current = false;
            setEnabled(false);
            lsSet(LS_ENABLED, null);
            setPhase('off');
            toast('The Google Drive copy was deleted from another device, so sync was turned off here. Your data on this device is safe.');
            return;
          }
          authFailed.current = false;
          setPhase('idle');
          if (res.renumbered.length) {
            toast(
              `${res.renumbered.length} document(s) used a number that another device had already issued and were renumbered: ${res.renumbered
                .map((r) => `${r.from} → ${r.to}`)
                .join(', ')}`,
            );
          }
          if (res.skipped.length) toast(`Skipped an unreadable sync file from ${res.skipped.join(', ')}.`, 'error');
          if (!account) {
            const a = await s.account();
            if (a?.email) {
              setAccount(a.email);
              lsSet(LS_ACCOUNT, a.email);
            }
          }
          if (!opts.quiet) toast('Synced with Google Drive');
        } catch (e) {
          if (e instanceof AuthRequiredError) {
            authFailed.current = true;
            setPhase('needs-auth');
            setError(e.message);
          } else if (e instanceof NetworkError || (typeof navigator !== 'undefined' && !navigator.onLine)) {
            setPhase('offline');
            setError('');
          } else {
            setPhase('error');
            setError(describe(e));
          }
        } finally {
          running.current = false;
        }
      };
      const next = chain.current.then(job, job);
      chain.current = next.catch(() => undefined);
      await next;
      // edits made while we were syncing still need to go up
      if (dirtyDuringRun.current && enabledRef.current && phaseRef.current === 'idle') {
        dirtyDuringRun.current = false;
        void executeRef.current(undefined, { quiet: true });
      }
    },
    [store, account],
  );
  executeRef.current = execute;

  /** For timers and events: never shows a sign-in window and stays quiet when nothing is wrong. */
  const auto = useCallback(async () => {
    if (!enabledRef.current || authFailed.current) return;
    if (phaseRef.current === 'conflict' || phaseRef.current === 'unsupported') return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    await execute(undefined, { quiet: true });
  }, [execute]);

  /* ---------- automatic triggers ---------- */
  useEffect(() => {
    if (!enabled) return;
    void auto();
    const onVisible = () => document.visibilityState === 'visible' && void auto();
    const onOnline = () => void auto();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const timer = setInterval(() => document.visibilityState === 'visible' && void auto(), 60_000);
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const off = onLocalChange(() => {
      if (running.current) dirtyDuringRun.current = true;
      clearTimeout(debounce);
      debounce = setTimeout(() => void auto(), 3000);
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
      clearTimeout(debounce);
      off();
    };
  }, [enabled, auto]);

  /* ---------- public actions ---------- */
  const connect = useCallback(async () => {
    const auth = authRef.current;
    if (!auth) return;
    setError('');
    try {
      await auth.getToken({ interactive: true, force: true });
    } catch (e) {
      setPhase(enabledRef.current ? 'needs-auth' : 'off');
      setError(describe(e));
      toast(describe(e), 'error');
      return;
    }
    authFailed.current = false;
    enabledRef.current = true;
    setEnabled(true);
    lsSet(LS_ENABLED, '1');
    await execute(undefined, { quiet: false });
  }, [execute]);

  const syncNow = useCallback(async () => {
    if (authFailed.current || phaseRef.current === 'needs-auth') return connect();
    await execute(undefined, { quiet: false }); // in a conflict this simply shows the choice again
  }, [connect, execute]);

  const disconnect = useCallback(async () => {
    await authRef.current?.signOut();
    enabledRef.current = false;
    setEnabled(false);
    lsSet(LS_ENABLED, null);
    lsSet(LS_ACCOUNT, null);
    setAccount('');
    setConflict(null);
    setError('');
    setPhase('off');
  }, []);

  const deleteCloud = useCallback(async () => {
    setBusy(true);
    try {
      const n = await deleteCloudCopy({ db, store: store(), deviceName: deviceName() });
      toast(`Deleted the Google Drive copy (${n} file${n === 1 ? '' : 's'}). Data on your devices is untouched.`);
      await disconnect();
    } catch (e) {
      toast(describe(e), 'error');
    } finally {
      setBusy(false);
    }
  }, [store, disconnect]);

  const pullLatest = useCallback(
    async (timeoutMs = 4000) => {
      if (!enabledRef.current || authFailed.current || phaseRef.current === 'conflict') return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      await Promise.race([execute(undefined, { quiet: true }), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
    },
    [execute],
  );

  const saveClientId = useCallback((id: string) => {
    storeClientId(id);
    const v = getClientId();
    setClientIdState(v);
    authRef.current = v ? new GoogleAuth(v) : null;
    setPhase(v ? 'off' : 'unconfigured');
  }, []);

  const resolve = async (choice: Resolution) => {
    const msg =
      choice === 'cloud'
        ? 'Replace ALL data on this device with the Google Drive copy?'
        : 'Replace the Google Drive copy with the data on this device? Other devices will be asked to switch to it.';
    if (!window.confirm(msg)) return;
    setBusy(true);
    setConflict(null);
    try {
      await execute(choice, { quiet: false });
    } finally {
      setBusy(false);
    }
  };

  const api = useMemo<SyncApi>(
    () => ({
      phase: supported ? phase : 'unsupported',
      error,
      account,
      lastSyncAt,
      clientId,
      clientIdFromBuild: clientIdFromBuild(),
      connect,
      disconnect,
      syncNow,
      pullLatest,
      deleteCloud,
      saveClientId,
    }),
    [supported, phase, error, account, lastSyncAt, clientId, connect, disconnect, syncNow, pullLatest, deleteCloud, saveClientId],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {conflict && <ConflictDialog conflict={conflict} busy={busy} onResolve={resolve} onLater={() => setConflict(null)} />}
    </Ctx.Provider>
  );
}

/* ---------------- "which copy do you want?" ---------------- */

function SummaryLine({ title, s, extra }: { title: string; s: Summary; extra?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</div>
      <div className="mt-1 font-medium">{s.businessName || 'No business name yet'}</div>
      <div className="text-gray-600">
        {s.docs} document{s.docs === 1 ? '' : 's'} · {s.customers} customer{s.customers === 1 ? '' : 's'} · {s.items} item{s.items === 1 ? '' : 's'}
      </div>
      {extra && <div className="mt-0.5 text-xs text-gray-500">{extra}</div>}
    </div>
  );
}

function ConflictDialog({
  conflict,
  busy,
  onResolve,
  onLater,
}: {
  conflict: Conflict;
  busy: boolean;
  onResolve: (c: Resolution) => void;
  onLater: () => void;
}) {
  const { local, remote, reason } = conflict;
  const when = remote.writtenAt ? new Date(remote.writtenAt).toLocaleString() : '';
  return (
    <Modal title={reason === 'reset' ? 'Google Drive data was replaced' : 'Choose which data to keep'} onClose={onLater}>
      <p className="text-sm text-gray-600">
        {reason === 'reset'
          ? 'Another device started a new copy in Google Drive. Pick which data this device should continue with.'
          : 'Google Drive already has AtomBook data, and this device has its own data too. Two separate sets cannot be merged safely (document numbers would clash), so pick one.'}
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <SummaryLine title="Google Drive" s={remote} extra={when ? `Last updated ${when}${remote.deviceName ? ` from ${remote.deviceName}` : ''}` : undefined} />
        <SummaryLine title="This device" s={local} />
      </div>
      <div className="mt-4 space-y-2">
        <button className="btn-primary w-full" disabled={busy} onClick={() => onResolve('cloud')}>
          Use the Google Drive data on this device
        </button>
        <button className="btn-ghost w-full" disabled={busy} onClick={() => onResolve('local')}>
          Keep this device&apos;s data and replace Google Drive
        </button>
        <button
          className="btn-ghost w-full"
          disabled={busy}
          onClick={async () => {
            await saveJson(await exportBackup(), `atombook-backup-${todayStr()}.json`);
            toast('Backup of this device saved');
          }}
        >
          Download a backup of this device first
        </button>
        <button className="w-full py-1 text-xs text-gray-500 hover:underline" onClick={onLater}>
          Decide later (sync stays paused)
        </button>
      </div>
    </Modal>
  );
}
