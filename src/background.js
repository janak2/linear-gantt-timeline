import { LINEAR_CLIENT_ID, OAUTH_SCOPES } from './config.js';
import { createAuth } from './auth.js';
import { LinearError, loadProject, updateDueDate } from './linear.js';
import { senderPage, validateRequest } from './messages.js';

const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

const auth = createAuth({
  clientId: LINEAR_CLIENT_ID,
  scopes: OAUTH_SCOPES,
  session: chrome.storage.session,
  local: chrome.storage.local,
  launchWebAuthFlow: details => chrome.identity.launchWebAuthFlow(details),
  redirectURL: () => chrome.identity.getRedirectURL('linear'),
  fetcher: (...args) => fetch(...args),
  onSignedOut: () => chrome.runtime.sendMessage({ type: 'SIGNED_OUT' }).catch(() => {})
});

async function requireWorkspace(workspace) {
  const { account } = await auth.status();
  if (!account) throw new LinearError('signed_out', 'Connect Linear to see this project.');
  if (account.organization.urlKey !== workspace) {
    throw new LinearError('workspace_mismatch', `You are connected to ${account.organization.name}. Connect this workspace to see its projects.`);
  }
}

async function handle(request) {
  await ready;
  switch (request.type) {
    case 'AUTH_STATUS': return auth.status();
    case 'CONNECT': return auth.connect();
    case 'DISCONNECT': return auth.disconnect();
    case 'OPEN_OPTIONS': return chrome.runtime.openOptionsPage();
    case 'LOAD_PROJECT':
      await requireWorkspace(request.route.workspace);
      return auth.withAccessToken(token => loadProject(token, request.route));
    case 'UPDATE_DUE_DATE':
      await requireWorkspace(request.route.workspace);
      return auth.withAccessToken(token => updateDueDate(token, request));
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const page = sender.id === chrome.runtime.id ? senderPage(sender, chrome.runtime.getURL('')) : null;
  if (!page) return false;
  let request;
  try {
    request = validateRequest(message, page);
  } catch (error) {
    respond({ ok: false, error: { code: 'invalid', message: error.message } });
    return false;
  }
  handle(request).then(
    data => respond({ ok: true, data: data ?? null }),
    error => respond({ ok: false, error: { code: error.code ?? 'error', message: error.message || 'Something went wrong.' } })
  );
  return true;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
