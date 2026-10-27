import test from 'node:test';
import assert from 'node:assert/strict';
import { dateFromDay, dayFromDate, isCalendarDate, localDay } from '../../src/dates.js';
import { issueSchedule } from '../../src/timeline.js';

const ZONES = ['UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];

function inZone(zone, run) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try { return run(); } finally { process.env.TZ = previous; }
}

test('validates calendar dates strictly', () => {
  assert.equal(isCalendarDate('2028-02-29'), true);
  assert.equal(isCalendarDate('2026-02-29'), false);
  assert.equal(isCalendarDate('2026-13-01'), false);
  assert.equal(isCalendarDate('2026-1-01'), false);
  assert.equal(isCalendarDate('2026-10-27T00:00:00Z'), false);
  assert.equal(isCalendarDate(null), false);
});

test('round-trips due dates through day numbers', () => {
  for (const date of ['1999-12-31', '2026-10-27', '2026-03-08', '2026-11-01', '2030-01-01']) {
    assert.equal(dateFromDay(dayFromDate(date)), date);
  }
  assert.equal(dayFromDate('2026-10-28') - dayFromDate('2026-10-27'), 1);
});

test('due dates never shift with the time zone', () => {
  const expected = dayFromDate('2026-11-01');
  for (const zone of ZONES) {
    inZone(zone, () => {
      assert.equal(dayFromDate('2026-11-01'), expected, zone);
      assert.equal(dateFromDay(expected), '2026-11-01', zone);
      assert.equal(issueSchedule({ dueDate: '2026-11-01' }).due, expected, zone);
    });
  }
});

test('actual start dates use the calendar day in the user time zone', () => {
  const startedAt = '2026-10-27T20:00:00Z';
  const days = Object.fromEntries(ZONES.map(zone => [zone, inZone(zone, () => dateFromDay(localDay(startedAt)))]));
  assert.deepEqual(days, {
    UTC: '2026-10-27',
    'America/Los_Angeles': '2026-10-27',
    'Asia/Kolkata': '2026-10-28',
    'Pacific/Kiritimati': '2026-10-28',
    'Pacific/Pago_Pago': '2026-10-27'
  });
  assert.equal(localDay('not a date'), null);
});
