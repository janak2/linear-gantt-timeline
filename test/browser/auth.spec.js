import { CLIENT_ID, MOBILE, expect, openGantt, row, test } from './harness.js';

const REDIRECT = 'https://ejcenkoklniinapjjgllepiedoajnali.chromiumapp.org/linear';

// Stands in for Linear's consent screen inside chrome.identity.launchWebAuthFlow.
async function stubConsent(worker, outcome) {
  await worker.evaluate(({ outcome, redirect }) => {
    chrome.identity.launchWebAuthFlow = async ({ url }) => {
      const params = new URL(url).searchParams;
      self.lastAuthorize = Object.fromEntries(params);
      if (outcome === 'cancel') throw new Error('The user did not approve access.');
      if (outcome === 'forged') return `${redirect}?code=code-ok&state=forged`;
      return `${redirect}?code=code-ok&state=${params.get('state')}`;
    };
  }, { outcome, redirect: REDIRECT });
}

test('connects Linear with OAuth and loads the project', async ({ page, worker, linear }) => {
  await stubConsent(worker, 'approve');
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(frame.locator('#gate-title')).toHaveText('Connect Linear');
  await frame.locator('#gate-action').click();
  await expect(row(frame, 'MOB-1')).toBeVisible();

  const authorize = await worker.evaluate(() => self.lastAuthorize);
  expect(authorize).toMatchObject({ client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: 'read,write', code_challenge_method: 'S256' });
  expect(linear.tokenRequests[0]).toMatchObject({ grant_type: 'authorization_code', code: 'code-ok', client_id: CLIENT_ID, redirect_uri: REDIRECT });
  expect(linear.tokenRequests[0].code_verifier.length).toBeGreaterThanOrEqual(43);
  expect(linear.tokenRequests[0]).not.toHaveProperty('client_secret');

  const stored = await worker.evaluate(async () => ({ session: await chrome.storage.session.get(), local: await chrome.storage.local.get() }));
  expect(stored.session.accessToken).toBe('access-2');
  expect(stored.local.refreshToken).toBe('refresh-2');
  expect(stored.local.account.organization.urlKey).toBe('acme');
});

test('tokens never reach the Linear page', async ({ page, signIn }) => {
  await signIn();
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(row(frame, 'MOB-1')).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain('access-1');
  expect(html).not.toContain('refresh-1');
  expect(await page.evaluate(() => typeof chrome === 'undefined' || !chrome.storage)).toBe(true);
});

test('handles a cancelled sign-in', async ({ page, worker, linear }) => {
  await stubConsent(worker, 'cancel');
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await frame.locator('#gate-action').click();
  await expect(frame.locator('#gate-text')).toHaveText('Sign-in was cancelled.');
  await expect(frame.locator('#gate-action')).toBeEnabled();
  expect(linear.tokenRequests).toHaveLength(0);
});

test('rejects a sign-in with an invalid state', async ({ page, worker, linear }) => {
  await stubConsent(worker, 'forged');
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await frame.locator('#gate-action').click();
  await expect(frame.locator('#gate-text')).toHaveText('Sign-in could not be verified. Try again.');
  expect(linear.tokenRequests).toHaveLength(0);
});

test('refreshes an expired access token', async ({ page, signIn, linear }) => {
  await signIn({ expiresIn: 0 });
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(row(frame, 'MOB-1')).toBeVisible();
  expect(linear.tokenRequests).toEqual([{ grant_type: 'refresh_token', refresh_token: 'refresh-1', client_id: CLIENT_ID }]);
  expect(linear.operations('GanttProject')[0].authorization).toBe('Bearer access-2');
});

test('asks to reconnect when access was revoked', async ({ page, signIn, linear, worker }) => {
  await signIn();
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(row(frame, 'MOB-1')).toBeVisible();

  linear.accessTokens.clear();
  linear.refreshTokens.clear();
  await frame.locator('#refresh').click();
  await expect(frame.locator('#gate-title')).toHaveText('Connect Linear');
  await expect(frame.locator('#gate-text')).toHaveText('Your Linear access was revoked or expired. Connect Linear again.');
  await expect(frame.locator('.row.issue')).toHaveCount(0);
  expect(await worker.evaluate(() => chrome.storage.local.get())).toEqual({});
});

test('disconnect clears credentials and displayed issues', async ({ page, context, signIn, linear, worker }) => {
  await signIn();
  await page.goto(`https://linear.app${MOBILE}`);
  const frame = await openGantt(page);
  await expect(row(frame, 'MOB-1')).toBeVisible();

  const options = await context.newPage();
  await options.goto(worker.url().replace('src/background.js', 'options.html'));
  await expect(options.locator('#status')).toHaveText('Connected as Maya Chen in Acme.');
  await options.locator('#disconnect').click();
  await expect(options.locator('#status')).toHaveText('Not connected.');
  await expect(options.locator('#connect')).toBeVisible();

  await expect(frame.locator('#gate-title')).toHaveText('Connect Linear');
  await expect(frame.locator('.row.issue')).toHaveCount(0);
  expect(await worker.evaluate(async () => [await chrome.storage.session.get(), await chrome.storage.local.get()])).toEqual([{}, {}]);
  expect(linear.revocations).toEqual([{ token: 'refresh-1', token_type_hint: 'refresh_token' }, { token: 'access-1', token_type_hint: 'access_token' }]);
});
