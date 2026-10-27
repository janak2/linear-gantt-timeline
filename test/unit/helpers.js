export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export class MemoryArea {
  constructor(data = {}) {
    this.data = structuredClone(data);
  }

  async get(keys) {
    const list = keys === undefined ? Object.keys(this.data) : [keys].flat();
    return Object.fromEntries(list.filter(key => key in this.data).map(key => [key, structuredClone(this.data[key])]));
  }

  async set(items) {
    Object.assign(this.data, structuredClone(items));
  }

  async remove(keys) {
    for (const key of [keys].flat()) delete this.data[key];
  }
}

export function makeIssue(n, overrides = {}) {
  return {
    id: `issue-${n}`,
    identifier: `ENG-${n}`,
    title: `Issue ${n}`,
    url: `https://linear.app/acme/issue/ENG-${n}`,
    dueDate: null,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    state: { id: 'todo', name: 'Todo', type: 'unstarted', color: '#e2e2e2' },
    assignee: null,
    project: { id: 'project-1' },
    ...overrides
  };
}

// Routes GraphQL requests by operation name and records them.
export function graphqlServer(handlers) {
  const calls = [];
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body);
    const operation = /(?:query|mutation) (\w+)/.exec(body.query)[1];
    calls.push({ url, options, operation, variables: body.variables, query: body.query });
    const handler = handlers[operation];
    if (!handler) throw new Error(`Unexpected operation ${operation}`);
    return handler(body.variables, options);
  };
  return { fetcher, calls };
}
