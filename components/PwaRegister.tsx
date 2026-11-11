'use client';

import { useEffect } from 'react';

/** Registers the service worker on the online version only (not in the Android / desktop shells). */
export function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return; // Electron app://
    const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.()) return;
    if (process.env.NODE_ENV !== 'production') return; // keep `npm run dev` free of caching surprises
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* not fatal: the app simply is not installable / offline-capable */
    });
  }, []);
  return null;
}
