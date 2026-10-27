import { isCalendarDate } from './dates.js';
import { parseProjectPath } from './project-url.js';

// Which extension pages may send which requests.
const ALLOWED = {
  'panel.html': new Set(['AUTH_STATUS', 'CONNECT', 'OPEN_OPTIONS', 'LOAD_PROJECT', 'UPDATE_DUE_DATE']),
  'options.html': new Set(['AUTH_STATUS', 'CONNECT', 'DISCONNECT'])
};

const isId = value => typeof value === 'string' && /^[\w-]{1,64}$/.test(value);
const isDueDate = value => value === null || isCalendarDate(value);

function route(message) {
  if (typeof message.workspace !== 'string' || typeof message.slug !== 'string') return null;
  const parsed = parseProjectPath(`/${encodeURIComponent(message.workspace)}/project/${encodeURIComponent(message.slug)}`);
  return parsed && parsed.workspace === message.workspace && parsed.slug === message.slug ? parsed : null;
}

// Returns a normalized request, or throws if the sender or payload is not allowed.
export function validateRequest(message, page) {
  const type = message?.type;
  if (!ALLOWED[page]?.has(type)) throw new Error('This request is not allowed.');
  if (type === 'LOAD_PROJECT') {
    const target = route(message);
    if (!target) throw new Error('This project link is not valid.');
    return { type, route: target };
  }
  if (type === 'UPDATE_DUE_DATE') {
    const target = route(message);
    if (!target || !isId(message.projectId) || !isId(message.issueId) || !isDueDate(message.expected) || !isDueDate(message.dueDate)) {
      throw new Error('This due-date change is not valid.');
    }
    return { type, route: target, projectId: message.projectId, issueId: message.issueId, expected: message.expected, dueDate: message.dueDate };
  }
  return { type };
}

export function senderPage(sender, extensionURL) {
  if (!sender?.url?.startsWith(extensionURL)) return null;
  const page = new URL(sender.url).pathname.slice(1);
  return Object.hasOwn(ALLOWED, page) ? page : null;
}
