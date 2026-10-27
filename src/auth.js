import { fetchAccount } from './linear.js';

const AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
const TOKEN_URL = 'https://api.linear.app/oauth/token';
const REVOKE_URL = 'https://api.linear.app/oauth/revoke';
const PENDING_TTL_MS = 10 * 60_000;
const EXPIRY_MARGIN_MS = 60_000;

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkceChallenge(verifier, crypto = globalThis.crypto) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

// Access tokens live in session storage; the rotating refresh token and account
// summary live in local storage, which the caller restricts to trusted contexts.
export function createAuth({ clientId, scopes, session, local, launchWebAuthFlow, redirectURL, fetcher, onSignedOut, now = Date.now, crypto = globalThis.crypto }) {
  let refreshing = null;
  let connecting = null;

  const random = size => base64url(crypto.getRandomValues(new Uint8Array(size)));

  async function tokenRequest(params) {
    let response;
    try {
      response = await fetcher(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        credentials: 'omit',
        signal: AbortSignal.timeout(20_000)
      });
    } catch {
      throw new AuthError('network', 'Could not reach Linear to sign in. Check your connection and try again.');
    }
    const body = await response.json().catch(() => ({}));
    if (response.status === 400 && body.error === 'invalid_grant') {
      throw new AuthError('revoked', 'Your Linear access was revoked or expired. Connect Linear again.');
    }
    if (!response.ok || typeof body.access_token !== 'string') throw new AuthError('token', 'Linear sign-in failed. Try again.');
    return body;
  }

  async function saveTokens(tokens, account) {
    const expiresIn = Number(tokens.expires_in) > 0 ? Number(tokens.expires_in) : 3600;
    await session.set({ accessToken: tokens.access_token, expiresAt: now() + expiresIn * 1000 });
    const stored = { account };
    if (typeof tokens.refresh_token === 'string') stored.refreshToken = tokens.refresh_token;
    await local.set(stored);
  }

  async function clear() {
    await session.remove(['accessToken', 'expiresAt', 'pendingAuth']);
    await local.remove(['refreshToken', 'account']);
  }

  async function signOut() {
    await clear();
    onSignedOut();
  }

  async function status() {
    const { account } = await local.get('account');
    return { configured: Boolean(clientId), connected: Boolean(account), account: account ?? null };
  }

  async function runConnect() {
    if (!clientId) throw new AuthError('not_configured', 'This build has no Linear OAuth client ID configured.');
    const redirectUri = redirectURL();
    const state = random(32);
    const verifier = random(64);
    await session.set({ pendingAuth: { state, verifier, redirectUri, createdAt: now() } });
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(','),
      state,
      code_challenge: await pkceChallenge(verifier, crypto),
      code_challenge_method: 'S256',
      actor: 'user'
    }).toString();

    let responseURL;
    try {
      responseURL = await launchWebAuthFlow({ url: url.href, interactive: true });
    } catch {
      await session.remove('pendingAuth');
      throw new AuthError('cancelled', 'Sign-in was cancelled.');
    }
    const { pendingAuth } = await session.get('pendingAuth');
    await session.remove('pendingAuth');
    if (!pendingAuth || pendingAuth.state !== state || now() - pendingAuth.createdAt > PENDING_TTL_MS) {
      throw new AuthError('invalid_state', 'Sign-in could not be verified. Try again.');
    }
    let result = null;
    try { result = new URL(responseURL); } catch { /* Rejected below. */ }
    const expected = new URL(pendingAuth.redirectUri);
    if (!result || result.origin !== expected.origin || result.pathname !== expected.pathname || result.searchParams.get('state') !== pendingAuth.state) {
      throw new AuthError('invalid_state', 'Sign-in could not be verified. Try again.');
    }
    const error = result.searchParams.get('error');
    if (error === 'access_denied') throw new AuthError('denied', 'Access to Linear was not granted.');
    const code = result.searchParams.get('code');
    if (error || !code) throw new AuthError('oauth', 'Linear sign-in failed. Try again.');

    const tokens = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pendingAuth.redirectUri,
      client_id: clientId,
      code_verifier: pendingAuth.verifier
    });
    const account = await fetchAccount(tokens.access_token, fetcher);
    await saveTokens(tokens, account);
    return status();
  }

  function connect() {
    connecting ??= runConnect().finally(() => { connecting = null; });
    return connecting;
  }

  async function runRefresh() {
    const { refreshToken, account } = await local.get(['refreshToken', 'account']);
    if (!refreshToken || !account) throw new AuthError('signed_out', 'Connect Linear to continue.');
    let tokens;
    try {
      tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
    } catch (error) {
      if (error.code === 'revoked') await signOut();
      throw error;
    }
    await saveTokens(tokens, account);
    return tokens.access_token;
  }

  function refresh() {
    refreshing ??= runRefresh().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function accessToken() {
    const { accessToken: token, expiresAt } = await session.get(['accessToken', 'expiresAt']);
    if (token && expiresAt - EXPIRY_MARGIN_MS > now()) return token;
    return refresh();
  }

  // Runs a Linear request, refreshing once if Linear rejects the access token.
  async function withAccessToken(request) {
    try {
      return await request(await accessToken());
    } catch (error) {
      if (error.code !== 'auth') throw error;
    }
    await session.remove(['accessToken', 'expiresAt']);
    try {
      return await request(await refresh());
    } catch (error) {
      if (error.code !== 'auth') throw error;
      await signOut();
      throw new AuthError('revoked', 'Your Linear access was revoked. Connect Linear again.');
    }
  }

  async function disconnect() {
    const { accessToken: token } = await session.get('accessToken');
    const { refreshToken } = await local.get('refreshToken');
    await signOut();
    const revocations = [[refreshToken, 'refresh_token'], [token, 'access_token']].filter(([value]) => value);
    await Promise.allSettled(revocations.map(([value, hint]) => fetcher(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: value, token_type_hint: hint }).toString(),
      credentials: 'omit',
      signal: AbortSignal.timeout(10_000)
    })));
  }

  return { status, connect, disconnect, withAccessToken };
}
