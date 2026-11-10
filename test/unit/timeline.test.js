import test from 'node:test';
import assert from 'node:assert/strict';
import { dateFromDay, dayFromDate } from '../../src/dates.js';
import { SCALES, arrange, chartRange, chartWidth, dayToX, issueOrder, issueSchedule, ticks, xToDay } from '../../src/timeline.js';

const day = dayFromDate;
process.env.TZ = 'UTC';

test('draws a bar from actual start to due date', () => {
  assert.deepEqual(issueSchedule({ startedAt: '2026-10-20T09:00:00Z', dueDate: '2026-10-30' }), { kind: 'bar', started: day('2026-10-20'), due: day('2026-10-30') });
});

test('shows a due-date marker for issues that have not started', () => {
  assert.deepEqual(issueSchedule({ startedAt: null, dueDate: '2026-10-30', createdAt: '2026-10-01T00:00:00Z' }), { kind: 'marker', started: null, due: day('2026-10-30') });
});

test('runs a late issue from its actual start to today while it is not finished', () => {
  const issue = { startedAt: '2026-11-02T00:00:00Z', dueDate: '2026-10-30', state: { type: 'started' } };
  assert.deepEqual(issueSchedule(issue, day('2026-11-09')), { kind: 'late', started: day('2026-11-02'), due: day('2026-10-30'), end: day('2026-11-09') });
});

test('ends a finished late issue on the day it was completed or canceled', () => {
  const late = { startedAt: '2026-11-02T00:00:00Z', dueDate: '2026-10-30', completedAt: '2026-11-05T15:00:00Z', canceledAt: '2026-11-06T15:00:00Z' };
  const today = day('2026-11-09');
  assert.equal(issueSchedule({ ...late, state: { type: 'completed' } }, today).end, day('2026-11-05'));
  assert.equal(issueSchedule({ ...late, state: { type: 'canceled' } }, today).end, day('2026-11-06'));
  assert.equal(issueSchedule({ ...late, completedAt: null, state: { type: 'completed' } }, today).end, day('2026-11-02'));
});

test('keeps a bar for issues that started on or before their due date, even when overdue', () => {
  assert.deepEqual(issueSchedule({ startedAt: '2026-10-30T00:00:00Z', dueDate: '2026-10-30', state: { type: 'started' } }, day('2026-11-09')), { kind: 'bar', started: day('2026-10-30'), due: day('2026-10-30') });
});

test('puts issues without due dates in Unscheduled and never uses the creation date', () => {
  assert.deepEqual(issueSchedule({ createdAt: '2026-10-01T00:00:00Z' }), { kind: 'unscheduled', started: null, due: null });
  assert.equal(issueSchedule({ startedAt: '2026-10-20T00:00:00Z' }).kind, 'unscheduled');
});

test('the range covers today and every date, aligned to weeks or months', () => {
  const today = day('2026-10-27');
  const schedules = [{ started: day('2026-09-10'), due: day('2026-12-05') }, { started: null, due: null }];
  const week = chartRange(schedules, today, 'week');
  assert.ok(week.start <= day('2026-09-10') - SCALES.week.padding);
  assert.ok(week.end >= day('2026-12-05') + SCALES.week.padding);
  assert.equal(new Date(week.start * 86_400_000).getUTCDay(), 1);
  assert.equal(new Date(week.end * 86_400_000).getUTCDay(), 0);
  const month = chartRange(schedules, today, 'month');
  assert.equal(dateFromDay(month.start).slice(8), '01');
  assert.equal(dateFromDay(month.end + 1).slice(8), '01');
  assert.deepEqual(chartRange([], today, 'day').start <= today, true);
  assert.ok(chartRange([{ started: day('2026-10-20'), due: day('2026-10-10'), end: day('2026-12-20') }], today, 'week').end >= day('2026-12-20'));
});

test('ticks follow the scale', () => {
  const range = { start: day('2026-10-26'), end: day('2026-12-06') };
  const weekly = ticks(range, 'week');
  assert.equal(weekly.length, 6);
  assert.ok(weekly.every((tick, index) => tick.day === range.start + index * 7));
  const monthly = ticks({ start: day('2026-10-01'), end: day('2027-01-31') }, 'month');
  assert.deepEqual(monthly.map(tick => dateFromDay(tick.day)), ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']);
  assert.equal(ticks(range, 'day').length, range.end - range.start + 1);
});

test('converts between pixels and days, clamped to the range', () => {
  const range = { start: day('2026-10-26'), end: day('2026-11-08') };
  for (const scale of Object.keys(SCALES)) {
    const target = day('2026-11-02');
    const x = dayToX(target, range, scale);
    assert.equal(xToDay(x, range, scale), target);
    assert.equal(xToDay(x + SCALES[scale].pxPerDay - 1, range, scale), target);
    assert.equal(xToDay(-500, range, scale), range.start);
    assert.equal(xToDay(1e9, range, scale), range.end);
    assert.equal(chartWidth(range, scale), 14 * SCALES[scale].pxPerDay);
  }
});

const issue = (id, fields = {}) => ({ id, ...fields });
const item = (id, fields) => ({ issue: issue(id, fields), display: issue(id, fields) });
const sorted = (issues, sort, descending = false) => issues.toSorted(issueOrder(sort, descending)).map(({ id }) => id);

test('sorts by due date with missing dates last in both directions and ties in the given order', () => {
  const issues = [issue('a', { dueDate: '2026-11-10' }), issue('b'), issue('c', { dueDate: '2026-11-03' }), issue('d', { dueDate: '2026-11-10' }), issue('e', { dueDate: null })];
  assert.deepEqual(sorted(issues, 'dueDate'), ['c', 'a', 'd', 'b', 'e']);
  assert.deepEqual(sorted(issues, 'dueDate', true), ['a', 'd', 'c', 'b', 'e']);
});

test("sorts by status in Linear's workflow order, then the state's position", () => {
  const state = (type, position) => ({ state: { type, position } });
  const issues = [issue('done', state('completed', 0)), issue('review', state('started', 1)), issue('canceled', state('canceled', 0)),
    issue('todo', state('unstarted', 0)), issue('progress', state('started', 0)), issue('backlog', state('backlog', 0))];
  assert.deepEqual(sorted(issues, 'status'), ['backlog', 'todo', 'progress', 'review', 'done', 'canceled']);
  assert.deepEqual(sorted(issues, 'status', true), ['review', 'progress', 'todo', 'backlog', 'canceled', 'done']);
});

test('sorts by priority from Urgent to Low with No priority last in both directions', () => {
  const issues = [issue('none', { priority: 0 }), issue('low', { priority: 4 }), issue('urgent', { priority: 1 }), issue('medium', { priority: 3 }), issue('high', { priority: 2 }), issue('missing')];
  assert.deepEqual(sorted(issues, 'priority'), ['urgent', 'high', 'medium', 'low', 'none', 'missing']);
  assert.deepEqual(sorted(issues, 'priority', true), ['low', 'medium', 'high', 'urgent', 'none', 'missing']);
});

test('keeps the given order for the default sort', () => {
  assert.deepEqual(sorted([issue('b', { priority: 3 }), issue('a', { priority: 1 })], 'default'), ['b', 'a']);
});

test('groups by parent, sorting children within each parent and parent groups by the parent issue itself', () => {
  const late = { id: 'p1', identifier: 'P-1', dueDate: '2026-12-01' };
  const early = { id: 'p2', identifier: 'P-2', dueDate: '2026-11-20' };
  const items = [
    item('a', { parent: late, dueDate: '2026-11-01' }),
    item('b', { parent: early, dueDate: '2026-11-25' }),
    item('c', { dueDate: '2026-11-22' }),
    item('d', { parent: late, dueDate: '2026-10-01' }),
    item('e', { parent: early, dueDate: '2026-11-21' }),
    item('f', { parent: { id: 'p3', identifier: 'P-3' }, dueDate: '2026-10-01' }),
    item('g', { parent: { id: 'c' }, dueDate: '2026-12-31' }),
    item('h', { parent: { id: 'c' }, dueDate: '2026-12-30' })
  ];
  const rows = order => arrange(items, order).map(({ item, parent, depth }) => `${parent ? parent.identifier : item.issue.id}:${depth}`);
  assert.deepEqual(rows(issueOrder('default')), ['P-1:0', 'a:1', 'd:1', 'P-2:0', 'b:1', 'e:1', 'c:0', 'g:1', 'h:1', 'P-3:0', 'f:1']);
  assert.deepEqual(rows(issueOrder('dueDate')), ['P-2:0', 'e:1', 'b:1', 'c:0', 'h:1', 'g:1', 'P-1:0', 'd:1', 'a:1', 'P-3:0', 'f:1']);
  assert.deepEqual(rows(issueOrder('dueDate', true)), ['P-1:0', 'a:1', 'd:1', 'c:0', 'g:1', 'h:1', 'P-2:0', 'b:1', 'e:1', 'P-3:0', 'f:1']);
});

test('orders parent groups by the parent issue status and priority', () => {
  const urgentBacklog = { id: 'p1', identifier: 'P-1', priority: 1, state: { type: 'backlog', position: 0 } };
  const lowStarted = { id: 'p2', identifier: 'P-2', priority: 4, state: { type: 'started', position: 0 } };
  const items = [
    item('a', { parent: lowStarted, priority: 1, state: { type: 'backlog', position: 0 } }),
    item('b', { parent: urgentBacklog, priority: 4, state: { type: 'started', position: 0 } })
  ];
  const tops = order => arrange(items, order).filter(row => row.parent).map(row => row.parent.identifier);
  assert.deepEqual(tops(issueOrder('default')), ['P-2', 'P-1']);
  assert.deepEqual(tops(issueOrder('status')), ['P-1', 'P-2']);
  assert.deepEqual(tops(issueOrder('status', true)), ['P-2', 'P-1']);
  assert.deepEqual(tops(issueOrder('priority')), ['P-1', 'P-2']);
});
