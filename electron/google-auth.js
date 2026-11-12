// Google sign-in for the desktop app: "installed app" OAuth with PKCE and a loopback redirect.
// The sign-in page opens in the user's normal browser (Google blocks embedded browsers), the
// browser is redirected to http://127.0.0.1:<port>, and the code is exchanged here in the main
// process. The refresh token never reaches the web page; the page only gets 1-hour access tokens.
// Everything with side effects is injected, so this file is unit-tested without a network.
const crypto = require('crypto');
const http = require('http');

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const pkceChallenge = (verifier) => b64url(crypto.createHash('sha256').update(verifier).digest());

const PAGE = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>AtomBook</title><body style="font-family:system-ui;text-align:center;margin-top:20vh"><h2>${title}</h2><p>${body}</p>`;

/**
 * @param {{ fetch: typeof fetch, openExternal: (url: string) => unknown,
 *           store: { load(): string | null, save(t: string): void, clear(): void },
 *           now?: () => number, timeoutMs?: number }} deps
 */
function createAuth({ fetch, openExternal, store, now = Date.now, timeoutMs = 180000 }) {
  let access = null; // { token, expiresAt, clientId }

  async function tokenRequest(params) {
    let res;
    try {
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
      });
    } catch {
      return { ok: false, code: 'network', message: 'Cannot reach Google. Check your internet connection.' };
    }
    let body = {};
    try { body = await res.json(); } catch { /* not json */ }
    if (!res.ok) {
      const invalid = body.error === 'invalid_grant' || body.error === 'invalid_client' || res.status === 401;
      return { ok: false, code: invalid ? 'auth_required' : 'error', message: body.error_description || body.error || `Google sign-in failed (${res.status}).` };
    }
    return { ok: true, body };
  }

  function remember(body, clientId) {
    const expiresIn = Number(body.expires_in) || 3600;
    access = { token: body.access_token, expiresAt: now() + expiresIn * 1000, clientId };
    return { ok: true, accessToken: body.access_token, expiresIn };
  }

  async function signIn({ clientId, clientSecret }) {
    if (!clientId) return { ok: false, code: 'error', message: 'No Google client id is configured.' };
    const verifier = b64url(crypto.randomBytes(48));
    const state = b64url(crypto.randomBytes(16));

    let server;
    let finish;
    const result = new Promise((resolve) => { finish = resolve; });
    try {
      server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
          res.writeHead(404).end(); // favicon and other noise
          return;
        }
        const ok = url.searchParams.get('state') === state && url.searchParams.has('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(ok ? PAGE('Signed in', 'You can close this tab and return to AtomBook.') : PAGE('Sign-in was not completed', 'Return to AtomBook and try again.'));
        if (ok) finish({ code: url.searchParams.get('code') });
        else finish({ error: url.searchParams.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'Google sign-in did not complete.' });
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const redirectUri = `http://127.0.0.1:${server.address().port}`;

      const authUrl = `${AUTH_URL}?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        code_challenge: pkceChallenge(verifier),
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent',
      })}`;
      await openExternal(authUrl);

      let timer;
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ error: 'Sign-in timed out.' }), timeoutMs); });
      const got = await Promise.race([result, timeout]);
      clearTimeout(timer);
      if (got.error) return { ok: false, code: 'auth_required', message: got.error };

      const t = await tokenRequest({
        grant_type: 'authorization_code',
        code: got.code,
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        code_verifier: verifier,
        redirect_uri: redirectUri,
      });
      if (!t.ok) return t;
      if (t.body.refresh_token) store.save(t.body.refresh_token);
      return remember(t.body, clientId);
    } catch (e) {
      return { ok: false, code: 'error', message: e && e.message ? e.message : 'Google sign-in failed.' };
    } finally {
      if (server) server.close();
    }
  }

  async function getToken({ clientId, clientSecret, force = false }) {
    if (!force && access && access.clientId === clientId && access.expiresAt - 60000 > now()) {
      return { ok: true, accessToken: access.token, expiresIn: Math.round((access.expiresAt - now()) / 1000) };
    }
    const refresh = store.load();
    if (!refresh) return { ok: false, code: 'auth_required', message: 'Please sign in to Google.' };
    const t = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    });
    if (!t.ok) {
      if (t.code === 'auth_required') { store.clear(); access = null; }
      return t;
    }
    return remember(t.body, clientId);
  }

  async function signOut() {
    const refresh = store.load();
    store.clear();
    access = null;
    if (refresh) {
      try { await fetch(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${encodeURIComponent(refresh)}` }); } catch { /* best effort */ }
    }
    return { ok: true };
  }

  return { signIn, getToken, signOut, hasSignedIn: () => !!store.load() };
}

module.exports = { createAuth, pkceChallenge, SCOPE };
