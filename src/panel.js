import { dateFromDay, dayFromDate, formatDay, isCalendarDate, localDay } from './dates.js';
import { SCALES, chartRange, chartWidth, dayToX, issueSchedule, ticks, xToDay } from './timeline.js';

const LINEAR_ORIGIN = 'https://linear.app';
const LABEL_WIDTH = 400;
const STATE_ORDER = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'];
const SAVED_MS = 2500;
const INPUT_DELAY_MS = 700;
const SIGNED_OUT = new Set(['signed_out', 'revoked']);

const params = new URLSearchParams(location.search);
const route = { workspace: params.get('workspace') ?? '', slug: params.get('slug') ?? '' };
const $ = id => document.getElementById(id);
const chart = $('chart');

const state = {
  project: null,
  issues: [],
  milestones: [],
  teams: new Map(), // team id -> { states, members }
  scale: 'week',
  range: null,
  renderedScale: null,
  saves: new Map(), // issue id -> { status: 'pending' | 'saved' | 'error', changes?, message? }
  collapsed: new Set(), // section titles, and `${section}/${assignee id or 'none'}` for assignee groups
  groupBy: 'none',
  loadId: 0,
  dragging: false,
  renderQueued: false
};

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
}

function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'className') node.className = value;
    else if (name === 'style') for (const [key, style] of Object.entries(value)) node.style.setProperty(key, style);
    else node.setAttribute(name, value === true ? '' : value);
  }
  node.append(...children);
  return node;
}

async function send(type, data = {}) {
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type, ...data });
  } catch {
    throw Object.assign(new Error('The extension was updated. Reload this Linear tab.'), { code: 'disconnected' });
  }
  if (!response?.ok) throw Object.assign(new Error(response?.error?.message || 'Something went wrong.'), { code: response?.error?.code });
  return response.data;
}

function notice(text = '', error = false) {
  $('notice').hidden = !text;
  $('notice').textContent = text;
  $('notice').classList.toggle('error', error);
}

function setControls(enabled) {
  for (const control of document.querySelectorAll('.toolbar input, .toolbar select, .toolbar button:not(#refresh)')) control.disabled = !enabled;
}

function showGate(title, text, action = null) {
  state.project = null;
  state.issues = [];
  state.milestones = [];
  state.teams.clear();
  state.saves.clear();
  chart.hidden = true;
  chart.replaceChildren();
  $('legend').hidden = true;
  $('count').textContent = '';
  setControls(false);
  $('gate').hidden = false;
  $('gate-title').textContent = title;
  $('gate-text').textContent = text;
  const button = $('gate-action');
  button.hidden = !action;
  button.disabled = false;
  if (action) {
    button.textContent = action.label;
    button.onclick = action.run;
  }
}

function connectGate(text) {
  showGate('Connect Linear', text, { label: 'Connect Linear', run: connect });
}

function gateFor(error) {
  notice();
  if (SIGNED_OUT.has(error.code)) return connectGate(error.message);
  if (error.code === 'not_configured') return showGate('Sign-in is not set up', error.message);
  if (error.code === 'workspace_mismatch') return showGate('Different workspace', error.message, { label: 'Account settings', run: () => send('OPEN_OPTIONS') });
  if (error.code === 'project_unavailable') return showGate('Project unavailable', error.message, { label: 'Try again', run: load });
  if (error.code === 'disconnected') return showGate('Reload this page', error.message);
  showGate('Could not load issues', error.message, { label: 'Try again', run: load });
}

async function load() {
  const id = ++state.loadId;
  $('refresh').disabled = true;
  notice('Loading issues from Linear…');
  try {
    const status = await send('AUTH_STATUS');
    if (id !== state.loadId) return;
    if (!status.connected) {
      notice();
      if (status.configured) connectGate('Connect your Linear account to see this project as a Gantt chart.');
      else showGate('Sign-in is not set up', 'This build has no Linear OAuth client ID configured.');
      return;
    }
    const data = await send('LOAD_PROJECT', route);
    if (id !== state.loadId) return;
    const filtersKey = `filters:${data.project.id}`;
    const { view, [filtersKey]: filters = {} } = await chrome.storage.local.get(['view', filtersKey]);
    if (id !== state.loadId) return;
    state.project = data.project;
    state.issues = data.issues;
    state.milestones = data.milestones;
    state.teams = new Map(data.teams.map(team => [team.id, team]));
    state.saves.clear();
    if (Object.hasOwn(SCALES, view?.scale)) setScale(view.scale);
    if (Array.isArray(view?.collapsed)) state.collapsed = new Set(view.collapsed);
    setGroupBy(view?.groupBy ?? (view?.byParent === true ? 'parent' : 'none'));
    const notes = [];
    if (data.truncated) notes.push(`Showing the first ${data.issues.length.toLocaleString()} issues in this project.`);
    if (data.partial) notes.push('Some issues are hidden because you do not have access to them.');
    notice(notes.join(' '));
    $('gate').hidden = true;
    chart.hidden = false;
    $('legend').hidden = false;
    setControls(true);
    $('search').value = filters.search ?? '';
    fillFilters(filters);
    render({ scrollTo: localDay(new Date()) });
  } catch (error) {
    if (id === state.loadId) gateFor(error);
  } finally {
    if (id === state.loadId) $('refresh').disabled = false;
  }
}

async function connect() {
  $('gate-action').disabled = true;
  try {
    await send('CONNECT');
  } catch (error) {
    return error.code === 'not_configured' ? gateFor(error) : connectGate(error.message);
  }
  await load();
}

const selected = id => [...$(`${id}-menu`).querySelectorAll('input:checked')].map(input => input.value);
const asList = value => Array.isArray(value) ? value : value ? [value] : [];

function showSelected(id) {
  const button = $(id);
  const checked = $(`${id}-menu`).querySelectorAll('input:checked');
  button.textContent = checked.length > 1 ? `${checked.length} ${button.dataset.many}` : checked[0]?.parentElement.textContent ?? button.dataset.all;
}

function setOptions(id, options, current) {
  $(`${id}-menu`).replaceChildren(
    ...options.map(([value, label]) => element('label', {}, element('input', { type: 'checkbox', value, checked: current.includes(value) }), label)),
    element('button', { type: 'button', className: 'clear-filter' }, 'Clear'));
  showSelected(id);
}

function fillFilters(filters) {
  const assignees = new Map();
  const statuses = new Map();
  let unassigned = false;
  for (const issue of state.issues) {
    if (issue.assignee) assignees.set(issue.assignee.id, issue.assignee.name);
    else unassigned = true;
    statuses.set(issue.state.name, issue.state.type);
  }
  const people = [...assignees].sort((a, b) => a[1].localeCompare(b[1]));
  setOptions('assignee', unassigned ? [...people, ['none', 'Unassigned']] : people, asList(filters.assignee));
  setOptions('status', [...statuses]
    .sort((a, b) => stateOrder(a[1]) - stateOrder(b[1]) || a[0].localeCompare(b[0]))
    .map(([name]) => [name, name]), asList(filters.status));
}

const stateOrder = type => (STATE_ORDER.indexOf(type) + 1) || STATE_ORDER.length + 1;
const byState = (a, b) => stateOrder(a.type) - stateOrder(b.type) || (a.position ?? 0) - (b.position ?? 0);
const byName = (a, b) => a.name.localeCompare(b.name);
const withCurrent = (choices, current) => current && !choices.some(choice => choice.id === current.id) ? [current, ...choices] : choices;

function setScale(scale) {
  state.scale = scale;
  for (const button of document.querySelectorAll('[data-scale]')) button.setAttribute('aria-pressed', String(button.dataset.scale === scale));
}

function setGroupBy(groupBy) {
  state.groupBy = ['parent', 'assignee'].includes(groupBy) ? groupBy : 'none';
  $('group-by').value = state.groupBy;
}

function saveView() {
  chrome.storage.local.set({ view: { scale: state.scale, collapsed: [...state.collapsed], groupBy: state.groupBy } });
}

function changeFilters() {
  render();
  chrome.storage.local.set({ [`filters:${state.project.id}`]: { search: $('search').value, assignee: selected('assignee'), status: selected('status') } });
}

function visibleIssues() {
  const search = $('search').value.trim().toLowerCase();
  const assignees = selected('assignee');
  const statuses = selected('status');
  return state.issues.filter(issue =>
    (!assignees.length || assignees.includes(issue.assignee?.id ?? 'none')) &&
    (!statuses.length || statuses.includes(issue.state.name)) &&
    (!search || `${issue.identifier} ${issue.title}`.toLowerCase().includes(search)));
}

// While a save is pending, show the new value.
function shown(issue) {
  const save = state.saves.get(issue.id);
  return save?.status === 'pending' ? { ...issue, ...save.changes } : issue;
}

function safeURL(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === LINEAR_ORIGIN ? parsed.href : null;
  } catch {
    return null;
  }
}

const pxPerDay = () => SCALES[state.scale].pxPerDay;
const trackWidth = () => chart.clientWidth - LABEL_WIDTH;

function centerDay() {
  return xToDay(chart.scrollLeft + trackWidth() / 2, state.range, state.renderedScale);
}

function scrollToDay(day) {
  chart.scrollLeft = dayToX(day, state.range, state.scale) + pxPerDay() / 2 - trackWidth() / 2;
}

function headerRow(range, today) {
  const { scale } = state;
  const months = element('div', { className: 'months' });
  const units = element('div', { className: 'units' });
  const at = day => ({ left: `${dayToX(day, range, scale)}px` });
  const monthTicks = ticks(range, 'month');
  const tops = scale === 'month'
    ? monthTicks.filter(tick => tick.day === range.start || dateFromDay(tick.day).slice(5, 7) === '01')
    : monthTicks;
  for (const { day } of tops) {
    const text = scale === 'month' ? formatDay(day, { day: undefined, month: undefined, year: 'numeric' }) : formatDay(day, { day: undefined, month: 'long', year: 'numeric' });
    months.append(element('span', { style: at(day) }, text));
  }
  for (const { day } of ticks(range, scale)) {
    const text = scale === 'month' ? formatDay(day, { day: undefined }) : formatDay(day, { month: undefined });
    const isToday = scale === 'day' && day === today;
    units.append(element('span', { className: isToday ? 'today-label' : null, style: at(day) }, text));
  }
  return element('div', { className: 'row head' }, element('div', { className: 'label' }, 'Issue'), element('div', { className: 'track' }, months, units));
}

function sectionRow(title, count, className, key) {
  const expanded = !state.collapsed.has(key);
  const toggle = element('button', { type: 'button', className: 'section-toggle', 'aria-expanded': String(expanded), 'data-focus': `section:${key}` },
    title, element('span', {}, String(count)));
  toggle.addEventListener('click', () => {
    if (expanded) state.collapsed.add(key);
    else state.collapsed.delete(key);
    render();
    saveView();
  });
  return element('div', { className: `row ${className}` },
    element('div', { className: 'label' }, toggle),
    element('div', { className: 'track' }));
}

function sectionRows(title, items, rows, className = 'section', key = title) {
  if (!items.length) return [];
  return [sectionRow(title, items.length, className, key), ...(state.collapsed.has(key) ? [] : rows(items, key))];
}

// Unassigned last and everyone else by name; issues keep their order within a group.
function assigneeGroups(items) {
  return [...Map.groupBy(items, item => item.issue.assignee?.id ?? 'none')]
    .map(([id, group]) => ({ id, name: group[0].issue.assignee?.name ?? 'Unassigned', items: group }))
    .sort((a, b) => (a.id === 'none') - (b.id === 'none') || a.name.localeCompare(b.name));
}

function arrange(items) {
  if (state.groupBy !== 'parent') return items.map(item => ({ item, depth: 0 }));
  const ids = new Set(items.map(item => item.issue.id));
  const children = Map.groupBy(items.filter(item => item.issue.parent), item => item.issue.parent.id);
  const entries = [];
  const add = (item, depth) => {
    entries.push({ item, depth });
    for (const child of children.get(item.issue.id) ?? []) add(child, depth + 1);
  };
  for (const item of items) {
    const parent = item.issue.parent;
    if (!parent) add(item, 0);
    else if (!ids.has(parent.id) && children.get(parent.id)[0] === item) {
      entries.push({ parent, depth: 0 });
      for (const child of children.get(parent.id)) add(child, 1);
    }
  }
  return entries;
}

function statusText(save) {
  return { pending: 'Saving…', saved: 'Saved', error: 'Not saved' }[save?.status] ?? '';
}

function drawTrack(track, issue, schedule, pending) {
  const { range, scale } = state;
  const px = pxPerDay();
  const started = schedule.started !== null ? `Actual start: ${formatDay(schedule.started, { year: 'numeric' })}` : 'Not started';
  const tooltip = `${issue.identifier} ${issue.title}\n${started}\nDue: ${formatDay(schedule.due, { year: 'numeric' })}`;
  if (schedule.kind === 'bar') {
    const bar = element('div', {
      className: 'bar',
      title: tooltip,
      style: { left: `${dayToX(schedule.started, range, scale)}px`, width: `${(schedule.due - schedule.started + 1) * px}px` }
    }, element('span', { className: 'bar-text' }, issue.title));
    const handle = element('span', { className: 'handle', title: 'Drag to change the due date' });
    if (!pending) handle.addEventListener('pointerdown', event => startDrag(event, issue, schedule, bar, null));
    bar.append(handle);
    track.append(bar);
  } else if (schedule.kind === 'marker') {
    if (schedule.started !== null) {
      track.append(element('span', { className: 'start-tick', title: started, style: { left: `${dayToX(schedule.started, range, scale) + px / 2}px` } }));
    }
    const marker = element('div', { className: 'marker', title: tooltip, style: { left: `${dayToX(schedule.due, range, scale) + px / 2}px` } });
    if (!pending) marker.addEventListener('pointerdown', event => startDrag(event, issue, schedule, null, marker));
    track.append(marker);
  }
}

// Waits for the value to settle (typing a date, or arrowing through a list) before saving.
function wireEdit(control, commit) {
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    commit();
  };
  control.addEventListener('change', () => {
    clearTimeout(timer);
    timer = setTimeout(flush, INPUT_DELAY_MS);
  });
  control.addEventListener('blur', () => { if (timer) flush(); });
  control.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      flush();
    }
  });
}

// Holds only the current choice until focused, so rows stay cheap to render for large teams.
function choiceSelect(attributes, current, choices, pick, none = null) {
  const option = choice => new Option(choice?.name ?? none, choice?.id ?? '');
  const select = element('select', attributes, option(current));
  let list = [];
  select.addEventListener('focus', () => {
    list = choices();
    select.replaceChildren(...(none ? [option(null)] : []), ...list.map(option));
    select.value = current?.id ?? '';
  }, { once: true });
  wireEdit(select, () => pick(select.value ? list.find(choice => choice.id === select.value) : null));
  return select;
}

function issueRow({ issue, display, schedule }, today, warning = false, depth = 0) {
  const saving = state.saves.get(issue.id);
  const pending = saving?.status === 'pending';
  const color = /^#[0-9a-f]{6}$/i.test(display.state.color) ? display.state.color : '#8b8e9b';
  const done = display.state.type === 'completed' || display.state.type === 'canceled';
  const team = state.teams.get(issue.team?.id);
  const title = element('a', { className: 'title', target: '_top', href: safeURL(issue.url), 'data-focus': `${issue.id}:link` }, issue.title);
  const status = choiceSelect({
    className: 'choice status-choice',
    title: display.state.name,
    'aria-label': `Status for ${issue.identifier}`,
    'data-focus': `${issue.id}:status`,
    disabled: pending
  }, display.state, () => withCurrent(team?.states ?? [], issue.state).toSorted(byState), choice => save(issue, 'state', choice));
  const assignee = choiceSelect({
    className: 'choice who',
    'aria-label': `Assignee for ${issue.identifier}`,
    'data-focus': `${issue.id}:assignee`,
    disabled: pending
  }, display.assignee, () => withCurrent(team?.members ?? [], issue.assignee).toSorted(byName), choice => save(issue, 'assignee', choice), 'Unassigned');
  const input = element('input', {
    type: 'date',
    className: `due-input${schedule.due !== null && schedule.due < today && !done ? ' overdue' : ''}`,
    value: display.dueDate ?? '',
    'aria-label': `Due date for ${issue.identifier}`,
    'data-focus': `${issue.id}:due`,
    disabled: pending
  });
  wireEdit(input, () => {
    const value = input.value || null;
    if (value === null || isCalendarDate(value)) save(issue, 'dueDate', value);
  });
  const clear = element('button', {
    type: 'button',
    className: 'clear',
    title: 'Clear due date',
    'aria-label': `Clear due date for ${issue.identifier}`,
    'data-focus': `${issue.id}:clear`,
    disabled: pending || !display.dueDate
  }, '×');
  clear.addEventListener('click', () => save(issue, 'dueDate', null));
  const started = schedule.started !== null ? `Started ${formatDay(schedule.started)}` : 'Not started';
  const label = element('div', { className: 'label' },
    element('div', { className: 'line' },
      element('span', { className: 'status-icon' },
        element('span', { className: 'dot', 'data-type': display.state.type }),
        status),
      element('span', { className: 'identifier' }, issue.identifier),
      title),
    element('div', { className: 'line meta' },
      assignee,
      '·',
      element('span', { className: `start${schedule.started === null ? ' none' : ''}` }, started),
      input,
      clear,
      element('span', { className: 'save-state', 'data-status': saving?.status, 'data-status-for': issue.id, title: saving?.message }, statusText(saving)),
      ...(warning ? [element('span', { className: 'no-due' }, 'No due date')] : [])));
  const track = element('div', { className: 'track' });
  drawTrack(track, issue, schedule, pending);
  return element('div', { className: `row issue${pending ? ' pending' : ''}${warning ? ' warning' : ''}`, 'data-issue': issue.id, style: { '--state': color, '--depth': depth } }, label, track);
}

function parentRow(parent) {
  return element('div', { className: 'row parent-row' },
    element('div', { className: 'label' },
      element('div', { className: 'line' },
        element('span', { className: 'identifier' }, parent.identifier),
        element('a', { className: 'title', target: '_top', href: safeURL(parent.url), 'data-focus': `${parent.id}:parent` }, parent.title))),
    element('div', { className: 'track' }));
}

function milestoneRow({ milestone, day }) {
  const target = day !== null ? `Target ${formatDay(day, { year: 'numeric' })}` : 'No target date';
  const track = element('div', { className: 'track' });
  if (day !== null) {
    track.append(element('div', { className: 'milestone', title: `${milestone.name}\n${target}`, style: { left: `${dayToX(day, state.range, state.scale) + pxPerDay() / 2}px` } }));
  }
  return element('div', { className: 'row milestone-row' },
    element('div', { className: 'label' },
      element('div', { className: 'line' }, element('span', { className: 'title' }, milestone.name)),
      element('div', { className: 'line meta' }, target)),
    track);
}

const startOf = item => item.schedule.started ?? item.schedule.due;
const dated = item => item.schedule.kind !== 'unscheduled';
const byIdentifier = (a, b) => a.issue.identifier.localeCompare(b.issue.identifier, undefined, { numeric: true });
const bySchedule = (a, b) => startOf(a) - startOf(b) || a.schedule.due - b.schedule.due || byIdentifier(a, b);

function render({ scrollTo = null } = {}) {
  if (state.dragging) {
    state.renderQueued = true;
    return;
  }
  state.renderQueued = false;
  if (!state.project) return;
  const focus = chart.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
  const previous = state.range && { range: state.range, scale: state.renderedScale, left: chart.scrollLeft, top: chart.scrollTop, center: centerDay() };

  const today = localDay(new Date());
  const milestones = state.milestones.map(milestone => ({ milestone, day: dayFromDate(milestone.targetDate) }));
  const range = chartRange([
    ...state.issues.map(issue => issueSchedule(shown(issue))),
    ...milestones.map(({ day }) => ({ started: null, due: day }))
  ], today, state.scale);
  state.range = range;
  state.renderedScale = state.scale;
  const width = chartWidth(range, state.scale);
  const grid = element('div', { className: 'grid', style: { '--label': `${LABEL_WIDTH}px`, '--track': `${width}px`, width: `${LABEL_WIDTH + width}px` } });
  grid.append(headerRow(range, today));
  for (const tick of ticks(range, state.scale)) {
    grid.append(element('div', { className: `gridline${tick.major ? ' major' : ''}`, style: { left: `${LABEL_WIDTH + dayToX(tick.day, range, state.scale)}px` } }));
  }
  grid.append(element('div', { className: 'today-line', title: 'Today', style: { left: `${LABEL_WIDTH + dayToX(today, range, state.scale) + pxPerDay() / 2}px` } }));
  for (const { milestone, day } of milestones) {
    if (day !== null) grid.append(element('div', { className: 'milestone-line', title: `${milestone.name}\nTarget ${formatDay(day, { year: 'numeric' })}`, style: { left: `${LABEL_WIDTH + dayToX(day, range, state.scale) + pxPerDay() / 2}px` } }));
  }

  const visible = visibleIssues().map(issue => {
    const display = shown(issue);
    return { issue, display, schedule: issueSchedule(display) };
  });
  const open = visible.filter(item => item.issue.state.type !== 'completed');
  const done = visible.filter(item => item.issue.state.type === 'completed');
  const undated = open.filter(item => !dated(item));
  const critical = undated.filter(item => item.issue.state.type === 'started').sort(byIdentifier);
  const scheduled = open.filter(dated).sort(bySchedule);
  const unscheduled = undated.filter(item => item.issue.state.type !== 'started')
    .sort((a, b) => STATE_ORDER.indexOf(b.issue.state.type) - STATE_ORDER.indexOf(a.issue.state.type) || byIdentifier(a, b));
  const completed = [...done.filter(dated).sort(bySchedule), ...done.filter(item => !dated(item)).sort(byIdentifier)];
  const issueRows = warning => items => arrange(items)
    .map(({ item, parent, depth }) => parent ? parentRow(parent) : issueRow(item, today, warning, depth));
  const toRows = (warning = false) => (items, section) => state.groupBy === 'assignee'
    ? assigneeGroups(items).flatMap(group => sectionRows(group.name, group.items, issueRows(warning), 'subsection', `${section}/${group.id}`))
    : issueRows(warning)(items);
  grid.append(...sectionRows('In progress, no due date', critical, toRows(true), 'section warning'));
  grid.append(...sectionRows('Milestones', milestones, items => items.map(milestoneRow)));
  grid.append(...sectionRows('Scheduled', scheduled, toRows()));
  grid.append(...sectionRows('Unscheduled', unscheduled, toRows()));
  grid.append(...sectionRows('Completed', completed, toRows()));
  if (!visible.length) grid.append(element('p', { className: 'empty' }, state.issues.length ? 'No issues match these filters.' : 'This project has no issues yet.'));
  chart.replaceChildren(grid);

  const total = state.issues.length;
  $('count').textContent = visible.length === total ? `${total} issue${total === 1 ? '' : 's'}` : `${visible.length} of ${total} issues`;
  if (scrollTo !== null) scrollToDay(scrollTo);
  else if (previous?.scale === state.scale && previous.range.start === range.start) chart.scrollLeft = previous.left;
  else if (previous) scrollToDay(previous.center);
  if (previous) chart.scrollTop = previous.top;
  if (focus) chart.querySelector(`[data-focus="${CSS.escape(focus)}"]`)?.focus();
}

// Drags the due date (bar's right edge or marker). The start edge is never draggable.
function startDrag(event, issue, schedule, bar, marker) {
  if (event.button !== 0) return;
  event.preventDefault();
  const target = event.currentTarget;
  const track = target.closest('.track');
  const input = track.parentElement.querySelector('.due-input');
  const original = schedule.due;
  let day = original;
  state.dragging = true;
  document.body.classList.add('dragging');
  target.setPointerCapture(event.pointerId);

  const place = next => {
    day = next;
    if (bar) bar.style.width = `${(day - schedule.started + 1) * pxPerDay()}px`;
    else marker.style.left = `${dayToX(day, state.range, state.scale) + pxPerDay() / 2}px`;
    input.value = dateFromDay(day);
  };
  const move = moveEvent => {
    let next = xToDay(moveEvent.clientX - track.getBoundingClientRect().left, state.range, state.scale);
    if (bar) next = Math.max(next, schedule.started);
    if (next !== day) place(next);
  };
  const end = commit => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', cancel);
    removeEventListener('keydown', key, true);
    document.body.classList.remove('dragging');
    state.dragging = false;
    if (commit && day !== original) return save(issue, 'dueDate', dateFromDay(day));
    place(original);
    if (state.renderQueued) render();
  };
  const up = () => end(true);
  const cancel = () => end(false);
  const key = keyEvent => {
    if (keyEvent.key !== 'Escape') return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    end(false);
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', cancel);
  addEventListener('keydown', key, true);
}

function replaceIssue(updated) {
  const index = state.issues.findIndex(issue => issue.id === updated.id);
  if (index === -1) return;
  if (updated.project?.id === state.project.id) state.issues[index] = updated;
  else state.issues.splice(index, 1);
}

function clearSaved(id) {
  if (state.saves.get(id)?.status !== 'saved') return;
  state.saves.delete(id);
  const node = chart.querySelector(`[data-status-for="${CSS.escape(id)}"]`);
  if (node) {
    node.textContent = '';
    node.removeAttribute('data-status');
  }
}

// The issue fields the chart can change, keyed by the issue property that shows them.
const EDITS = {
  dueDate: {
    type: 'UPDATE_DUE_DATE', field: 'dueDate', name: 'due date', id: date => date ?? null,
    changed: date => date ? `to ${formatDay(dayFromDate(date), { year: 'numeric' })}` : 'by clearing it'
  },
  state: { type: 'UPDATE_STATUS', field: 'stateId', name: 'status', id: status => status.id, changed: status => `to ${status.name}` },
  assignee: {
    type: 'UPDATE_ASSIGNEE', field: 'assigneeId', name: 'assignee', id: user => user?.id ?? null,
    changed: user => user ? `to ${user.name}` : 'by unassigning it'
  }
};

async function save(issue, key, value) {
  const edit = EDITS[key];
  const expected = edit.id(issue[key]);
  if (edit.id(value) === expected || state.saves.get(issue.id)?.status === 'pending') return;
  const project = state.project;
  state.saves.set(issue.id, { status: 'pending', changes: { [key]: value } });
  render();
  let outcome;
  try {
    const result = await send(edit.type, { ...route, projectId: project.id, issueId: issue.id, expected, [edit.field]: edit.id(value) });
    if (state.project !== project) return;
    replaceIssue(result.issue);
    outcome = result.conflict
      ? { status: 'error', message: `Someone else changed this ${edit.name} in Linear ${edit.changed(result.issue[key])}. Your change was not saved.` }
      : { status: 'saved' };
  } catch (error) {
    if (state.project !== project) return;
    if (SIGNED_OUT.has(error.code) || error.code === 'workspace_mismatch' || error.code === 'disconnected') return gateFor(error);
    outcome = { status: 'error', message: error.message };
  }
  state.saves.set(issue.id, outcome);
  if (outcome.status === 'error') notice(`${issue.identifier}: ${outcome.message}`, true);
  else setTimeout(() => clearSaved(issue.id), SAVED_MS);
  render();
}

applyTheme(params.get('theme'));
$('search').addEventListener('input', changeFilters);
for (const id of ['assignee', 'status']) {
  const menu = $(`${id}-menu`);
  const change = () => {
    showSelected(id);
    changeFilters();
  };
  menu.addEventListener('change', change);
  menu.addEventListener('click', event => {
    if (!event.target.matches('.clear-filter')) return;
    for (const input of menu.querySelectorAll('input:checked')) input.checked = false;
    change();
  });
  menu.addEventListener('beforetoggle', () => {
    const box = $(id).getBoundingClientRect();
    menu.style.top = `${box.bottom + 4}px`;
    menu.style.left = `${box.left}px`;
  });
}
for (const button of document.querySelectorAll('[data-scale]')) {
  button.addEventListener('click', () => {
    setScale(button.dataset.scale);
    render();
    saveView();
  });
}
$('group-by').addEventListener('change', () => {
  setGroupBy($('group-by').value);
  render();
  saveView();
});
$('today').addEventListener('click', () => scrollToDay(localDay(new Date())));
$('refresh').addEventListener('click', load);

addEventListener('message', event => {
  if (event.source === parent && event.origin === LINEAR_ORIGIN && event.data?.type === 'linear-gantt:theme') applyTheme(event.data.theme);
});
addEventListener('blur', () => document.querySelector(':popover-open')?.hidePopover());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !state.dragging && !event.target.matches?.('input, select, [popovertarget], [popover] *')) {
    parent.postMessage({ type: 'linear-gantt:focus-tab' }, LINEAR_ORIGIN);
  }
});
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id === chrome.runtime.id && message?.type === 'SIGNED_OUT') gateFor({ code: 'signed_out', message: 'Linear was disconnected.' });
});

setControls(false);
load();
