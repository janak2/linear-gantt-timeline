import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, pkceChallenge } from '../../src/auth.js';
import { MemoryArea, json } from './helpers.js';

const REDIRECT = 'https://ejcenkoklniinapjjgllepiedoajnali.chromiumapp.org/linear';
const account = { viewer: { id: 'user-1', name: 'Maya' }, organization: { id: 'org-1', name: 'Acme', urlKey: 'acme' } };

// A fake Linear: OAuth token/revoke endpoints plus the viewer query.
function setup({ approve = params => `${REDIRECT}?code=code-1&state=${params.get('state')}`, token = () => json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 86399, token_type: 'Bearer' }), session = {}, local = {} } = {}) {
  const calls = { authorize: [], token: [], revoke: [], graphql: [] };
  let time = 1_000_000;
  let signedOut = 0;
  const fetcher = async (url, options) => {
    if (url === 'https://api.linear.app/oauth/token') {
      const params = new URLSearchParams(options.body);
      calls.token.push(Object.fromEntries(params));
      return token(params);
    }
    if (url === 'https://api.linear.app/oauth/revoke') {
      calls.revoke.push(Object.fromEntries(new URLSearchParams(options.body)));
      return new Response('', { status: 200 });
    }
    calls.graphql.push(options.headers.Authorization);
    return json({ data: account });
  };
  const deps = {
    clientId: 'client-1',
    scopes: ['read', 'write'],
    session: new MemoryArea(session),
    local: new MemoryArea(local),
    launchWebAuthFlow: async ({ url, interactive }) => {
      assert.equal(interactive, true);
      const parsed = new URL(url);
      calls.authorize.push(parsed);
      return approve(parsed.searchParams);
    },
    redirectURL: () => REDIRECT,
    fetcher,
    onSignedOut: () => { signedOut++; },
    now: () => time
  };
  return { auth: createAuth(deps), deps, calls, advance: ms => { time += ms; }, signedOut: () => signedOut };
}

const connected = { session: { accessToken: 'access-1', expiresAt: 1_000_000 + 3_600_000 }, local: { refreshToken: 'refresh-1', account } };

test('connects with OAuth authorization code and an S256 PKCE challenge', async () => {
  const { auth, deps, calls } = setup();
  const status = await auth.connect();
  assert.deepEqual(status, { configured: true, connected: true, account });

  const params = calls.authorize[0].searchParams;
  assert.equal(calls.authorize[0].origin + calls.authorize[0].pathname, 'https://linear.app/oauth/authorize');
  assert.equal(params.get('client_id'), 'client-1');
  assert.equal(params.get('redirect_uri'), REDIRECT);
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('scope'), 'read,write');
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.ok(params.get('state').length >= 32);

  const exchange = calls.token[0];
  assert.deepEqual(Object.keys(exchange).sort(), ['client_id', 'code', 'code_verifier', 'grant_type', 'redirect_uri']);
  assert.equal(exchange.grant_type, 'authorization_code');
  assert.equal(exchange.redirect_uri, REDIRECT);
  assert.ok(exchange.code_verifier.length >= 43 && exchange.code_verifier.length <= 128);
  assert.equal(await pkceChallenge(exchange.code_verifier), params.get('code_challenge'));

  assert.deepEqual(calls.graphql, ['Bearer access-1']);
  assert.deepEqual(deps.session.data, { accessToken: 'access-1', expiresAt: 1_000_000 + 86_399_000 });
  assert.deepEqual(deps.local.data, { refreshToken: 'refresh-1', account });
});

test('handles a cancelled sign-in', async () => {
  const { auth, deps, calls } = setup({ approve: () => { throw new Error('The user did not approve access.'); } });
  await assert.rejects(auth.connect(), { code: 'cancelled' });
  assert.equal(calls.token.length, 0);
  assert.deepEqual(deps.session.data, {});
  assert.equal((await auth.status()).connected, false);
});

test('handles denied consent', async () => {
  const { auth, calls } = setup({ approve: params => `${REDIRECT}?error=access_denied&state=${params.get('state')}` });
  await assert.rejects(auth.connect(), { code: 'denied' });
  assert.equal(calls.token.length, 0);
});

test('rejects an invalid state or callback', async () => {
  for (const approve of [
    () => `${REDIRECT}?code=code-1&state=forged`,
    () => `${REDIRECT}?code=code-1`,
    params => `https://evil.example/linear?code=code-1&state=${params.get('state')}`,
    params => `${REDIRECT}/other?code=code-1&state=${params.get('state')}`,
    () => 'not a url'
  ]) {
    const { auth, deps, calls } = setup({ approve });
    await assert.rejects(auth.connect(), { code: 'invalid_state' });
    assert.equal(calls.token.length, 0);
    assert.equal(deps.session.data.pendingAuth, undefined);
  }
});

test('consumes a sign-in attempt only once and expires stale attempts', async () => {
  const stale = setup();
  stale.deps.launchWebAuthFlow = async ({ url }) => {
    stale.advance(11 * 60_000);
    return `${REDIRECT}?code=code-1&state=${new URL(url).searchParams.get('state')}`;
  };
  await assert.rejects(createAuth(stale.deps).connect(), { code: 'invalid_state' });

  const replay = setup();
  replay.deps.launchWebAuthFlow = async ({ url }) => {
    await replay.deps.session.remove('pendingAuth');
    return `${REDIRECT}?code=code-1&state=${new URL(url).searchParams.get('state')}`;
  };
  await assert.rejects(createAuth(replay.deps).connect(), { code: 'invalid_state' });
});

test('requires a configured client ID', async () => {
  const { deps } = setup();
  const auth = createAuth({ ...deps, clientId: '' });
  await assert.rejects(auth.connect(), { code: 'not_configured' });
  assert.deepEqual(await auth.status(), { configured: false, connected: false, account: null });
});

test('uses a valid access token without refreshing', async () => {
  const { auth, calls } = setup(connected);
  assert.equal(await auth.withAccessToken(async token => token), 'access-1');
  assert.equal(calls.token.length, 0);
});

test('refreshes an expired access token and stores the rotated refresh token', async () => {
  const { auth, deps, calls, advance } = setup({ ...connected, token: () => json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 86399 }) });
  advance(3_600_000);
  assert.equal(await auth.withAccessToken(async token => token), 'access-2');
  assert.deepEqual(calls.token, [{ grant_type: 'refresh_token', refresh_token: 'refresh-1', client_id: 'client-1' }]);
  assert.equal(deps.local.data.refreshToken, 'refresh-2');
  assert.equal(deps.session.data.accessToken, 'access-2');
});

test('refreshes once for concurrent requests', async () => {
  const { auth, calls, advance } = setup({ ...connected, token: () => json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 86399 }) });
  advance(3_600_000);
  const tokens = await Promise.all([1, 2, 3].map(() => auth.withAccessToken(async token => token)));
  assert.deepEqual(tokens, ['access-2', 'access-2', 'access-2']);
  assert.equal(calls.token.length, 1);
});

test('retries once with a refreshed token when Linear rejects the access token', async () => {
  const { auth, calls } = setup({ ...connected, token: () => json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 86399 }) });
  const seen = [];
  const result = await auth.withAccessToken(async token => {
    seen.push(token);
    if (token === 'access-1') throw Object.assign(new Error('rejected'), { code: 'auth' });
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.deepEqual(seen, ['access-1', 'access-2']);
  assert.equal(calls.token.length, 1);
});

test('signs out when access was revoked', async () => {
  const { auth, deps, advance, signedOut } = setup({ ...connected, token: () => json({ error: 'invalid_grant' }, 400) });
  advance(3_600_000);
  await assert.rejects(auth.withAccessToken(async token => token), { code: 'revoked' });
  assert.deepEqual(deps.session.data, {});
  assert.deepEqual(deps.local.data, {});
  assert.equal(signedOut(), 1);
});

test('signs out when a refreshed token is still rejected', async () => {
  const { auth, deps, signedOut } = setup({ ...connected, token: () => json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 86399 }) });
  await assert.rejects(auth.withAccessToken(async () => { throw Object.assign(new Error('rejected'), { code: 'auth' }); }), { code: 'revoked' });
  assert.deepEqual(deps.local.data, {});
  assert.equal(signedOut(), 1);
});

test('keeps the sign-in after a temporary refresh failure', async () => {
  const { auth, deps, advance } = setup({ ...connected, token: () => new Response('', { status: 503 }) });
  advance(3_600_000);
  await assert.rejects(auth.withAccessToken(async token => token), { code: 'token' });
  assert.equal(deps.local.data.refreshToken, 'refresh-1');
});

test('disconnect clears credentials and revokes tokens', async () => {
  const { auth, deps, calls, signedOut } = setup(connected);
  await auth.disconnect();
  assert.deepEqual(deps.session.data, {});
  assert.deepEqual(deps.local.data, {});
  assert.equal(signedOut(), 1);
  assert.deepEqual(calls.revoke, [{ token: 'refresh-1', token_type_hint: 'refresh_token' }, { token: 'access-1', token_type_hint: 'access_token' }]);
  await assert.rejects(auth.withAccessToken(async token => token), { code: 'signed_out' });
});
