// Date helpers. Calendar days are handled as local-time Date objects at midnight
// and serialised as "YYYY-MM-DD" keys, so nothing here depends on a fixed year range.

export type Ymd = string; // "YYYY-MM-DD"

const pad = (n: number) => String(n).padStart(2, "0");

export function ymd(d: Date): Ymd {
  return `${String(d.getFullYear()).padStart(4, "0")}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s: Ymd): Date {
  const [y, m, d] = s.split("-").map(Number);
  const out = new Date(2000, 0, 1);
  out.setFullYear(y, m - 1, d); // setFullYear avoids the 0–99 → 1900s quirk
  out.setHours(0, 0, 0, 0);
  return out;
}

export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return ymd(parseYmd(s)) === s;
}

export function mkDate(y: number, m0: number, d: number): Date {
  const out = new Date(2000, 0, 1);
  out.setFullYear(y, m0, d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export const today = (): Date => startOfDay(new Date());
export const todayYmd = (): Ymd => ymd(new Date());

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function addMonths(d: Date, n: number): Date {
  const day = d.getDate();
  const out = mkDate(d.getFullYear(), d.getMonth() + n, 1);
  out.setDate(Math.min(day, daysInMonth(out.getFullYear(), out.getMonth())));
  return out;
}

export function addYears(d: Date, n: number): Date {
  return addMonths(d, n * 12);
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m0: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][((m0 % 12) + 12) % 12];
}

/** Whole days from a to b (b - a), immune to DST because it compares calendar dates in UTC. */
export function dayDiff(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86400000);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function startOfWeek(d: Date, weekStartsOn = 0): Date {
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  return addDays(startOfDay(d), -diff);
}

/** 6 rows × 7 days covering the month, starting on the configured weekday. */
export function monthGrid(y: number, m0: number, weekStartsOn = 0): Date[] {
  const first = startOfWeek(mkDate(y, m0, 1), weekStartsOn);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export function weekDays(d: Date, weekStartsOn = 0): Date[] {
  const s = startOfWeek(d, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

/** ISO-8601 week number. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
}

/** nth (1-based) weekday of a month; n = -1 means the last one. */
export function nthWeekday(y: number, m0: number, weekday: number, n: number): Date {
  if (n > 0) {
    const first = mkDate(y, m0, 1);
    const offset = (weekday - first.getDay() + 7) % 7;
    return mkDate(y, m0, 1 + offset + (n - 1) * 7);
  }
  const last = mkDate(y, m0, daysInMonth(y, m0));
  const offset = (last.getDay() - weekday + 7) % 7;
  return addDays(last, -offset);
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
export function fmt(d: Date, opts: Intl.DateTimeFormatOptions, locale?: string): string {
  const key = (locale || "") + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) fmtCache.set(key, (f = new Intl.DateTimeFormat(locale, opts)));
  return f.format(d);
}

export const fmtLong = (d: Date) => fmt(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const fmtMed = (d: Date) => fmt(d, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
export const fmtShort = (d: Date) => fmt(d, { day: "numeric", month: "short" });
export const fmtMonthYear = (d: Date) => fmt(d, { month: "long", year: "numeric" });

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function fmtTime(hhmm: string | undefined, hour12 = true): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (!hour12) return `${pad(h)}:${pad(m)}`;
  const ap = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${pad(m)} ${ap}`;
}

export function combine(dateKey: Ymd, hhmm?: string): Date {
  const d = parseYmd(dateKey);
  if (hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    d.setHours(h || 0, m || 0, 0, 0);
  }
  return d;
}

export function relDays(d: Date): string {
  const n = dayDiff(today(), d);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (n > 0) return `in ${n} days`;
  return `${-n} days ago`;
}

export const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
