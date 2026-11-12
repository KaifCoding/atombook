'use client';

import { AlertTriangle, Cloud, CloudOff, ExternalLink, Loader2, LogOut, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Field } from '@/components/ui';
import { useSync } from '@/components/SyncProvider';

const CLIENT_TYPE = { web: 'Web application', desktop: 'Desktop app', android: 'Android', unsupported: '' } as const;
const GUIDE = 'https://github.com/KaifCoding/atombook/blob/main/SYNC-GUIDE.md';
const PRIVACY = '/privacy/';

export function timeAgo(ms: number | undefined, now = Date.now()): string {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString();
}

/** Re-render every 30 s so "2 min ago" stays true. */
function useTick(ms = 30_000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** Small status chip for the sidebar / top of the page. */
export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const s = useSync();
  useTick();
  if (s.phase === 'unsupported' || s.phase === 'unconfigured') return null;

  let icon = <Cloud size={14} />;
  let text = `Synced ${timeAgo(s.lastSyncAt)}`;
  let tone = 'text-gray-500';
  switch (s.phase) {
    case 'off':
      icon = <CloudOff size={14} />;
      text = 'Sync is off';
      break;
    case 'syncing':
      icon = <Loader2 size={14} className="animate-spin" />;
      text = 'Syncing…';
      tone = 'text-brand-600';
      break;
    case 'offline':
      icon = <CloudOff size={14} />;
      text = 'Offline: will sync later';
      break;
    case 'needs-auth':
      icon = <AlertTriangle size={14} />;
      text = 'Reconnect Google';
      tone = 'text-amber-600';
      break;
    case 'error':
      icon = <AlertTriangle size={14} />;
      text = 'Sync problem';
      tone = 'text-red-600';
      break;
    case 'conflict':
      icon = <AlertTriangle size={14} />;
      text = 'Choose data to keep';
      tone = 'text-amber-600';
      break;
  }
  const needsAction = s.phase === 'needs-auth' || s.phase === 'conflict';
  const cls = `inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs ${tone} hover:bg-gray-50`;
  const label = compact ? <span className="max-w-[9rem] truncate">{text}</span> : <span>{text}</span>;

  if (needsAction) {
    return (
      <button className={cls} onClick={() => void s.syncNow()} title={s.error || text}>
        {icon}
        {label}
      </button>
    );
  }
  return (
    <Link href="/settings/#sync" className={cls} title={s.error || text}>
      {icon}
      {label}
    </Link>
  );
}

/** The "Google Drive sync" card in Settings. */
export function SyncPanel() {
  const s = useSync();
  useTick();
  const [draftId, setDraftId] = useState('');
  const [draftSecret, setDraftSecret] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const connected = s.phase !== 'off' && s.phase !== 'unsupported' && s.phase !== 'unconfigured';

  return (
    <section className="card" id="sync">
      <h2 className="mb-1 font-semibold">Google Drive sync</h2>

      {s.phase === 'unsupported' && (
        <p className="text-xs text-gray-500">
          Google Drive sync is not available here. It needs the Android app, the Windows/Linux app, or AtomBook opened in a browser over https.
        </p>
      )}

      {s.phase === 'unconfigured' && (
        <div>
          <p className="text-xs text-gray-500">
            Google Drive sync is not switched on in this version yet. Please update AtomBook, or write to{' '}
            <a className="text-brand-600 underline" href="mailto:kaif@atomprod.in">kaif@atomprod.in</a>. Everything else works normally, and you can move data between devices with a backup file.
          </p>
          <details className="mt-3 text-xs text-gray-500">
            <summary className="cursor-pointer select-none">Advanced: enter a Google Client ID (self-hosting only)</summary>
            <div className="mt-2">
              <Field label={`Google OAuth Client ID (${CLIENT_TYPE[s.platform]})`} hint="Only needed if you host AtomBook yourself.">
                <input className="input" value={draftId} onChange={(e) => setDraftId(e.target.value)} placeholder="…apps.googleusercontent.com" />
              </Field>
              {s.platform === 'desktop' && (
                <Field label="Client secret">
                  <input className="input" value={draftSecret} onChange={(e) => setDraftSecret(e.target.value)} placeholder="GOCSPX-…" />
                </Field>
              )}
              <button
                className="btn-primary mt-2"
                disabled={!draftId.trim().endsWith('.apps.googleusercontent.com') || (s.platform === 'desktop' && !draftSecret.trim())}
                onClick={() => s.saveCredentials({ clientId: draftId, clientSecret: draftSecret })}
              >
                Save
              </button>
            </div>
          </details>
        </div>
      )}

      {s.phase === 'off' && (
        <div>
          <p className="mb-3 text-xs text-gray-500">
            Use AtomBook on your phone and computer with the same data. Your data is kept in a hidden app folder in <b>your own</b> Google Drive (AtomBook cannot see any of your other files). It still
            works offline and syncs when you are back online.
          </p>
          <button className="btn-primary" onClick={() => void s.connect()}>
            <Cloud size={16} /> Connect Google Drive
          </button>
          {s.platform !== 'web' && (
            <p className="mt-2 text-[11px] text-gray-400">Google sign-in opens in your browser, then brings you back here.</p>
          )}
          {!s.credentialsFromBuild && s.credentials.clientId && (
            <button className="ml-2 text-xs text-gray-500 underline" onClick={() => s.saveCredentials({ clientId: '', clientSecret: '' })}>
              Change Client ID
            </button>
          )}
        </div>
      )}

      {connected && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5">
              {s.phase === 'syncing' ? <Loader2 size={15} className="animate-spin text-brand-600" /> : s.phase === 'idle' ? <Cloud size={15} className="text-green-600" /> : <AlertTriangle size={15} className="text-amber-600" />}
              <b>
                {s.phase === 'syncing'
                  ? 'Syncing…'
                  : s.phase === 'idle'
                    ? 'Connected'
                    : s.phase === 'offline'
                      ? 'Offline'
                      : s.phase === 'conflict'
                        ? 'Waiting for your choice'
                        : s.phase === 'needs-auth'
                          ? 'Sign-in needed'
                          : 'Problem'}
              </b>
            </span>
            {s.account && <span className="text-gray-600">{s.account}</span>}
            <span className="text-gray-500">Last synced: {timeAgo(s.lastSyncAt)}</span>
          </div>

          {s.error && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{s.error}</p>}
          {s.phase === 'offline' && <p className="mb-3 text-xs text-gray-500">No internet right now. Your work is saved on this device and will sync automatically.</p>}

          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={s.phase === 'syncing'} onClick={() => void s.syncNow()}>
              <RefreshCw size={16} className={s.phase === 'syncing' ? 'animate-spin' : ''} />
              {s.phase === 'needs-auth' ? 'Reconnect Google' : s.phase === 'conflict' ? 'Choose data to keep' : 'Sync now'}
            </button>
            <button className="btn-ghost" onClick={() => void s.disconnect()}>
              <LogOut size={16} /> Disconnect
            </button>
            <button className="btn-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={16} /> Delete Drive copy
            </button>
          </div>

          {confirmDelete && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              This removes AtomBook&apos;s copy from your Google Drive and turns sync off on every device. Data already on your phone and computer is not deleted.
              <div className="mt-2 flex gap-2">
                <button
                  className="btn-sm btn rounded-lg bg-red-600 text-white hover:bg-red-700"
                  onClick={() => {
                    setConfirmDelete(false);
                    void s.deleteCloud();
                  }}
                >
                  Delete Drive copy
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <p className="mt-3 text-[11px] text-gray-400">
            Tip: keep downloading a backup now and then. Sync copies mistakes too (for example a deleted customer), it is not a time machine.
          </p>
        </div>
      )}
      <p className="mt-3 text-[11px] text-gray-400">
        <a className="underline" href={GUIDE} target="_blank" rel="noopener noreferrer">How sync works</a> · <Link className="underline" href={PRIVACY}>Privacy policy</Link>
      </p>
    </section>
  );
}
