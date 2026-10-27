import test from 'node:test';
import assert from 'node:assert/strict';
import { senderPage, validateRequest } from '../../src/messages.js';

const route = { workspace: 'acme', slug: 'mobile-app-3f2a1b9c8d7e' };
const update = { type: 'UPDATE_DUE_DATE', ...route, projectId: 'project-1', issueId: 'issue-1', expected: '2026-10-27', dueDate: '2026-10-30' };

test('the chart may load its project and update due dates', () => {
  assert.deepEqual(validateRequest({ type: 'LOAD_PROJECT', ...route }, 'panel.html').route.key, '3f2a1b9c8d7e');
  const request = validateRequest({ ...update, extra: 'ignored' }, 'panel.html');
  assert.deepEqual(Object.keys(request).sort(), ['dueDate', 'expected', 'issueId', 'projectId', 'route', 'type']);
  assert.equal(validateRequest({ ...update, expected: null, dueDate: null }, 'panel.html').dueDate, null);
});

test('rejects malformed due-date changes', () => {
  for (const change of [{ dueDate: '2026-02-30' }, { dueDate: '2026-10-30T00:00:00Z' }, { expected: undefined }, { issueId: { id: 1 } }, { projectId: '' }, { slug: '../x' }, { workspace: 'a/b' }]) {
    assert.throws(() => validateRequest({ ...update, ...change }, 'panel.html'), /not valid/, JSON.stringify(change));
  }
});

test('the chart may change statuses and assignees', () => {
  const status = { type: 'UPDATE_STATUS', ...route, projectId: 'project-1', issueId: 'issue-1', expected: 'state-1', stateId: 'state-2' };
  assert.deepEqual(Object.keys(validateRequest({ ...status, extra: 'ignored' }, 'panel.html')).sort(), ['expected', 'issueId', 'projectId', 'route', 'stateId', 'type']);
  const assignee = { type: 'UPDATE_ASSIGNEE', ...route, projectId: 'project-1', issueId: 'issue-1', expected: null, assigneeId: 'user-1' };
  assert.equal(validateRequest(assignee, 'panel.html').assigneeId, 'user-1');
  assert.equal(validateRequest({ ...assignee, expected: 'user-1', assigneeId: null }, 'panel.html').assigneeId, null);
  assert.throws(() => validateRequest({ ...status, stateId: null }, 'panel.html'), /status change is not valid/);
  assert.throws(() => validateRequest({ ...assignee, assigneeId: 'a b' }, 'panel.html'), /assignee change is not valid/);
  assert.throws(() => validateRequest({ ...assignee, expected: undefined }, 'panel.html'), /assignee change is not valid/);
  assert.throws(() => validateRequest(assignee, 'options.html'), /not allowed/);
});

test('each page may only send its own requests', () => {
  assert.throws(() => validateRequest({ type: 'DISCONNECT' }, 'panel.html'), /not allowed/);
  assert.throws(() => validateRequest({ type: 'LOAD_PROJECT', ...route }, 'options.html'), /not allowed/);
  assert.throws(() => validateRequest({ type: 'READ_TOKENS' }, 'panel.html'), /not allowed/);
  assert.throws(() => validateRequest(null, 'panel.html'), /not allowed/);
  assert.deepEqual(validateRequest({ type: 'DISCONNECT' }, 'options.html'), { type: 'DISCONNECT' });
});

test('identifies extension pages by URL', () => {
  const base = 'chrome-extension://abc/';
  assert.equal(senderPage({ url: `${base}panel.html?workspace=acme` }, base), 'panel.html');
  assert.equal(senderPage({ url: `${base}options.html` }, base), 'options.html');
  assert.equal(senderPage({ url: `${base}other.html` }, base), null);
  assert.equal(senderPage({ url: 'https://linear.app/acme' }, base), null);
  assert.equal(senderPage({}, base), null);
});
