/**
 * Picks the right Google sign-in for where AtomBook is running:
 *  - web      browser / installed web app: Google Identity Services pop-up   (lib/sync/google.ts)
 *  - desktop  Windows/Linux app: system browser + loopback, done in Electron  (electron/google-auth.js)
 *  - android  Android app: Chrome Custom Tab + deep link                      (lib/sync/android.ts)
 * Each needs its own OAuth client id (Google issues a different client type per platform).
 */
import { createAndroidAuth, realAndroidDeps } from './android';
import { AuthRequiredError, NetworkError } from './drive';
import { GoogleAuth } from './google';

export type Platform = 'web' | 'desktop' | 'android' | 'unsupported';

export interface AuthProvider {
  getToken(opts?: { interactive?: boolean; force?: boolean }): Promise<string>;
  signOut(): Promise<void>;
}

export interface Credentials {
  clientId: string;
  /** Only the desktop client type has one (Google requires it there; it is not a real secret). */
  clientSecret?: string;
}

interface DesktopBridge {
  signIn(c: Credentials): Promise<BridgeResult>;
  getToken(c: Credentials & { force?: boolean }): Promise<BridgeResult>;
  signOut(): Promise<unknown>;
}
type BridgeResult = { ok: true; accessToken: string } | { ok: false; code: string; message: string };

declare global {
  interface Window {
    atombookDesktop?: { googleAuth?: DesktopBridge };
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  }
}

export function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'unsupported';
  if (window.atombookDesktop?.googleAuth) return 'desktop';
  const cap = window.Capacitor;
  if (cap?.isNativePlatform?.()) return cap.getPlatform?.() === 'android' ? 'android' : 'unsupported';
  if (/^https?:$/.test(location.protocol) && window.isSecureContext) return 'web';
  return 'unsupported';
}

const LS = { web: 'atombook.google.clientId', desktop: 'atombook.google.desktopClientId', desktopSecret: 'atombook.google.desktopClientSecret', android: 'atombook.google.androidClientId' };
const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k) || '';
  } catch {
    return '';
  }
};
const lsSet = (k: string, v: string) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
};

/** Build-time values first (set in the hosting dashboard / CI), then whatever was pasted in Settings. */
export function getCredentials(p: Platform): Credentials {
  switch (p) {
    case 'web':
      return { clientId: (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || lsGet(LS.web)).trim() };
    case 'desktop':
      return {
        clientId: (process.env.NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID || lsGet(LS.desktop)).trim(),
        clientSecret: (process.env.NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_SECRET || lsGet(LS.desktopSecret)).trim(),
      };
    case 'android':
      return { clientId: (process.env.NEXT_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || lsGet(LS.android)).trim() };
    default:
      return { clientId: '' };
  }
}

export function credentialsFromBuild(p: Platform): boolean {
  if (p === 'web') return !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (p === 'desktop') return !!process.env.NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID;
  if (p === 'android') return !!process.env.NEXT_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
  return false;
}

export function setCredentials(p: Platform, c: Credentials) {
  if (p === 'web') lsSet(LS.web, c.clientId.trim());
  if (p === 'desktop') {
    lsSet(LS.desktop, c.clientId.trim());
    lsSet(LS.desktopSecret, (c.clientSecret || '').trim());
  }
  if (p === 'android') lsSet(LS.android, c.clientId.trim());
}

/** Desktop: all token handling happens in Electron's main process; this is just the bridge. */
class DesktopAuth implements AuthProvider {
  constructor(private cred: Credentials) {}
  async getToken(opts: { interactive?: boolean; force?: boolean } = {}): Promise<string> {
    const bridge = window.atombookDesktop?.googleAuth as DesktopBridge;
    let r = await bridge.getToken({ ...this.cred, force: opts.force });
    if (!r.ok && r.code === 'auth_required' && opts.interactive) r = await bridge.signIn(this.cred);
    if (r.ok) return r.accessToken;
    if (r.code === 'network') throw new NetworkError(r.message);
    if (r.code === 'auth_required') throw new AuthRequiredError(r.message);
    throw new Error(r.message);
  }
  async signOut() {
    await window.atombookDesktop?.googleAuth?.signOut();
  }
}

/** Android: the plugins are loaded on first use. */
class AndroidAuth implements AuthProvider {
  private inner: Promise<ReturnType<typeof createAndroidAuth>>;
  constructor(cred: Credentials) {
    this.inner = realAndroidDeps().then((d) => createAndroidAuth(d, cred.clientId));
  }
  async getToken(opts: { interactive?: boolean; force?: boolean } = {}) {
    return (await this.inner).getToken(opts);
  }
  async signOut() {
    await (await this.inner).signOut();
  }
}

export function createAuth(p: Platform, cred: Credentials): AuthProvider | null {
  if (!cred.clientId) return null;
  if (p === 'web') return new GoogleAuth(cred.clientId);
  if (p === 'desktop') return new DesktopAuth(cred);
  if (p === 'android') return new AndroidAuth(cred);
  return null;
}
