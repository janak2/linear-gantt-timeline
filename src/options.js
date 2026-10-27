const $ = id => document.getElementById(id);

async function send(type) {
  const response = await chrome.runtime.sendMessage({ type });
  if (!response?.ok) throw new Error(response?.error?.message || 'Something went wrong.');
  return response.data;
}

function show(status) {
  const { account } = status;
  $('status').classList.remove('error');
  $('status').textContent = account
    ? `Connected as ${account.viewer.name} in ${account.organization.name}.`
    : status.configured ? 'Not connected.' : 'Sign-in is not set up: this build has no Linear OAuth client ID.';
  $('connect').hidden = Boolean(account) || !status.configured;
  $('disconnect').hidden = !account;
}

function fail(error) {
  $('status').textContent = error.message;
  $('status').classList.add('error');
}

async function run(button, action) {
  button.disabled = true;
  try {
    await action();
    show(await send('AUTH_STATUS'));
  } catch (error) {
    fail(error);
  } finally {
    button.disabled = false;
  }
}

$('connect').addEventListener('click', () => run($('connect'), () => send('CONNECT')));
$('disconnect').addEventListener('click', () => run($('disconnect'), () => send('DISCONNECT')));
send('AUTH_STATUS').then(show, fail);
