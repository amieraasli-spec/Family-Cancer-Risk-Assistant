/**
 * Asia/Kuala_Lumpur business-date arithmetic.
 *
 * Malaysia has been on a fixed UTC+08:00 since 1982 and observes no daylight
 * saving, so a constant offset is exact here and is preferred over `Intl`:
 * it is deterministic, needs no ICU data in the container, and cannot drift if
 * the host timezone database differs between the prototype and IKN's servers.
 * If that ever changes, this is the single file to revisit.
 */

export const KL_OFFSET_MINUTES = 8 * 60;
export const KL_TIMEZONE = 'Asia/Kuala_Lumpur';

/** An `YYYY-MM-DD` business date in Asia/Kuala_Lumpur. */
export type BusinessDate = string;
/** An ISO-8601 instant in UTC with a trailing `Z`. */
export type Instant = string;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isBusinessDate(v: unknown): v is BusinessDate {
  return typeof v === 'string' && DATE_RE.test(v);
}

/** The Kuala Lumpur calendar date on which a UTC instant falls. */
export function toBusinessDate(instant: Instant | Date): BusinessDate {
  const ms = (instant instanceof Date ? instant : new Date(instant)).getTime();
  if (Number.isNaN(ms)) throw new Error(`not an instant: ${String(instant)}`);
  return new Date(ms + KL_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** Midnight at the start of a KL business date, as a UTC instant. */
export function startOfBusinessDay(date: BusinessDate): Instant {
  assertDate(date);
  return new Date(Date.parse(`${date}T00:00:00Z`) - KL_OFFSET_MINUTES * 60_000).toISOString();
}

/** The instant one millisecond before the next KL business day begins. */
export function endOfBusinessDay(date: BusinessDate): Instant {
  assertDate(date);
  return new Date(Date.parse(`${date}T24:00:00Z`) - KL_OFFSET_MINUTES * 60_000 - 1).toISOString();
}

/** KL day of week, Sunday = 0 … Saturday = 6. */
export function dayOfWeek(date: BusinessDate): number {
  assertDate(date);
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date: BusinessDate, days: number): BusinessDate {
  assertDate(date);
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Signed difference in calendar days, `to - from`. */
export function calendarDaysBetween(from: BusinessDate, to: BusinessDate): number {
  assertDate(from); assertDate(to);
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `YYYY-MM` for a business date. */
export function monthKey(date: BusinessDate): string {
  assertDate(date);
  return date.slice(0, 7);
}

export function firstDayOfMonth(month: string): BusinessDate {
  assertMonth(month);
  return `${month}-01`;
}

export function lastDayOfMonth(month: string): BusinessDate {
  assertMonth(month);
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 0)).toISOString().slice(0, 10);
}

export function addMonths(month: string, n: number): string {
  assertMonth(month);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Inclusive list of month keys from `from` to `to`. */
export function monthRange(from: string, to: string): string[] {
  assertMonth(from); assertMonth(to);
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function nowInstant(): Instant {
  return new Date().toISOString();
}

function assertDate(v: string): void {
  if (!DATE_RE.test(v)) throw new Error(`not a business date (YYYY-MM-DD): ${v}`);
}

function assertMonth(v: string): void {
  if (!/^\d{4}-\d{2}$/.test(v)) throw new Error(`not a month key (YYYY-MM): ${v}`);
}
