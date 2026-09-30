/**
 * Versioned IKN working-day calendar.
 *
 * A calendar version carries its weekend days, its non-working dates (public
 * holidays, officially recognised replacement holidays) and — crucially — the
 * `include_start_day` convention, which is assumption #2 in the register and is
 * marked UNVERIFIED. Records must confirm it before production, because it moves
 * every deadline in the system by one working day.
 */
import type { Handle } from '../db/database.ts';
import { addDays, dayOfWeek, type BusinessDate } from './time.ts';

export interface CalendarVersion {
  calendarVersion: string;
  description: string;
  timezone: string;
  /** true: the day completeness was reached is working day 1. false: the clock starts the next working day. */
  includeStartDay: boolean;
  weekendDays: readonly number[];
  effectiveFrom: string;
  verificationState: string;
  /** Non-working dates, plus explicit working overrides. */
  nonWorking: ReadonlySet<BusinessDate>;
  workingOverrides: ReadonlySet<BusinessDate>;
}

const cache = new Map<string, CalendarVersion>();

export function loadCalendar(handle: Handle, version: string): CalendarVersion {
  const hit = cache.get(version);
  if (hit) return hit;

  const row = handle.get<{
    calendar_version: string; description: string; timezone: string;
    include_start_day: number; weekend_days: string; effective_from: string;
    verification_state: string;
  }>('SELECT * FROM business_calendar_versions WHERE calendar_version = ?', version);
  if (!row) throw new Error(`unknown calendar version: ${version}`);

  const days = handle.all<{ calendar_date: string; day_kind: string }>(
    'SELECT calendar_date, day_kind FROM business_calendar_days WHERE calendar_version = ?', version);

  const built: CalendarVersion = {
    calendarVersion: row.calendar_version,
    description: row.description,
    timezone: row.timezone,
    includeStartDay: row.include_start_day === 1,
    weekendDays: row.weekend_days.split(',').filter(Boolean).map(Number),
    effectiveFrom: row.effective_from,
    verificationState: row.verification_state,
    nonWorking: new Set(days.filter((d) => d.day_kind !== 'WORKING_OVERRIDE').map((d) => d.calendar_date)),
    workingOverrides: new Set(days.filter((d) => d.day_kind === 'WORKING_OVERRIDE').map((d) => d.calendar_date)),
  };
  cache.set(version, built);
  return built;
}

/** Drops the in-process cache. Called after an administrator edits a calendar. */
export function invalidateCalendarCache(version?: string): void {
  if (version) cache.delete(version); else cache.clear();
}

export function isWorkingDay(cal: CalendarVersion, date: BusinessDate): boolean {
  if (cal.workingOverrides.has(date)) return true;
  if (cal.nonWorking.has(date)) return false;
  return !cal.weekendDays.includes(dayOfWeek(date));
}

/** The first working day on or after `date`. */
export function nextWorkingDayOnOrAfter(cal: CalendarVersion, date: BusinessDate): BusinessDate {
  let d = date;
  for (let i = 0; i < 400; i += 1) {
    if (isWorkingDay(cal, d)) return d;
    d = addDays(d, 1);
  }
  throw new Error(`no working day within 400 days of ${date} in ${cal.calendarVersion}`);
}

/** The first working day strictly after `date`. */
export function nextWorkingDayAfter(cal: CalendarVersion, date: BusinessDate): BusinessDate {
  return nextWorkingDayOnOrAfter(cal, addDays(date, 1));
}

/**
 * The due date `allowance` working days from `start`, honouring the version's
 * `include_start_day` convention.
 *
 * With `includeStartDay = false` (the prototype default) and an allowance of 28,
 * the clock starts on the first working day *after* `start` and the due date is
 * the 28th such working day.
 */
export function addWorkingDays(
  cal: CalendarVersion, start: BusinessDate, allowance: number,
): BusinessDate {
  if (!Number.isInteger(allowance) || allowance < 0) {
    throw new Error(`allowance must be a non-negative integer, got ${allowance}`);
  }
  if (allowance === 0) return nextWorkingDayOnOrAfter(cal, start);

  let remaining = allowance;
  let cursor = cal.includeStartDay
    ? nextWorkingDayOnOrAfter(cal, start)
    : nextWorkingDayAfter(cal, start);
  remaining -= 1;
  while (remaining > 0) {
    cursor = nextWorkingDayAfter(cal, cursor);
    remaining -= 1;
  }
  return cursor;
}

/**
 * Whole working days elapsed from `from` to `to` under the same convention used
 * to set deadlines, so turnaround and deadlines are always measured the same way.
 * Negative when `to` precedes `from`.
 */
export function workingDaysBetween(
  cal: CalendarVersion, from: BusinessDate, to: BusinessDate,
): number {
  if (from === to) return cal.includeStartDay && isWorkingDay(cal, from) ? 1 : 0;
  const backwards = to < from;
  const lo = backwards ? to : from;
  const hi = backwards ? from : to;

  let count = 0;
  let cursor = cal.includeStartDay ? lo : addDays(lo, 1);
  while (cursor <= hi) {
    if (isWorkingDay(cal, cursor)) count += 1;
    cursor = addDays(cursor, 1);
  }
  return backwards ? -count : count;
}

/**
 * Working days remaining until `due` as at `asOf` (positive), or working days
 * overdue (negative). Zero means the deadline falls on `asOf`.
 */
export function workingDaysUntil(
  cal: CalendarVersion, asOf: BusinessDate, due: BusinessDate,
): number {
  if (asOf === due) return 0;
  return workingDaysBetween(cal, asOf, due);
}
