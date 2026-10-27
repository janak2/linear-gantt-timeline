import { dateFromDay, dayFromDate, localDay } from './dates.js';

export const SCALES = {
  day: { pxPerDay: 36, padding: 7 },
  week: { pxPerDay: 12, padding: 28 },
  month: { pxPerDay: 4, padding: 92 }
};

// started: actual start day (startedAt), never the creation date.
export function issueSchedule(issue) {
  const due = dayFromDate(issue.dueDate);
  const started = issue.startedAt ? localDay(issue.startedAt) : null;
  if (due === null) return { kind: 'unscheduled', started, due };
  if (started !== null && started <= due) return { kind: 'bar', started, due };
  return { kind: 'marker', started, due };
}

const weekday = day => (day + 4) % 7; // 0 = Sunday; day 0 was a Thursday.

function monthStart(day) {
  return dayFromDate(`${dateFromDay(day).slice(0, 7)}-01`);
}

function nextMonth(day) {
  const [year, month] = dateFromDay(day).split('-').map(Number);
  return dayFromDate(month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`);
}

export function chartRange(schedules, today, scale) {
  const days = schedules.flatMap(schedule => [schedule.started, schedule.due]).filter(day => day !== null);
  const { padding } = SCALES[scale];
  let start = Math.min(today, ...days) - padding;
  let end = Math.max(today, ...days) + padding;
  if (scale === 'month') {
    start = monthStart(start);
    end = nextMonth(end) - 1;
  } else {
    start -= (weekday(start) + 6) % 7;
    end += (7 - weekday(end)) % 7;
  }
  return { start, end };
}

export function ticks(range, scale) {
  const result = [];
  if (scale === 'month') {
    for (let day = range.start; day <= range.end; day = nextMonth(day)) result.push({ day, major: true });
  } else {
    const step = scale === 'day' ? 1 : 7;
    for (let day = range.start; day <= range.end; day += step) {
      result.push({ day, major: scale === 'day' ? weekday(day) === 1 : day === range.start || dateFromDay(day).slice(8) <= '07' });
    }
  }
  return result;
}

export function dayToX(day, range, scale) {
  return (day - range.start) * SCALES[scale].pxPerDay;
}

export function xToDay(x, range, scale) {
  const day = range.start + Math.floor(x / SCALES[scale].pxPerDay);
  return Math.min(Math.max(day, range.start), range.end);
}

export function chartWidth(range, scale) {
  return (range.end - range.start + 1) * SCALES[scale].pxPerDay;
}
