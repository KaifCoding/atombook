'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

// Android only: the installed app asks the GitHub Release if a newer version exists
// and offers the APK. Windows/Linux update themselves (see electron/main.js).
const REPO = process.env.NEXT_PUBLIC_GH_REPO; // "owner/repo", set at build time
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';

const parts = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest), b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

export function UpdateBanner() {
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(null);

  useEffect(() => {
    if (!REPO || !APP_VERSION) return;
    let cancelled = false;
    (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
        if (!res.ok) return;
        const rel = await res.json();
        const apk = (rel.assets || []).find((a: { name: string }) => a.name.endsWith('.apk'));
        if (!cancelled && apk && isNewer(rel.tag_name, APP_VERSION)) {
          setUpdate({ version: String(rel.tag_name).replace(/^v/, ''), url: apk.browser_download_url });
        }
      } catch {
        /* offline or rate limited: stay quiet */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return null;
  const download = async () => {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: update.url });
    } catch {
      window.open(update.url, '_blank');
    }
  };
  return (
    <div className="fixed inset-x-3 top-3 z-50 flex items-center gap-3 rounded-xl bg-brand-600 px-4 py-3 text-sm text-white shadow-lg md:left-auto md:w-96">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Update available: v{update.version}</div>
        <div className="text-xs text-brand-100">Download the APK and open it to update. Your data is kept.</div>
      </div>
      <button className="flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 font-semibold text-brand-700" onClick={download}>
        <Download size={14} /> Update
      </button>
      <button aria-label="Dismiss" onClick={() => setUpdate(null)}><X size={16} /></button>
    </div>
  );
}
