/** Desktop (Electron) Google sign-in: PKCE + loopback redirect, against a fake Google. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const { createAuth, pkceChallenge } = createRequire(import.meta.url)('../electron/google-auth.js');

let passed = 0;
const t = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`FAIL  ${name}\n`, e); process.exitCode = 1; }
};

function setup(opts: { tokenFails?: string; browser?: (u: URL) => Promise<void> } = {}) {
  let saved: string | null = null;
  const calls: { url: string; body: URLSearchParams }[] = [];
  let clock = 1_000_000;
  const fakeFetch = async (url: string, init?: RequestInit) => {
    if (url.startsWith('http://127.0.0.1')) return fetch(url, init); // the browser hitting our loopback
    const body = new URLSearchParams(String(init?.body ?? ''));
    calls.push({ url, body });
    if (url.endsWith('/revoke')) return new Response('{}', { status: 200 });
    if (opts.tokenFails && body.get('grant_type') === 'refresh_token') {
      return new Response(JSON.stringify({ error: opts.tokenFails }), { status: 400 });
    }
    if (body.get('grant_type') === 'authorization_code') {
      return new Response(JSON.stringify({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ access_token: `AT${calls.length}`, expires_in: 3600 }), { status: 200 });
  };
  const auth = createAuth({
    fetch: fakeFetch,
    openExternal: async (u: string) => {
      const url = new URL(u);
      await (opts.browser ?? (async (x: URL) => {
        // the user approves: Google redirects the browser to the loopback address
        const back = new URL(x.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', 'CODE123');
        back.searchParams.set('state', x.searchParams.get('state')!);
        void fetch(back);
      }))(url);
    },
    store: { load: () => saved, save: (v: string) => { saved = v; }, clear: () => { saved = null; } },
    now: () => clock,
    timeoutMs: 400,
  });
  return { auth, calls, getSaved: () => saved, tick: (ms: number) => { clock += ms; } };
}
const cfg = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'sec' };

(async () => {
  await t('PKCE challenge is base64url(sha256(verifier))', async () => {
    const v = 'abc';
    assert.equal(pkceChallenge(v), crypto.createHash('sha256').update(v).digest('base64url'));
  });

  await t('sign in: right scope, S256, loopback redirect; refresh token kept in the store only', async () => {
    let seen: URL | undefined;
    const s = setup({ browser: async (u) => {
      seen = u;
      const back = new URL(u.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', 'CODE123'); back.searchParams.set('state', u.searchParams.get('state')!);
      void fetch(back);
    } });
    const r = await s.auth.signIn(cfg);
    assert.equal(r.ok, true);
    assert.equal(r.accessToken, 'AT1');
    assert.equal('refresh_token' in r, false);
    assert.equal(s.getSaved(), 'RT1');
    assert.equal(seen!.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.appdata');
    assert.equal(seen!.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(seen!.searchParams.get('access_type'), 'offline');
    assert.match(seen!.searchParams.get('redirect_uri')!, /^http:\/\/127\.0\.0\.1:\d+$/);
    const ex = s.calls[0].body;
    assert.equal(ex.get('grant_type'), 'authorization_code');
    assert.equal(pkceChallenge(ex.get('code_verifier')!), seen!.searchParams.get('code_challenge'));
    assert.equal(ex.get('redirect_uri'), seen!.searchParams.get('redirect_uri'));
  });

  await t('a redirect with the wrong state is rejected (no token exchange)', async () => {
    const s = setup({ browser: async (u) => {
      const back = new URL(u.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', 'EVIL'); back.searchParams.set('state', 'wrong');
      void fetch(back);
    } });
    const r = await s.auth.signIn(cfg);
    assert.equal(r.ok, false);
    assert.equal(s.calls.length, 0);
    assert.equal(s.getSaved(), null);
  });

  await t('user cancels in the browser / nothing happens: clear error, server closed', async () => {
    const denied = setup({ browser: async (u) => {
      const back = new URL(u.searchParams.get('redirect_uri')!);
      back.searchParams.set('error', 'access_denied'); back.searchParams.set('state', u.searchParams.get('state')!);
      void fetch(back);
    } });
    const r1 = await denied.auth.signIn(cfg);
    assert.equal(r1.ok === false && r1.message, 'Sign-in was cancelled.');
    const idle = setup({ browser: async () => undefined });
    const r2 = await idle.auth.signIn(cfg);
    assert.equal(r2.ok === false && r2.message, 'Sign-in timed out.');
  });

  await t('access token is cached, then refreshed silently with the stored refresh token', async () => {
    const s = setup();
    await s.auth.signIn(cfg);
    const again = await s.auth.getToken(cfg);
    assert.equal(again.accessToken, 'AT1');
    assert.equal(s.calls.length, 1); // no new request
    s.tick(3_600_000);
    const fresh = await s.auth.getToken(cfg);
    assert.equal(fresh.ok, true);
    assert.notEqual(fresh.accessToken, 'AT1');
    assert.equal(s.calls[1].body.get('grant_type'), 'refresh_token');
    assert.equal(s.calls[1].body.get('refresh_token'), 'RT1');
    const forced = await s.auth.getToken({ ...cfg, force: true });
    assert.equal(s.calls.length, 3);
    assert.equal(forced.ok, true);
  });

  await t('no stored token => auth_required; revoked token => store cleared + auth_required', async () => {
    const none = setup();
    assert.equal((await none.auth.getToken(cfg)).code, 'auth_required');
    const revoked = setup({ tokenFails: 'invalid_grant' });
    await revoked.auth.signIn(cfg);
    revoked.tick(3_700_000);
    const r = await revoked.auth.getToken(cfg);
    assert.equal(r.code, 'auth_required');
    assert.equal(revoked.getSaved(), null);
    assert.equal(revoked.auth.hasSignedIn(), false);
  });

  await t('sign out revokes the token at Google and forgets it', async () => {
    const s = setup();
    await s.auth.signIn(cfg);
    await s.auth.signOut();
    assert.equal(s.getSaved(), null);
    assert.ok(s.calls.some((c) => c.url.endsWith('/revoke') && c.body.get('token') === 'RT1'));
    assert.equal((await s.auth.getToken(cfg)).code, 'auth_required');
  });

  console.log(`\n${passed} desktop auth tests passed`);
})();
