// Exchanges the service account key in CWS_SERVICE_ACCOUNT_KEY for a Chrome Web Store access token
// (a signed JWT, no extra Google Cloud roles needed) and hands it to later workflow steps as TOKEN.
import { createSign } from 'node:crypto';
import { appendFile } from 'node:fs/promises';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const key = JSON.parse(process.env.CWS_SERVICE_ACCOUNT_KEY);
const now = Math.floor(Date.now() / 1000);
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
  iss: key.client_email, scope: 'https://www.googleapis.com/auth/chromewebstore', aud: TOKEN_URL, iat: now, exp: now + 3600
})}`;
const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
const response = await fetch(TOKEN_URL, {
  method: 'POST',
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` })
});
const body = await response.json();
if (!response.ok) throw new Error(`Google did not issue an access token: ${body.error_description ?? body.error}`);
console.log(`::add-mask::${body.access_token}`);
await appendFile(process.env.GITHUB_ENV, `TOKEN=${body.access_token}\n`);
console.log(`Got an access token for ${key.client_email}.`);
