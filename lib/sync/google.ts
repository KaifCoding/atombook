/**
 * Google sign-in for a pure browser app (Google Identity Services, "token model").
 *
 * There is no server, so there is no refresh token: Google hands out an access token that
 * lasts about an hour. When it runs out we ask Google for a new one silently (works while the
 * user is still signed in to Google in this browser); if that is not possible the app shows a
 * one-tap "Reconnect" instead of bothering the user in the middle of work.
 *
 * Only the `drive.appdata` scope is requested: the app can see its own hidden folder in the
 * user's Drive and nothing else.
 */
import { AuthRequiredError } from './drive';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

const LS_TOKEN = 'atombook.google.token';
const LS_HINT = 'atombook.google.hint';

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
  scope?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; hint?: string }): void;
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient(cfg: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type?: string; message?: string }) => void;
      }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}
declare global {
  interface Window {
    google?: GoogleGlobal;
  }
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the app still works, just asks more often */
  }
}

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisPromise = null;
        s.remove();
        reject(new Error('Could not load Google sign-in. Check your internet connection.'));
      };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

export class GoogleAuth {
  private client: TokenClient | null = null;
  private pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(private clientId: string) {}

  /** A still-valid token from this browser's storage, if any. */
  cachedToken(): string | null {
    try {
      const raw = lsGet(LS_TOKEN);
      if (!raw) return null;
      const t = JSON.parse(raw) as { token: string; expiresAt: number; clientId?: string };
      if (t.clientId && t.clientId !== this.clientId) return null;
      return t.expiresAt - 60_000 > Date.now() ? t.token : null;
    } catch {
      return null;
    }
  }

  hasSignedInBefore(): boolean {
    return !!lsGet(LS_HINT);
  }

  /**
   * @param interactive true from a button tap: may open Google's sign-in / consent popup.
   * @param force ignore the cached token (used after a 401).
   */
  async getToken(opts: { interactive?: boolean; force?: boolean } = {}): Promise<string> {
    if (!opts.force) {
      const cached = this.cachedToken();
      if (cached) return cached;
    }
    if (this.inflight) return this.inflight;
    this.inflight = this.request(!!opts.interactive).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async request(interactive: boolean): Promise<string> {
    await loadGis();
    if (!this.client) {
      this.client = window.google!.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: DRIVE_SCOPE,
        callback: (r) => {
          const p = this.pending;
          this.pending = null;
          if (!p) return;
          if (r.error || !r.access_token) {
            p.reject(new AuthRequiredError(r.error_description || 'Google sign-in was not completed.'));
            return;
          }
          const ttl = Number(r.expires_in) || 3600;
          lsSet(LS_TOKEN, JSON.stringify({ token: r.access_token, expiresAt: Date.now() + ttl * 1000, clientId: this.clientId }));
          lsSet(LS_HINT, '1');
          p.resolve(r.access_token);
        },
        error_callback: (e) => {
          const p = this.pending;
          this.pending = null;
          p?.reject(
            new AuthRequiredError(
              e?.type === 'popup_failed_to_open'
                ? 'The sign-in window was blocked. Allow pop-ups for this site and try again.'
                : e?.type === 'popup_closed'
                  ? 'Sign-in was cancelled.'
                  : 'Google sign-in did not complete.',
            ),
          );
        },
      });
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          if (this.pending) {
            this.pending = null;
            reject(new AuthRequiredError(interactive ? 'Sign-in timed out.' : ''));
          }
        },
        interactive ? 120_000 : 15_000,
      );
      this.pending = {
        resolve: (t) => {
          clearTimeout(timer);
          resolve(t);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      // 'none' = never show UI. Works silently while the user is still signed in to Google.
      this.client!.requestAccessToken({ prompt: interactive ? (this.hasSignedInBefore() ? '' : 'consent') : 'none' });
    });
  }

  /** Forget the token and ask Google to revoke it. */
  async signOut(): Promise<void> {
    const token = this.cachedToken();
    lsSet(LS_TOKEN, null);
    lsSet(LS_HINT, null);
    if (token && window.google?.accounts?.oauth2) {
      try {
        window.google.accounts.oauth2.revoke(token);
      } catch {
        /* best effort */
      }
    }
  }
}
