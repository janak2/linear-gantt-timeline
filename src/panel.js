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
  scale: 'week',
  range: null,
  renderedScale: null,
  saves: new Map(), // issue id -> { status: 'pending' | 'saved' | 'error', dueDate?, message? }
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
    state.project = data.project;
    state.issues = data.issues;
    state.saves.clear();
    const notes = [];
    if (data.truncated) notes.push(`Showing the first ${data.issues.length.toLocaleString()} issues in this project.`);
    if (data.partial) notes.push('Some issues are hidden because you do not have access to them.');
    notice(notes.join(' '));
    $('gate').hidden = true;
    chart.hidden = false;
    $('legend').hidden = false;
    setControls(true);
    fillFilters();
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

function setOptions(select, allLabel, options) {
  const current = select.value;
  select.replaceChildren(new Option(allLabel, ''), ...options.map(([value, label]) => new Option(label, value)));
  select.value = options.some(([value]) => value === current) ? current : '';
}

function fillFilters() {
  const assignees = new Map();
  const statuses = new Map();
  let unassigned = false;
  for (const issue of state.issues) {
    if (issue.assignee) assignees.set(issue.assignee.id, issue.assignee.name);
    else unassigned = true;
    statuses.set(issue.state.name, issue.state.type);
  }
  const people = [...assignees].sort((a, b) => a[1].localeCompare(b[1]));
  setOptions($('assignee'), 'All assignees', unassigned ? [...people, ['none', 'Unassigned']] : people);
  const order = type => (STATE_ORDER.indexOf(type) + 1) || STATE_ORDER.length + 1;
  setOptions($('status'), 'All statuses', [...statuses]
    .sort((a, b) => order(a[1]) - order(b[1]) || a[0].localeCompare(b[0]))
    .map(([name]) => [name, name]));
}

function visibleIssues() {
  const search = $('search').value.trim().toLowerCase();
  const assignee = $('assignee').value;
  const status = $('status').value;
  return state.issues.filter(issue =>
    (!assignee || (assignee === 'none' ? !issue.assignee : issue.assignee?.id === assignee)) &&
    (!status || issue.state.name === status) &&
    (!search || `${issue.identifier} ${issue.title}`.toLowerCase().includes(search)));
}

// While a save is pending, show the new due date.
function shown(issue) {
  const save = state.saves.get(issue.id);
  return save?.status === 'pending' ? { ...issue, dueDate: save.dueDate } : issue;
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

function sectionRow(title, count) {
  return element('div', { className: 'row section' },
    element('div', { className: 'label' }, title, element('span', {}, String(count))),
    element('div', { className: 'track' }));
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

function wireDueInput(input, issue) {
  let timer = null;
  const commit = () => {
    clearTimeout(timer);
    timer = null;
    const value = input.value || null;
    if (value === null || isCalendarDate(value)) save(issue, value);
  };
  input.addEventListener('change', () => {
    clearTimeout(timer);
    timer = setTimeout(commit, INPUT_DELAY_MS);
  });
  input.addEventListener('blur', () => { if (timer) commit(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  });
}

function issueRow({ issue, display, schedule }, today) {
  const saving = state.saves.get(issue.id);
  const pending = saving?.status === 'pending';
  const color = /^#[0-9a-f]{6}$/i.test(issue.state.color) ? issue.state.color : '#8b8e9b';
  const done = issue.state.type === 'completed' || issue.state.type === 'canceled';
  const title = element('a', { className: 'title', target: '_top', href: safeURL(issue.url), 'data-focus': `${issue.id}:link` }, issue.title);
  const input = element('input', {
    type: 'date',
    className: `due-input${schedule.due !== null && schedule.due < today && !done ? ' overdue' : ''}`,
    value: display.dueDate ?? '',
    'aria-label': `Due date for ${issue.identifier}`,
    'data-focus': `${issue.id}:due`,
    disabled: pending
  });
  wireDueInput(input, issue);
  const clear = element('button', {
    type: 'button',
    className: 'clear',
    title: 'Clear due date',
    'aria-label': `Clear due date for ${issue.identifier}`,
    'data-focus': `${issue.id}:clear`,
    disabled: pending || !display.dueDate
  }, '×');
  clear.addEventListener('click', () => save(issue, null));
  const started = schedule.started !== null ? `Started ${formatDay(schedule.started)}` : 'Not started';
  const label = element('div', { className: 'label' },
    element('div', { className: 'line' },
      element('span', { className: 'dot', 'data-type': issue.state.type, title: issue.state.name }),
      element('span', { className: 'identifier' }, issue.identifier),
      title),
    element('div', { className: 'line meta' },
      element('span', { className: 'who' }, issue.assignee?.name ?? 'Unassigned'),
      '·',
      element('span', { className: `start${schedule.started === null ? ' none' : ''}` }, started),
      input,
      clear,
      element('span', { className: 'save-state', 'data-status': saving?.status, 'data-status-for': issue.id, title: saving?.message }, statusText(saving))));
  const track = element('div', { className: 'track' });
  drawTrack(track, issue, schedule, pending);
  return element('div', { className: `row issue${pending ? ' pending' : ''}`, 'data-issue': issue.id, style: { '--state': color } }, label, track);
}

const startOf = item => item.schedule.started ?? item.schedule.due;
const byIdentifier = (a, b) => a.issue.identifier.localeCompare(b.issue.identifier, undefined, { numeric: true });

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
  const range = chartRange(state.issues.map(issue => issueSchedule(shown(issue))), today, state.scale);
  state.range = range;
  state.renderedScale = state.scale;
  const width = chartWidth(range, state.scale);
  const grid = element('div', { className: 'grid', style: { '--label': `${LABEL_WIDTH}px`, '--track': `${width}px`, width: `${LABEL_WIDTH + width}px` } });
  grid.append(headerRow(range, today));
  for (const tick of ticks(range, state.scale)) {
    grid.append(element('div', { className: `gridline${tick.major ? ' major' : ''}`, style: { left: `${LABEL_WIDTH + dayToX(tick.day, range, state.scale)}px` } }));
  }
  grid.append(element('div', { className: 'today-line', title: 'Today', style: { left: `${LABEL_WIDTH + dayToX(today, range, state.scale) + pxPerDay() / 2}px` } }));

  const visible = visibleIssues().map(issue => {
    const display = shown(issue);
    return { issue, display, schedule: issueSchedule(display) };
  });
  const scheduled = visible.filter(item => item.schedule.kind !== 'unscheduled')
    .sort((a, b) => startOf(a) - startOf(b) || a.schedule.due - b.schedule.due || byIdentifier(a, b));
  const unscheduled = visible.filter(item => item.schedule.kind === 'unscheduled')
    .sort((a, b) => STATE_ORDER.indexOf(b.issue.state.type) - STATE_ORDER.indexOf(a.issue.state.type) || byIdentifier(a, b));
  if (scheduled.length) grid.append(sectionRow('Scheduled', scheduled.length), ...scheduled.map(item => issueRow(item, today)));
  if (unscheduled.length) grid.append(sectionRow('Unscheduled', unscheduled.length), ...unscheduled.map(item => issueRow(item, today)));
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
    if (commit && day !== original) return save(issue, dateFromDay(day));
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

async function save(issue, dueDate) {
  const expected = issue.dueDate ?? null;
  if (dueDate === expected || state.saves.get(issue.id)?.status === 'pending') return;
  const project = state.project;
  state.saves.set(issue.id, { status: 'pending', dueDate });
  render();
  let outcome;
  try {
    const result = await send('UPDATE_DUE_DATE', { ...route, projectId: project.id, issueId: issue.id, expected, dueDate });
    if (state.project !== project) return;
    replaceIssue(result.issue);
    const now = result.issue.dueDate ? `to ${formatDay(dayFromDate(result.issue.dueDate), { year: 'numeric' })}` : 'by clearing it';
    outcome = result.conflict
      ? { status: 'error', message: `Someone else changed this due date in Linear ${now}. Your change was not saved.` }
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
$('search').addEventListener('input', () => render());
$('assignee').addEventListener('change', () => render());
$('status').addEventListener('change', () => render());
for (const button of document.querySelectorAll('[data-scale]')) {
  button.addEventListener('click', () => {
    state.scale = button.dataset.scale;
    for (const other of document.querySelectorAll('[data-scale]')) other.setAttribute('aria-pressed', String(other === button));
    render();
  });
}
$('today').addEventListener('click', () => scrollToDay(localDay(new Date())));
$('refresh').addEventListener('click', load);

addEventListener('message', event => {
  if (event.source === parent && event.origin === LINEAR_ORIGIN && event.data?.type === 'linear-gantt:theme') applyTheme(event.data.theme);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !state.dragging && !event.target.matches?.('input, select')) {
    parent.postMessage({ type: 'linear-gantt:focus-tab' }, LINEAR_ORIGIN);
  }
});
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id === chrome.runtime.id && message?.type === 'SIGNED_OUT') gateFor({ code: 'signed_out', message: 'Linear was disconnected.' });
});

setControls(false);
load();
