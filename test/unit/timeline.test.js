import test from 'node:test';
import assert from 'node:assert/strict';
import { dateFromDay, dayFromDate } from '../../src/dates.js';
import { SCALES, chartRange, chartWidth, dayToX, issueSchedule, ticks, xToDay } from '../../src/timeline.js';

const day = dayFromDate;
process.env.TZ = 'UTC';

test('draws a bar from actual start to due date', () => {
  assert.deepEqual(issueSchedule({ startedAt: '2026-10-20T09:00:00Z', dueDate: '2026-10-30' }), { kind: 'bar', started: day('2026-10-20'), due: day('2026-10-30') });
});

test('shows a due-date marker for issues that have not started', () => {
  assert.deepEqual(issueSchedule({ startedAt: null, dueDate: '2026-10-30', createdAt: '2026-10-01T00:00:00Z' }), { kind: 'marker', started: null, due: day('2026-10-30') });
});

test('keeps the actual start when work started after the due date', () => {
  assert.deepEqual(issueSchedule({ startedAt: '2026-11-02T00:00:00Z', dueDate: '2026-10-30' }), { kind: 'marker', started: day('2026-11-02'), due: day('2026-10-30') });
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
