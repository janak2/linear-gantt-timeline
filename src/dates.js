// Due dates are calendar dates ("YYYY-MM-DD"). They are converted to whole day
// numbers (days since 1970-01-01) without ever passing through local time.
export const DAY_MS = 86_400_000;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value) {
  const match = typeof value === 'string' && CALENDAR_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function dayFromDate(value) {
  if (!isCalendarDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

export function dateFromDay(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

// The calendar day on which an instant falls in the user's time zone.
export function localDay(instant) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

export function formatDay(day, options = {}) {
  return new Date(day * DAY_MS).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC', ...options });
}
