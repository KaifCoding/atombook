/**
 * Google sign-in inside the Android app: OAuth with PKCE in a Chrome Custom Tab.
 *
 * Google does not allow sign-in inside an embedded WebView, so the sign-in page opens in the
 * system browser. Google then redirects to `in.atomprod.atombook:/oauth2redirect?code=...`,
 * which Android hands back to this app (intent filter in AndroidManifest.xml). We exchange the
 * code for tokens with a native HTTP call. The refresh token stays in the app's private storage,
 * so the app keeps working without asking again.
 *
 * All platform pieces are injected (`AndroidDeps`), so the flow is unit-tested without a phone.
 */
import { AuthRequiredError, NetworkError } from './drive';

export const ANDROID_REDIRECT = 'in.atomprod.atombook:/oauth2redirect';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const REFRESH_KEY = 'atombook.android.refresh';

export interface AndroidDeps {
  openBrowser(url: string): Promise<void>;
  closeBrowser(): Promise<void>;
  /** Subscribe to deep links that open the app. Returns an unsubscribe function. */
  onAppUrl(cb: (url: string) => void): Promise<() => void>;
  /** Subscribe to "the user closed the sign-in tab". */
  onBrowserClosed(cb: () => void): Promise<() => void>;
  /** Native form POST. Resolves with the HTTP status and parsed JSON; rejects on network errors. */
  postForm(url: string, form: Record<string, string>): Promise<{ status: number; data: Record<string, unknown> }>;
  storage: { get(k: string): string | null; set(k: string, v: string | null): void };
  random(n: number): Uint8Array;
  sha256(text: string): Promise<Uint8Array>;
  now(): number;
}

export const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export function buildAuthUrl(p: { clientId: string; challenge: string; state: string }): string {
  return `${AUTH_URL}?${new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: ANDROID_REDIRECT,
    response_type: 'code',
    scope: SCOPE,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
    access_type: 'offline',
    prompt: 'consent',
  })}`;
}

/** Returns the code, or throws AuthRequiredError (cancelled / wrong state). */
export function parseRedirect(url: string, state: string): string {
  const q = new URL(url.replace(`${ANDROID_REDIRECT}`, 'https://x/cb')).searchParams;
  if (q.get('error')) throw new AuthRequiredError(q.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'Google sign-in did not complete.');
  if (q.get('state') !== state || !q.get('code')) throw new AuthRequiredError('Google sign-in did not complete.');
  return q.get('code') as string;
}

export function createAndroidAuth(deps: AndroidDeps, clientId: string) {
  let access: { token: string; expiresAt: number } | null = null;

  const remember = (data: Record<string, unknown>): string => {
    const ttl = Number(data.expires_in) || 3600;
    access = { token: String(data.access_token), expiresAt: deps.now() + ttl * 1000 };
    return access.token;
  };

  async function token(form: Record<string, string>) {
    let res;
    try {
      res = await deps.postForm(TOKEN_URL, { client_id: clientId, ...form });
    } catch {
      throw new NetworkError();
    }
    if (res.status >= 400) {
      const err = String(res.data.error ?? '');
      if (err === 'invalid_grant' || err === 'invalid_client' || res.status === 401) {
        if (form.grant_type === 'refresh_token') deps.storage.set(REFRESH_KEY, null);
        throw new AuthRequiredError(String(res.data.error_description ?? 'Please sign in to Google again.'));
      }
      throw new Error(String(res.data.error_description ?? `Google sign-in failed (${res.status}).`));
    }
    return res.data;
  }

  async function signIn(): Promise<string> {
    const verifier = b64url(deps.random(48));
    const state = b64url(deps.random(16));
    const challenge = b64url(await deps.sha256(verifier));

    let off: Array<() => void> = [];
    let done = false;
    const code = await new Promise<string>((resolve, reject) => {
      let closedTimer: ReturnType<typeof setTimeout> | undefined;
      const timeout = setTimeout(() => settle(() => reject(new AuthRequiredError('Sign-in timed out.'))), 5 * 60_000);
      const settle = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        clearTimeout(closedTimer);
        fn();
      };
      void (async () => {
        off = [
          await deps.onAppUrl((url) => {
            if (!url.startsWith(ANDROID_REDIRECT)) return;
            settle(() => {
              try {
                resolve(parseRedirect(url, state));
              } catch (e) {
                reject(e);
              }
            });
          }),
          // closing the tab by hand: give the deep link a moment to arrive first
          await deps.onBrowserClosed(() => {
            closedTimer = setTimeout(() => settle(() => reject(new AuthRequiredError('Sign-in was cancelled.'))), 2000);
          }),
        ];
        try {
          await deps.openBrowser(buildAuthUrl({ clientId, challenge, state }));
        } catch (e) {
          settle(() => reject(e));
        }
      })();
    }).finally(() => {
      off.forEach((f) => f());
      void deps.closeBrowser().catch(() => undefined);
    });

    const data = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: ANDROID_REDIRECT });
    if (typeof data.refresh_token === 'string') deps.storage.set(REFRESH_KEY, data.refresh_token);
    return remember(data);
  }

  async function getToken(opts: { interactive?: boolean; force?: boolean } = {}): Promise<string> {
    if (!opts.force && access && access.expiresAt - 60_000 > deps.now()) return access.token;
    const refresh = deps.storage.get(REFRESH_KEY);
    if (refresh) {
      try {
        return remember(await token({ grant_type: 'refresh_token', refresh_token: refresh }));
      } catch (e) {
        if (!(e instanceof AuthRequiredError)) throw e;
        // revoked: fall through to a real sign-in when allowed
      }
    }
    if (!opts.interactive) throw new AuthRequiredError('Please sign in to Google.');
    return signIn();
  }

  async function signOut(): Promise<void> {
    const refresh = deps.storage.get(REFRESH_KEY);
    deps.storage.set(REFRESH_KEY, null);
    access = null;
    if (refresh) await deps.postForm(REVOKE_URL, { token: refresh }).catch(() => undefined);
  }

  return { getToken, signOut, hasSignedIn: () => !!deps.storage.get(REFRESH_KEY) };
}

/** Wire the real Capacitor plugins. Only call this inside the Android app. */
export async function realAndroidDeps(): Promise<AndroidDeps> {
  const [{ Browser }, { App }, { CapacitorHttp }] = await Promise.all([import('@capacitor/browser'), import('@capacitor/app'), import('@capacitor/core')]);
  const sub = (p: Promise<{ remove: () => Promise<void> }>) => p.then((h) => () => void h.remove());
  return {
    openBrowser: (url) => Browser.open({ url }),
    closeBrowser: () => Browser.close(),
    onAppUrl: (cb) => sub(App.addListener('appUrlOpen', (e) => cb(e.url))),
    onBrowserClosed: (cb) => sub(Browser.addListener('browserFinished', cb)),
    postForm: async (url, form) => {
      const r = await CapacitorHttp.post({ url, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: form });
      const data = typeof r.data === 'string' ? (JSON.parse(r.data || '{}') as Record<string, unknown>) : ((r.data ?? {}) as Record<string, unknown>);
      return { status: r.status, data };
    },
    storage: {
      get: (k) => {
        try {
          return localStorage.getItem(k);
        } catch {
          return null;
        }
      },
      set: (k, v) => {
        try {
          if (v == null) localStorage.removeItem(k);
          else localStorage.setItem(k, v);
        } catch {
          /* ignore */
        }
      },
    },
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    sha256: async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    now: () => Date.now(),
  };
}
