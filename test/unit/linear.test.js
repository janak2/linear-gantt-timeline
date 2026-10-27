import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PAGES, PAGE_SIZE, fetchProjectIssues, fetchTeam, findProject, graphql, loadProject, updateAssignee, updateDueDate, updateStatus } from '../../src/linear.js';
import { graphqlServer, json, makeIssue } from './helpers.js';

const route = { workspace: 'acme', slug: 'mobile-app-3f2a1b9c8d7e', key: '3f2a1b9c8d7e' };
const organization = { id: 'org-1', name: 'Acme', urlKey: 'acme' };
const project = { id: 'project-1', name: 'Mobile app', slugId: '3f2a1b9c8d7e', url: 'https://linear.app/acme/project/mobile-app-3f2a1b9c8d7e' };

function pages(issues, size = PAGE_SIZE) {
  return ({ after }) => {
    const start = after ? Number(after.slice(7)) : 0;
    const nodes = issues.slice(start, start + size);
    const next = start + size;
    return json({ data: { project: { issues: { nodes, pageInfo: { hasNextPage: next < issues.length, endCursor: next < issues.length ? `cursor-${next}` : null } } } } });
  };
}

test('sends a bearer token to the fixed endpoint without cookies', async () => {
  const { fetcher, calls } = graphqlServer({ GanttViewer: () => json({ data: { viewer: { id: 'u' }, organization } }) });
  await graphql('token-1', 'query GanttViewer { viewer { id } }', {}, fetcher);
  assert.equal(calls[0].url, 'https://api.linear.app/graphql');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token-1');
  assert.equal(calls[0].options.credentials, 'omit');
});

test('classifies Linear errors', async () => {
  const fail = (response, code) => assert.rejects(graphql('t', '{}', {}, async () => response), error => error.code === code);
  await fail(json({ errors: [{ message: 'x' }] }, 401), 'auth');
  await fail(json({ errors: [{ extensions: { code: 'AUTHENTICATION_ERROR' } }] }, 400), 'auth');
  await fail(json({ errors: [{ extensions: { code: 'FORBIDDEN', userPresentableMessage: 'No access to team' } }] }, 400), 'forbidden');
  await fail(json({ errors: [{ extensions: { code: 'RATELIMITED' } }] }, 400), 'rate_limited');
  await fail(new Response('oops', { status: 502 }), 'server');
  await fail(json({ errors: [{ message: 'Bad query' }] }), 'graphql');
  await assert.rejects(graphql('t', '{}', {}, async () => { throw new TypeError('Failed to fetch'); }), { code: 'network' });
  await assert.rejects(graphql('t', '{}', {}, async () => { throw new DOMException('timed out', 'TimeoutError'); }), { code: 'timeout' });
});

test('reports when to retry after a rate limit', async () => {
  const response = json({ errors: [{ extensions: { code: 'RATELIMITED' } }] }, 429, { 'Retry-After': '30' });
  await assert.rejects(graphql('t', '{}', {}, async () => response), error => error.code === 'rate_limited' && error.retryAfter === 30 && /30 seconds/.test(error.message));
});

test('finds exactly the project on the page', async () => {
  const { fetcher, calls } = graphqlServer({ GanttProject: () => json({ data: { organization, projects: { nodes: [project] } } }) });
  assert.deepEqual((await findProject('t', route, fetcher)).project, { id: 'project-1', name: 'Mobile app', url: project.url });
  assert.deepEqual(calls[0].variables.slugIds, ['mobile-app-3f2a1b9c8d7e', '3f2a1b9c8d7e']);
});

test('refuses to show issues when the project cannot be identified', async () => {
  const other = { ...project, id: 'project-2', url: 'https://linear.app/acme/project/other-aaaaaaaaaaaa' };
  const elsewhere = { ...project, url: 'https://linear.app/beta/project/mobile-app-3f2a1b9c8d7e' };
  for (const nodes of [[], [other], [elsewhere], [project, { ...project, id: 'project-3' }]]) {
    const { fetcher } = graphqlServer({ GanttProject: () => json({ data: { organization, projects: { nodes } } }) });
    await assert.rejects(findProject('t', route, fetcher), { code: 'project_unavailable' });
  }
});

test('refuses a project from a different workspace than the sign-in', async () => {
  const { fetcher } = graphqlServer({ GanttProject: () => json({ data: { organization: { ...organization, urlKey: 'beta', name: 'Beta' }, projects: { nodes: [project] } } }) });
  await assert.rejects(findProject('t', route, fetcher), { code: 'workspace_mismatch' });
});

test('loads a project with 1,000 issues across pages', async () => {
  const issues = Array.from({ length: 1000 }, (_, n) => makeIssue(n));
  const { fetcher, calls } = graphqlServer({
    GanttProject: () => json({ data: { organization, projects: { nodes: [project] } } }),
    GanttProjectIssues: pages(issues)
  });
  const result = await loadProject('t', route, fetcher);
  assert.equal(result.issues.length, 1000);
  assert.deepEqual(new Set(result.issues.map(issue => issue.id)).size, 1000);
  assert.equal(result.truncated, false);
  assert.equal(result.partial, false);
  const issueCalls = calls.filter(call => call.operation === 'GanttProjectIssues');
  assert.equal(issueCalls.length, 10);
  assert.deepEqual(issueCalls.slice(0, 3).map(call => call.variables.after), [null, 'cursor-100', 'cursor-200']);
  assert.ok(issueCalls.every(call => call.variables.id === 'project-1'));
});

test('handles empty projects', async () => {
  const { fetcher } = graphqlServer({ GanttProjectIssues: pages([]) });
  assert.deepEqual(await fetchProjectIssues('t', 'project-1', fetcher), { issues: [], partial: false, truncated: false });
});

test('skips restricted issues and says some are hidden', async () => {
  const { fetcher } = graphqlServer({
    GanttProjectIssues: () => json({
      data: { project: { issues: { nodes: [makeIssue(1), null, makeIssue(3)], pageInfo: { hasNextPage: false, endCursor: null } } } },
      errors: [{ message: 'Forbidden', path: ['project', 'issues', 'nodes', 1] }]
    })
  });
  const result = await fetchProjectIssues('t', 'project-1', fetcher);
  assert.deepEqual(result.issues.map(issue => issue.id), ['issue-1', 'issue-3']);
  assert.equal(result.partial, true);
});

test('treats a parent the user cannot access as no parent', async () => {
  const parentError = path => ({ message: 'Forbidden', extensions: { code: 'FORBIDDEN' }, path });
  const { fetcher } = graphqlServer({
    GanttProjectIssues: () => json({
      data: { project: { issues: { nodes: [makeIssue(1, { parent: null })], pageInfo: { hasNextPage: false, endCursor: null } } } },
      errors: [parentError(['project', 'issues', 'nodes', 0, 'parent'])]
    })
  });
  assert.deepEqual(await fetchProjectIssues('t', 'project-1', fetcher), { issues: [makeIssue(1, { parent: null })], partial: false, truncated: false });

  const save = graphqlServer({
    GanttIssue: () => json({ data: { issue: makeIssue(1, { parent: null }) }, errors: [parentError(['issue', 'parent'])] }),
    GanttUpdateDueDate: () => json({ data: { issueUpdate: { success: true, issue: makeIssue(1, { parent: null, dueDate: '2026-11-03' }) } }, errors: [parentError(['issueUpdate', 'issue', 'parent'])] })
  });
  const result = await updateDueDate('t', { projectId: 'project-1', issueId: 'issue-1', expected: null, dueDate: '2026-11-03' }, save.fetcher);
  assert.equal(result.issue.dueDate, '2026-11-03');
});

test('stops on a repeated cursor and discloses the page cap', async () => {
  const stuck = graphqlServer({ GanttProjectIssues: () => json({ data: { project: { issues: { nodes: [makeIssue(1)], pageInfo: { hasNextPage: true, endCursor: 'same' } } } } }) });
  await assert.rejects(fetchProjectIssues('t', 'project-1', stuck.fetcher), { code: 'graphql' });
  const endless = graphqlServer({ GanttProjectIssues: pages(Array.from({ length: (MAX_PAGES + 1) * 2 }, (_, n) => makeIssue(n)), 2) });
  const result = await fetchProjectIssues('t', 'project-1', endless.fetcher);
  assert.equal(result.truncated, true);
  assert.equal(endless.calls.length, MAX_PAGES);
});

function issueServer(current, mutation = variables => json({ data: { issueUpdate: { success: true, issue: { ...current, dueDate: variables.dueDate } } } })) {
  return graphqlServer({ GanttIssue: () => json({ data: { issue: current } }), GanttUpdateDueDate: mutation });
}

test('saves only the due date', async () => {
  const { fetcher, calls } = issueServer(makeIssue(1, { dueDate: '2026-10-27' }));
  const result = await updateDueDate('t', { projectId: 'project-1', issueId: 'issue-1', expected: '2026-10-27', dueDate: '2026-11-03' }, fetcher);
  assert.deepEqual(result, { conflict: false, issue: makeIssue(1, { dueDate: '2026-11-03' }) });
  const mutation = calls.find(call => call.operation === 'GanttUpdateDueDate');
  assert.deepEqual(mutation.variables, { id: 'issue-1', dueDate: '2026-11-03' });
  assert.match(mutation.query, /input: \{ dueDate: \$dueDate \}/);
});

test('creates and clears due dates', async () => {
  const create = issueServer(makeIssue(1));
  assert.equal((await updateDueDate('t', { projectId: 'project-1', issueId: 'issue-1', expected: null, dueDate: '2026-11-03' }, create.fetcher)).issue.dueDate, '2026-11-03');
  const clear = issueServer(makeIssue(1, { dueDate: '2026-11-03' }));
  const result = await updateDueDate('t', { projectId: 'project-1', issueId: 'issue-1', expected: '2026-11-03', dueDate: null }, clear.fetcher);
  assert.equal(result.issue.dueDate, null);
  assert.equal(clear.calls.at(-1).variables.dueDate, null);
});

test('does not overwrite a due date someone else changed', async () => {
  const { fetcher, calls } = issueServer(makeIssue(1, { dueDate: '2026-11-10' }));
  const result = await updateDueDate('t', { projectId: 'project-1', issueId: 'issue-1', expected: '2026-10-27', dueDate: '2026-11-03' }, fetcher);
  assert.equal(result.conflict, true);
  assert.equal(result.issue.dueDate, '2026-11-10');
  assert.ok(calls.every(call => call.operation !== 'GanttUpdateDueDate'));
});

test('does not edit issues outside the project', async () => {
  const { fetcher, calls } = issueServer(makeIssue(1, { project: { id: 'project-9' } }));
  await assert.rejects(updateDueDate('t', { projectId: 'project-1', issueId: 'issue-1', expected: null, dueDate: '2026-11-03' }, fetcher), { code: 'not_found' });
  assert.equal(calls.length, 1);
});

test('reports failed and forbidden writes', async () => {
  const forbidden = issueServer(makeIssue(1), () => json({ errors: [{ extensions: { code: 'FORBIDDEN', userPresentableMessage: 'You cannot edit issues in this team.' } }] }, 400));
  await assert.rejects(updateDueDate('t', { projectId: 'project-1', issueId: 'issue-1', expected: null, dueDate: '2026-11-03' }, forbidden.fetcher), { code: 'forbidden', message: 'You cannot edit issues in this team.' });
  const unsaved = issueServer(makeIssue(1), () => json({ data: { issueUpdate: { success: false, issue: null } } }));
  await assert.rejects(updateDueDate('t', { projectId: 'project-1', issueId: 'issue-1', expected: null, dueDate: '2026-11-03' }, unsaved.fetcher), { code: 'graphql' });
  const missing = graphqlServer({ GanttIssue: () => json({ data: null, errors: [{ message: 'Entity not found' }] }) });
  await assert.rejects(updateDueDate('t', { projectId: 'project-1', issueId: 'issue-1', expected: null, dueDate: '2026-11-03' }, missing.fetcher), { code: 'not_found' });
});

const todo = { id: 'todo', name: 'Todo', type: 'unstarted', color: '#e2e2e2' };
const done = { id: 'done', name: 'Done', type: 'completed', color: '#5e6ad2' };
const maya = { id: 'user-maya', name: 'Maya Chen' };
const teamData = (states, members, pageInfo = { hasNextPage: false, endCursor: null }) => json({ data: { team: { states: { nodes: states }, members: { nodes: members, pageInfo } } } });

test("loads a team's workflow states and every page of its members", async () => {
  const members = Array.from({ length: 5 }, (_, n) => ({ id: `user-${n}`, name: `User ${n}` }));
  const { fetcher, calls } = graphqlServer({
    GanttTeam: ({ after }) => {
      const start = after ? Number(after.slice(7)) : 0;
      const more = start + 2 < members.length;
      return teamData([todo, done], members.slice(start, start + 2), { hasNextPage: more, endCursor: more ? `cursor-${start + 2}` : null });
    }
  });
  assert.deepEqual(await fetchTeam('t', 'team-1', fetcher), { id: 'team-1', states: [todo, done], members });
  assert.deepEqual(calls.map(call => call.variables), [{ id: 'team-1', after: null }, { id: 'team-1', after: 'cursor-2' }, { id: 'team-1', after: 'cursor-4' }]);
});

test("loads each of the project's teams once", async () => {
  const issues = [makeIssue(1, { team: { id: 'team-1' } }), makeIssue(2, { team: { id: 'team-2' } }), makeIssue(3, { team: { id: 'team-1' } })];
  const { fetcher, calls } = graphqlServer({
    GanttProject: () => json({ data: { organization, projects: { nodes: [project] } } }),
    GanttProjectIssues: pages(issues),
    GanttTeam: ({ id }) => teamData([{ ...todo, id: `${id}-todo` }], [maya])
  });
  const result = await loadProject('t', route, fetcher);
  assert.deepEqual(result.teams, [
    { id: 'team-1', states: [{ ...todo, id: 'team-1-todo' }], members: [maya] },
    { id: 'team-2', states: [{ ...todo, id: 'team-2-todo' }], members: [maya] }
  ]);
  assert.deepEqual(calls.filter(call => call.operation === 'GanttTeam').map(call => call.variables.id), ['team-1', 'team-2']);
});

function editServer(current, operation, changes = {}) {
  return graphqlServer({
    GanttIssue: () => json({ data: { issue: current } }),
    [operation]: () => json({ data: { issueUpdate: { success: true, issue: { ...current, ...changes } } } })
  });
}

test('saves only the status', async () => {
  const { fetcher, calls } = editServer(makeIssue(1, { state: todo }), 'GanttUpdateStatus', { state: done });
  const result = await updateStatus('t', { projectId: 'project-1', issueId: 'issue-1', expected: 'todo', stateId: 'done' }, fetcher);
  assert.deepEqual(result, { conflict: false, issue: makeIssue(1, { state: done }) });
  const mutation = calls.find(call => call.operation === 'GanttUpdateStatus');
  assert.deepEqual(mutation.variables, { id: 'issue-1', stateId: 'done' });
  assert.match(mutation.query, /input: \{ stateId: \$stateId \}/);
});

test('assigns and unassigns issues', async () => {
  const assign = editServer(makeIssue(1), 'GanttUpdateAssignee', { assignee: maya });
  const assigned = await updateAssignee('t', { projectId: 'project-1', issueId: 'issue-1', expected: null, assigneeId: 'user-maya' }, assign.fetcher);
  assert.deepEqual(assigned, { conflict: false, issue: makeIssue(1, { assignee: maya }) });
  assert.deepEqual(assign.calls.at(-1).variables, { id: 'issue-1', assigneeId: 'user-maya' });
  assert.match(assign.calls.at(-1).query, /input: \{ assigneeId: \$assigneeId \}/);

  const unassign = editServer(makeIssue(1, { assignee: maya }), 'GanttUpdateAssignee', { assignee: null });
  const result = await updateAssignee('t', { projectId: 'project-1', issueId: 'issue-1', expected: 'user-maya', assigneeId: null }, unassign.fetcher);
  assert.equal(result.issue.assignee, null);
  assert.deepEqual(unassign.calls.at(-1).variables, { id: 'issue-1', assigneeId: null });
});

test('does not overwrite a status or assignee someone else changed', async () => {
  const status = editServer(makeIssue(1, { state: done }), 'GanttUpdateStatus');
  const result = await updateStatus('t', { projectId: 'project-1', issueId: 'issue-1', expected: 'todo', stateId: 'canceled' }, status.fetcher);
  assert.deepEqual(result, { conflict: true, issue: makeIssue(1, { state: done }) });
  const assignee = editServer(makeIssue(1, { assignee: maya }), 'GanttUpdateAssignee');
  assert.equal((await updateAssignee('t', { projectId: 'project-1', issueId: 'issue-1', expected: null, assigneeId: 'user-sam' }, assignee.fetcher)).conflict, true);
  assert.ok([...status.calls, ...assignee.calls].every(call => call.operation === 'GanttIssue'));
});

test('refuses status and assignee changes outside the project and reports failed writes', async () => {
  const elsewhere = editServer(makeIssue(1, { project: { id: 'project-9' } }), 'GanttUpdateAssignee');
  await assert.rejects(updateAssignee('t', { projectId: 'project-1', issueId: 'issue-1', expected: null, assigneeId: 'user-maya' }, elsewhere.fetcher), { code: 'not_found' });
  assert.equal(elsewhere.calls.length, 1);

  const unsaved = graphqlServer({
    GanttIssue: () => json({ data: { issue: makeIssue(1) } }),
    GanttUpdateStatus: () => json({ data: { issueUpdate: { success: false, issue: null } } }),
    GanttUpdateAssignee: () => json({ data: { issueUpdate: { success: false, issue: null } } })
  });
  await assert.rejects(updateStatus('t', { projectId: 'project-1', issueId: 'issue-1', expected: 'todo', stateId: 'done' }, unsaved.fetcher), { code: 'graphql', message: 'Linear did not save the status.' });
  await assert.rejects(updateAssignee('t', { projectId: 'project-1', issueId: 'issue-1', expected: null, assigneeId: 'user-maya' }, unsaved.fetcher), { code: 'graphql', message: 'Linear did not save the assignee.' });
});
