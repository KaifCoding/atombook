/** Android Google sign-in flow with fake Capacitor plugins. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ANDROID_REDIRECT, type AndroidDeps, b64url, createAndroidAuth } from '../lib/sync/android';
import { AuthRequiredError, NetworkError } from '../lib/sync/drive';

let passed = 0;
const t = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`FAIL  ${name}\n`, e); process.exitCode = 1; }
};

function fake(opts: { onOpen?: (url: URL, emit: (u: string) => void, closed: () => void) => void; tokenStatus?: number; tokenError?: string; netDown?: boolean } = {}) {
  const store = new Map<string, string>();
  let appCb: ((u: string) => void) | undefined;
  let closedCb: (() => void) | undefined;
  const posts: { url: string; form: Record<string, string> }[] = [];
  let clock = 5_000_000;
  const deps: AndroidDeps = {
    openBrowser: async (u) => {
      opts.onOpen?.(new URL(u), (x) => appCb?.(x), () => closedCb?.());
    },
    closeBrowser: async () => undefined,
    onAppUrl: async (cb) => { appCb = cb; return () => { appCb = undefined; }; },
    onBrowserClosed: async (cb) => { closedCb = cb; return () => { closedCb = undefined; }; },
    postForm: async (url, form) => {
      posts.push({ url, form });
      if (opts.netDown) throw new Error('offline');
      if (url.endsWith('/revoke')) return { status: 200, data: {} };
      if (opts.tokenStatus && opts.tokenStatus >= 400 && (form.grant_type === 'refresh_token' || opts.tokenError === 'other')) {
        return { status: opts.tokenStatus, data: { error: opts.tokenError ?? 'invalid_grant' } };
      }
      if (form.grant_type === 'authorization_code') return { status: 200, data: { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 } };
      return { status: 200, data: { access_token: `AT${posts.length}`, expires_in: 3600 } };
    },
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => (v == null ? store.delete(k) : store.set(k, v)) },
    random: (n) => crypto.randomBytes(n),
    sha256: async (s) => new Uint8Array(crypto.createHash('sha256').update(s).digest()),
    now: () => clock,
  };
  return { deps, posts, store, tick: (ms: number) => { clock += ms; } };
}
const approve = (u: URL, emit: (x: string) => void) =>
  setTimeout(() => emit(`${ANDROID_REDIRECT}?code=CODE1&state=${u.searchParams.get('state')}`), 5);

(async () => {
  await t('sign in: Custom Tab URL, PKCE exchange, refresh token kept', async () => {
    let url!: URL;
    const f = fake({ onOpen: (u, emit) => { url = u; approve(u, emit); } });
    const auth = createAndroidAuth(f.deps, 'android-cid');
    const tok = await auth.getToken({ interactive: true });
    assert.equal(tok, 'AT1');
    assert.equal(url.searchParams.get('redirect_uri'), ANDROID_REDIRECT);
    assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.appdata');
    assert.equal(url.searchParams.get('client_id'), 'android-cid');
    const ex = f.posts[0].form;
    assert.equal(b64url(new Uint8Array(crypto.createHash('sha256').update(ex.code_verifier).digest())), url.searchParams.get('code_challenge'));
    assert.equal(ex.client_id, 'android-cid');
    assert.equal(ex.redirect_uri, ANDROID_REDIRECT);
    assert.equal(auth.hasSignedIn(), true);
    assert.ok(!('client_secret' in ex), 'Android clients use no secret');
  });

  await t('silent: not signed in => auth required, no browser', async () => {
    let opened = false;
    const f = fake({ onOpen: () => { opened = true; } });
    await assert.rejects(createAndroidAuth(f.deps, 'c').getToken(), AuthRequiredError);
    assert.equal(opened, false);
  });

  await t('later: cached token, then silent refresh with the refresh token (no browser)', async () => {
    const f = fake({ onOpen: approve });
    const auth = createAndroidAuth(f.deps, 'c');
    await auth.getToken({ interactive: true });
    assert.equal(await auth.getToken(), 'AT1');
    assert.equal(f.posts.length, 1);
    f.tick(3_600_000);
    const t2 = await auth.getToken();
    assert.notEqual(t2, 'AT1');
    assert.equal(f.posts[1].form.grant_type, 'refresh_token');
    assert.equal(f.posts[1].form.refresh_token, 'RT1');
  });

  await t('forged redirect (wrong state) is rejected', async () => {
    const f = fake({ onOpen: (_u, emit) => setTimeout(() => emit(`${ANDROID_REDIRECT}?code=EVIL&state=nope`), 5) });
    await assert.rejects(createAndroidAuth(f.deps, 'c').getToken({ interactive: true }), AuthRequiredError);
    assert.equal(f.posts.length, 0);
  });

  await t('user denies, or closes the tab: cancelled', async () => {
    const denied = fake({ onOpen: (u, emit) => setTimeout(() => emit(`${ANDROID_REDIRECT}?error=access_denied&state=${u.searchParams.get('state')}`), 5) });
    await assert.rejects(createAndroidAuth(denied.deps, 'c').getToken({ interactive: true }), /cancelled/);
    const closed = fake({ onOpen: (_u, _e, close) => setTimeout(close, 5) });
    await assert.rejects(createAndroidAuth(closed.deps, 'c').getToken({ interactive: true }), /cancelled/);
  });

  await t('closing the tab right after the redirect still signs in (deep link wins the race)', async () => {
    const f = fake({ onOpen: (u, emit, close) => { setTimeout(close, 2); setTimeout(() => emit(`${ANDROID_REDIRECT}?code=C&state=${u.searchParams.get('state')}`), 30); } });
    assert.equal(await createAndroidAuth(f.deps, 'c').getToken({ interactive: true }), 'AT1');
  });

  await t('revoked refresh token: cleared, and interactive sign-in starts again', async () => {
    const f = fake({ onOpen: approve, tokenStatus: 400, tokenError: 'invalid_grant' });
    f.store.set('atombook.android.refresh', 'OLD');
    const auth = createAndroidAuth(f.deps, 'c');
    await assert.rejects(auth.getToken(), AuthRequiredError);
    assert.equal(auth.hasSignedIn(), false);
    assert.equal(await auth.getToken({ interactive: true }), 'AT1'); // fresh sign-in
  });

  await t('offline during refresh is a network error, not a sign-out', async () => {
    const f = fake({ netDown: true });
    f.store.set('atombook.android.refresh', 'RT');
    await assert.rejects(createAndroidAuth(f.deps, 'c').getToken(), NetworkError);
    assert.equal(f.store.get('atombook.android.refresh'), 'RT');
  });

  await t('sign out revokes and forgets', async () => {
    const f = fake({ onOpen: approve });
    const auth = createAndroidAuth(f.deps, 'c');
    await auth.getToken({ interactive: true });
    await auth.signOut();
    assert.equal(auth.hasSignedIn(), false);
    assert.ok(f.posts.some((p) => p.url.endsWith('/revoke') && p.form.token === 'RT1'));
  });

  console.log(`\n${passed} android auth tests passed`);
})();
