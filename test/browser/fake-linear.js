import { readFileSync } from 'node:fs';

export const PAGE = readFileSync(new URL('./fixtures/linear.html', import.meta.url), 'utf8');
export const CLIENT_ID = 'test-client';
export const MOBILE = '/acme/project/mobile-app-3f2a1b9c8d7e/overview';
export const WEBSITE = '/acme/project/website-a1b2c3d4e5f6/overview';

const DAY = 86_400_000;
export const today = () => new Date().toISOString().slice(0, 10);
export const shift = (date, days) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);

function issue(n, prefix, projectId, fields) {
  return {
    id: `${projectId}-issue-${n}`,
    identifier: `${prefix}-${n}`,
    title: `Issue ${n}`,
    url: `https://linear.app/acme/issue/${prefix}-${n}`,
    dueDate: null,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    state: { id: 'todo', name: 'Todo', type: 'unstarted', color: '#9ea0aa' },
    assignee: null,
    team: { id: prefix === 'WEB' ? 'team-web' : 'team-mob' },
    project: { id: projectId },
    parent: null,
    ...fields
  };
}

const inProgress = { id: 'started', name: 'In Progress', type: 'started', color: '#f2c94c' };
const done = { id: 'done', name: 'Done', type: 'completed', color: '#5e6ad2' };
const maya = { id: 'user-maya', name: 'Maya Chen' };
const sam = { id: 'user-sam', name: 'Sam Ortiz' };
const priya = { id: 'user-priya', name: 'Priya Nair' };
const leo = { id: 'user-leo', name: 'Leo Brandt' };

// A stateful stand-in for Linear's GraphQL API and OAuth endpoints.
export class FakeLinear {
  constructor() {
    const t = today();
    this.organization = { id: 'org-acme', name: 'Acme', urlKey: 'acme' };
    this.viewer = { id: 'user-maya', name: 'Maya Chen' };
    this.projects = [
      {
        id: 'project-mobile', name: 'Mobile app', slugId: '3f2a1b9c8d7e', url: 'https://linear.app/acme/project/mobile-app-3f2a1b9c8d7e',
        projectMilestones: { nodes: [
          { id: 'milestone-launch', name: 'Launch', targetDate: null, sortOrder: 2 },
          { id: 'milestone-beta', name: 'Beta', targetDate: shift(t, 14), sortOrder: 1 }
        ] }
      },
      { id: 'project-website', name: 'Website', slugId: 'a1b2c3d4e5f6', url: 'https://linear.app/acme/project/website-a1b2c3d4e5f6' }
    ];
    this.issues = [
      issue(1, 'MOB', 'project-mobile', { title: 'Build sync engine', startedAt: `${shift(t, -5)}T09:30:00.000Z`, dueDate: shift(t, 5), state: inProgress, assignee: maya }),
      issue(2, 'MOB', 'project-mobile', { title: 'Design review', dueDate: shift(t, 10), assignee: sam }),
      issue(3, 'MOB', 'project-mobile', { title: 'Write onboarding docs' }),
      issue(4, 'MOB', 'project-mobile', { title: 'Ship beta', startedAt: `${shift(t, -2)}T12:00:00.000Z`, dueDate: shift(t, 12), state: inProgress, assignee: sam }),
      issue(5, 'MOB', 'project-mobile', { title: 'Set up CI', startedAt: `${shift(t, -20)}T08:00:00.000Z`, dueDate: shift(t, -10), completedAt: `${shift(t, -11)}T17:00:00.000Z`, state: done, assignee: maya }),
      issue(6, 'MOB', 'project-mobile', { title: 'Fix login crash', dueDate: shift(t, -3), assignee: maya }),
      issue(1, 'WEB', 'project-website', { title: 'Landing page', dueDate: shift(t, 3), assignee: sam })
    ];
    for (const [child, parent] of [['MOB-2', 'WEB-1'], ['MOB-3', 'MOB-1'], ['MOB-4', 'MOB-1'], ['MOB-6', 'WEB-1']]) {
      const { id, identifier, title, url } = this.issue(parent);
      this.issue(child).parent = { id, identifier, title, url };
    }
    this.teams = [
      {
        id: 'team-mob',
        states: [
          { id: 'canceled', name: 'Canceled', type: 'canceled', color: '#95a2b3', position: 0 },
          { ...done, position: 0 },
          { id: 'review', name: 'In Review', type: 'started', color: '#4cb782', position: 1 },
          { ...inProgress, position: 0 },
          { id: 'todo', name: 'Todo', type: 'unstarted', color: '#9ea0aa', position: 0 },
          { id: 'backlog', name: 'Backlog', type: 'backlog', color: '#bec2c8', position: 0 }
        ],
        members: [sam, maya, priya]
      },
      {
        id: 'team-web',
        states: [
          { id: 'web-todo', name: 'Todo', type: 'unstarted', color: '#9ea0aa', position: 0 },
          { id: 'web-started', name: 'Building', type: 'started', color: '#f2c94c', position: 0 },
          { id: 'web-done', name: 'Shipped', type: 'completed', color: '#5e6ad2', position: 0 }
        ],
        members: [sam, leo]
      }
    ];
    this.accessTokens = new Set(['access-1']);
    this.refreshTokens = new Set(['refresh-1']);
    this.calls = [];
    this.tokenRequests = [];
    this.revocations = [];
    this.overrides = new Map(); // operation -> queued responses
  }

  get account() {
    return { viewer: this.viewer, organization: this.organization };
  }

  issue(identifier) {
    return this.issues.find(item => item.identifier === identifier);
  }

  addIssues(projectId, count) {
    for (let n = 1; n <= count; n++) this.issues.push(issue(100 + n, 'BIG', projectId, { title: `Generated issue ${n}`, dueDate: shift(today(), n % 60) }));
  }

  respondOnce(operation, response) {
    this.overrides.set(operation, [...(this.overrides.get(operation) ?? []), response]);
  }

  operations(name) {
    return this.calls.filter(call => call.operation === name);
  }

  async route(route) {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (body, status = 200, headers = {}) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/oauth/token') {
      const params = Object.fromEntries(new URLSearchParams(request.postData()));
      this.tokenRequests.push(params);
      const valid = params.client_id === CLIENT_ID && (
        (params.grant_type === 'authorization_code' && params.code === 'code-ok' && params.code_verifier) ||
        (params.grant_type === 'refresh_token' && this.refreshTokens.delete(params.refresh_token)));
      if (!valid) return reply({ error: 'invalid_grant' }, 400);
      const n = this.tokenRequests.length + 1;
      this.accessTokens.add(`access-${n}`);
      this.refreshTokens.add(`refresh-${n}`);
      return reply({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 86399, token_type: 'Bearer', scope: 'read write' });
    }
    if (url.pathname === '/oauth/revoke') {
      this.revocations.push(Object.fromEntries(new URLSearchParams(request.postData())));
      return route.fulfill({ status: 200, body: '' });
    }
    const { query, variables } = JSON.parse(request.postData());
    const operation = /(?:query|mutation) (\w+)/.exec(query)[1];
    this.calls.push({ operation, variables, authorization: request.headers().authorization });
    const token = request.headers().authorization?.replace(/^Bearer /, '');
    if (!this.accessTokens.has(token)) return reply({ errors: [{ message: 'Authentication required', extensions: { code: 'AUTHENTICATION_ERROR' } }] }, 401);
    const queued = this.overrides.get(operation);
    if (queued?.length) {
      const { status = 200, body, headers } = queued.shift();
      return reply(body, status, headers);
    }
    return reply(this.handle(operation, variables));
  }

  handle(operation, variables) {
    switch (operation) {
      case 'GanttViewer':
        return { data: this.account };
      case 'GanttProject':
        return { data: { organization: this.organization, projects: { nodes: this.projects.filter(project => variables.slugIds.includes(project.slugId)) } } };
      case 'GanttProjectIssues': {
        const all = this.issues.filter(item => item.project.id === variables.id);
        const start = variables.after ? Number(variables.after.split(':')[1]) : 0;
        const nodes = all.slice(start, start + 100);
        const more = start + 100 < all.length;
        return { data: { project: { issues: { nodes: structuredClone(nodes), pageInfo: { hasNextPage: more, endCursor: more ? `cursor:${start + 100}` : null } } } } };
      }
      case 'GanttTeam': {
        const { states, members } = this.teams.find(team => team.id === variables.id);
        return { data: { team: { states: { nodes: structuredClone(states) }, members: { nodes: structuredClone(members), pageInfo: { hasNextPage: false, endCursor: null } } } } };
      }
      case 'GanttIssue': {
        const found = this.issues.find(item => item.id === variables.id);
        return found ? { data: { issue: structuredClone(found) } } : { data: null, errors: [{ message: 'Entity not found' }] };
      }
      case 'GanttUpdateDueDate': {
        const found = this.issues.find(item => item.id === variables.id);
        found.dueDate = variables.dueDate;
        return { data: { issueUpdate: { success: true, issue: structuredClone(found) } } };
      }
      case 'GanttUpdateStatus': {
        const found = this.issues.find(item => item.id === variables.id);
        const { id, name, type, color } = this.teams.flatMap(team => team.states).find(item => item.id === variables.stateId);
        found.state = { id, name, type, color };
        return { data: { issueUpdate: { success: true, issue: structuredClone(found) } } };
      }
      case 'GanttUpdateAssignee': {
        const found = this.issues.find(item => item.id === variables.id);
        found.assignee = variables.assigneeId ? structuredClone(this.teams.flatMap(team => team.members).find(user => user.id === variables.assigneeId)) : null;
        return { data: { issueUpdate: { success: true, issue: structuredClone(found) } } };
      }
    }
    throw new Error(`Unexpected operation ${operation}`);
  }
}
