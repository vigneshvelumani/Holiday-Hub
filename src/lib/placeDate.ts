// "Today" at the chosen location. The almanac is calculated for a place, so the day it calls
// today is the calendar date there — which can be a day ahead of or behind this device's date.

import { zoneParts } from "./clock.ts";

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** The calendar date ("YYYY-MM-DD") at an instant in a time zone; the device's own date if the zone is unknown. */
export function placeToday(tz: string, now: Date = new Date()): string {
  try {
    const p = zoneParts(tz, now);
    if (p.year && p.month && p.day) return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
  } catch {
    /* unknown zone → the device's date below */
  }
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole calendar days from one date key to another (positive when `to` is later). */
export function keyDayDiff(from: string, to: string): number {
  const utc = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    const t = new Date(Date.UTC(2000, m - 1, d));
    t.setUTCFullYear(y); // years 1–99 stay themselves
    return t.getTime();
  };
  return Math.round((utc(to) - utc(from)) / 86400000);
}

/** "Today", "Tomorrow", "in 5 days", "3 days ago" — counted from today at the place, not at the device. */
export function relPlaceDays(key: string, todayKey: string): string {
  const n = keyDayDiff(todayKey, key);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
