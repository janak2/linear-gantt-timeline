import { parseProjectURL } from './project-url.js';

const ENDPOINT = 'https://api.linear.app/graphql';
export const PAGE_SIZE = 100;
export const MAX_PAGES = 50;

export class LinearError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    Object.assign(this, details);
  }
}

const ISSUE_FIELDS = `id identifier title url dueDate startedAt completedAt canceledAt
  state { id name type color }
  assignee { id name }
  team { id }
  project { id }
  parent { id identifier title url }`;

export const VIEWER_QUERY = `query GanttViewer {
  viewer { id name }
  organization { id name urlKey }
}`;

export const PROJECT_QUERY = `query GanttProject($slugIds: [String!]!) {
  organization { id name urlKey }
  projects(filter: { slugId: { in: $slugIds } }, first: 2) {
    nodes { id name slugId url projectMilestones(first: 100) { nodes { id name targetDate sortOrder } } }
  }
}`;

export const PROJECT_ISSUES_QUERY = `query GanttProjectIssues($id: String!, $after: String) {
  project(id: $id) {
    issues(first: ${PAGE_SIZE}, after: $after) {
      nodes { ${ISSUE_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export const TEAM_QUERY = `query GanttTeam($id: String!, $after: String) {
  team(id: $id) {
    states(first: ${PAGE_SIZE}) { nodes { id name type color position } }
    members(first: ${PAGE_SIZE}, after: $after) {
      nodes { id name }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export const ISSUE_QUERY = `query GanttIssue($id: String!) {
  issue(id: $id) { ${ISSUE_FIELDS} }
}`;

export const UPDATE_DUE_DATE_MUTATION = `mutation GanttUpdateDueDate($id: String!, $dueDate: TimelessDate) {
  issueUpdate(id: $id, input: { dueDate: $dueDate }) {
    success
    issue { ${ISSUE_FIELDS} }
  }
}`;

export const UPDATE_STATUS_MUTATION = `mutation GanttUpdateStatus($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) {
    success
    issue { ${ISSUE_FIELDS} }
  }
}`;

export const UPDATE_ASSIGNEE_MUTATION = `mutation GanttUpdateAssignee($id: String!, $assigneeId: String) {
  issueUpdate(id: $id, input: { assigneeId: $assigneeId }) {
    success
    issue { ${ISSUE_FIELDS} }
  }
}`;

export async function graphql(token, query, variables = {}, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
      credentials: 'omit',
      signal: AbortSignal.timeout(20_000)
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new LinearError('timeout', 'Linear took too long to respond. Try again.');
    throw new LinearError('network', 'Could not reach Linear. Check your connection and try again.');
  }
  let body = null;
  try { body = await response.json(); } catch { /* Non-JSON error bodies are classified by status below. */ }
  // A parent the user cannot access comes back as null with an error; that is not a failure.
  const errors = (Array.isArray(body?.errors) ? body.errors : []).filter(error => !error?.path?.includes('parent'));
  const codes = errors.map(error => error?.extensions?.code);
  if (response.status === 429 || codes.includes('RATELIMITED')) {
    const retryAfter = Number(response.headers.get('Retry-After')) || null;
    throw new LinearError('rate_limited', `Linear's rate limit was reached. Try again${retryAfter ? ` in ${retryAfter} seconds` : ' shortly'}.`, { retryAfter });
  }
  if (response.status === 401 || codes.includes('AUTHENTICATION_ERROR')) {
    throw new LinearError('auth', 'Linear did not accept the saved sign-in.');
  }
  if (response.status === 403 || codes.includes('FORBIDDEN')) {
    throw new LinearError('forbidden', errors[0]?.extensions?.userPresentableMessage || 'You do not have permission to do this in Linear.');
  }
  if (!response.ok) throw new LinearError('server', `Linear request failed (HTTP ${response.status}). Try again.`);
  if (!body?.data) throw new LinearError('graphql', errors[0]?.extensions?.userPresentableMessage || 'Linear could not complete the request.');
  return { data: body.data, errors };
}

export async function fetchAccount(token, fetcher = fetch) {
  const { data, errors } = await graphql(token, VIEWER_QUERY, {}, fetcher);
  if (errors.length || !data.viewer || !data.organization) throw new LinearError('graphql', 'Linear did not return your account.');
  return { viewer: { id: data.viewer.id, name: data.viewer.name }, organization: data.organization };
}

export async function findProject(token, { workspace, slug, key }, fetcher = fetch) {
  const { data } = await graphql(token, PROJECT_QUERY, { slugIds: [...new Set([slug, key])] }, fetcher);
  if (data.organization?.urlKey !== workspace) {
    throw new LinearError('workspace_mismatch', `Your Linear sign-in is for ${data.organization?.name ?? 'another workspace'}, not this workspace.`);
  }
  const matches = (data.projects?.nodes ?? []).filter(project => {
    const target = parseProjectURL(project?.url);
    return target?.workspace === workspace && target.key === key;
  });
  if (matches.length !== 1) {
    throw new LinearError('project_unavailable', 'This project could not be identified, so no issues are shown.');
  }
  const { id, name, url, projectMilestones } = matches[0];
  const milestones = (projectMilestones?.nodes ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
  return { project: { id, name, url }, milestones, organization: data.organization };
}

export async function fetchProjectIssues(token, projectId, fetcher = fetch) {
  const issues = [];
  let after = null;
  let partial = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, errors } = await graphql(token, PROJECT_ISSUES_QUERY, { id: projectId, after }, fetcher);
    const connection = data.project?.issues;
    if (!connection) throw new LinearError('project_unavailable', 'This project is no longer available.');
    const nodes = connection.nodes ?? [];
    // Issues the user cannot access come back as null entries with errors.
    const visible = nodes.filter(issue => issue?.project?.id === projectId);
    partial ||= errors.length > 0 || visible.length !== nodes.length;
    issues.push(...visible);
    const { hasNextPage, endCursor } = connection.pageInfo ?? {};
    if (!hasNextPage) return { issues, partial, truncated: false };
    if (!endCursor || endCursor === after) throw new LinearError('graphql', 'Linear returned an invalid page of issues.');
    after = endCursor;
  }
  return { issues, partial, truncated: true };
}

// The workflow states and active members of a team, which are the choices for its issues' status and assignee.
export async function fetchTeam(token, id, fetcher = fetch) {
  const members = [];
  let states = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await graphql(token, TEAM_QUERY, { id, after }, fetcher);
    if (!data.team) throw new LinearError('graphql', 'Linear did not return a team for this project.');
    states = data.team.states.nodes;
    members.push(...data.team.members.nodes);
    const { hasNextPage, endCursor } = data.team.members.pageInfo;
    if (!hasNextPage || !endCursor || endCursor === after) break;
    after = endCursor;
  }
  return { id, states, members };
}

export async function loadProject(token, route, fetcher = fetch) {
  const { project, milestones, organization } = await findProject(token, route, fetcher);
  const { issues, partial, truncated } = await fetchProjectIssues(token, project.id, fetcher);
  const teamIds = [...new Set(issues.map(issue => issue.team?.id).filter(Boolean))];
  const teams = await Promise.all(teamIds.map(id => fetchTeam(token, id, fetcher)));
  return { organization, project, milestones, issues, teams, partial, truncated };
}

async function fetchIssue(token, id, fetcher) {
  const missing = new LinearError('not_found', 'This issue is no longer available to you. Refresh the chart.');
  let result;
  try {
    result = await graphql(token, ISSUE_QUERY, { id }, fetcher);
  } catch (error) {
    throw error.code === 'graphql' ? missing : error;
  }
  if (!result.data.issue || result.errors.length) throw missing;
  return result.data.issue;
}

const EDITS = {
  dueDate: { mutation: UPDATE_DUE_DATE_MUTATION, current: issue => issue.dueDate ?? null, name: 'due date' },
  stateId: { mutation: UPDATE_STATUS_MUTATION, current: issue => issue.state?.id ?? null, name: 'status' },
  assigneeId: { mutation: UPDATE_ASSIGNEE_MUTATION, current: issue => issue.assignee?.id ?? null, name: 'assignee' }
};

// Saves only the one field, and only if nobody changed it since the chart loaded.
async function updateField(token, { projectId, issueId, expected }, field, value, fetcher) {
  const edit = EDITS[field];
  const current = await fetchIssue(token, issueId, fetcher);
  if (current.project?.id !== projectId) {
    throw new LinearError('not_found', 'This issue is no longer in this project. Refresh the chart.');
  }
  if (edit.current(current) !== expected) return { conflict: true, issue: current };
  const { data, errors } = await graphql(token, edit.mutation, { id: issueId, [field]: value }, fetcher);
  const payload = data.issueUpdate;
  if (errors.length || !payload?.success || !payload.issue) {
    throw new LinearError('graphql', errors[0]?.extensions?.userPresentableMessage || `Linear did not save the ${edit.name}.`);
  }
  return { conflict: false, issue: payload.issue };
}

export function updateDueDate(token, { dueDate, ...request }, fetcher = fetch) {
  return updateField(token, request, 'dueDate', dueDate, fetcher);
}

export function updateStatus(token, { stateId, ...request }, fetcher = fetch) {
  return updateField(token, request, 'stateId', stateId, fetcher);
}

export function updateAssignee(token, { assigneeId, ...request }, fetcher = fetch) {
  return updateField(token, request, 'assigneeId', assigneeId, fetcher);
}
