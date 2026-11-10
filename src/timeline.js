import { dateFromDay, dayFromDate, localDay } from './dates.js';

export const SCALES = {
  day: { pxPerDay: 36, padding: 7 },
  week: { pxPerDay: 12, padding: 28 },
  month: { pxPerDay: 4, padding: 92 }
};

// started: actual start day (startedAt), never the creation date.
// A late issue started after its due date; it runs until it was finished, or until today.
export function issueSchedule(issue, today) {
  const due = dayFromDate(issue.dueDate);
  const started = issue.startedAt ? localDay(issue.startedAt) : null;
  if (due === null) return { kind: 'unscheduled', started, due };
  if (started === null) return { kind: 'marker', started, due };
  if (started <= due) return { kind: 'bar', started, due };
  const type = issue.state?.type;
  if (type !== 'completed' && type !== 'canceled') return { kind: 'late', started, due, end: today };
  const finishedAt = type === 'completed' ? issue.completedAt : issue.canceledAt;
  return { kind: 'late', started, due, end: finishedAt ? Math.max(localDay(finishedAt), started) : started };
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
  const days = schedules.flatMap(schedule => [schedule.started, schedule.due, schedule.end ?? null]).filter(day => day !== null);
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

const STATE_TYPES = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'];
const SORT_KEYS = {
  dueDate: issue => issue.dueDate ? [dayFromDate(issue.dueDate)] : null,
  status: issue => issue.state ? [STATE_TYPES.indexOf(issue.state.type), issue.state.position ?? 0] : null,
  priority: issue => issue.priority ? [issue.priority] : null
};
export const SORTS = ['default', ...Object.keys(SORT_KEYS)];

// Issues missing the value go last in both directions. Ties compare equal, so a stable sort keeps the default order.
export function issueOrder(sort, descending) {
  const key = SORT_KEYS[sort];
  if (!key) return () => 0;
  return (a, b) => {
    const x = key(a);
    const y = key(b);
    if (!x || !y) return !x - !y;
    if (sort === 'status' && descending) {
      const finished = value => value[0] === STATE_TYPES.indexOf('completed') || value[0] === STATE_TYPES.indexOf('canceled');
      if (finished(x) !== finished(y)) return finished(x) - finished(y);
    }
    const index = x.findIndex((value, i) => value !== y[i]);
    return index === -1 ? 0 : (x[index] - y[index]) * (descending ? -1 : 1);
  };
}

// Nests each issue under its parent, and issues whose parent is not shown under a placeholder for it.
// Top-level rows are ordered by their own issue, or by the parent's own fields for a placeholder.
export function arrange(items, order) {
  const byOrder = (a, b) => order(a.display, b.display);
  const ids = new Set(items.map(item => item.issue.id));
  const children = Map.groupBy(items.filter(item => item.issue.parent), item => item.issue.parent.id);
  const tops = [];
  for (const item of items) {
    const parent = item.issue.parent;
    if (!parent) tops.push({ item, own: item.display });
    else if (!ids.has(parent.id) && children.get(parent.id)[0] === item) tops.push({ parent, own: parent });
  }
  const entries = [];
  const add = (item, depth) => {
    entries.push({ item, depth });
    for (const child of (children.get(item.issue.id) ?? []).toSorted(byOrder)) add(child, depth + 1);
  };
  for (const { item, parent } of tops.sort((a, b) => order(a.own, b.own))) {
    if (item) add(item, 0);
    else {
      entries.push({ parent, depth: 0 });
      for (const child of children.get(parent.id).toSorted(byOrder)) add(child, 1);
    }
  }
  return entries;
}
