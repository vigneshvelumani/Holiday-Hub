import { addDays, dayDiff, daysInMonth, parseYmd, ymd, type Ymd } from "./dates.ts";

export type Freq = "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom";
export type Unit = "day" | "week" | "month" | "year";

export interface Recurrence {
  freq: Freq;
  /** custom only: repeat every `interval` `unit`s */
  interval?: number;
  unit?: Unit;
  /** weekly / custom-week: weekdays (0 = Sunday). Empty → the start date's weekday. */
  weekdays?: number[];
  /** last date (inclusive) on which the series may occur */
  until?: Ymd;
}

export const NO_REPEAT: Recurrence = { freq: "none" };

function normalise(r: Recurrence | undefined): { unit: Unit; interval: number; weekdays?: number[]; until?: Ymd } | null {
  if (!r || r.freq === "none") return null;
  const unit: Unit = r.freq === "daily" ? "day" : r.freq === "weekly" ? "week" : r.freq === "monthly" ? "month" : r.freq === "yearly" ? "year" : r.unit || "day";
  const interval = r.freq === "custom" ? Math.max(1, Math.floor(r.interval || 1)) : 1;
  return { unit, interval, weekdays: r.weekdays?.length ? r.weekdays : undefined, until: r.until };
}

/** Does a series that starts on `start` occur on `date`? */
export function occursOn(r: Recurrence | undefined, start: Ymd, date: Date): boolean {
  const s = parseYmd(start);
  const diff = dayDiff(s, date);
  if (diff < 0) return false;
  const n = normalise(r);
  if (!n) return diff === 0;
  if (n.until && ymd(date) > n.until) return false;

  switch (n.unit) {
    case "day":
      return diff % n.interval === 0;
    case "week": {
      const days = n.weekdays ?? [s.getDay()];
      if (!days.includes(date.getDay())) return false;
      // weeks are counted from the Sunday of the start week
      const weekIndex = Math.floor((diff + s.getDay()) / 7);
      return weekIndex % n.interval === 0;
    }
    case "month": {
      const months = (date.getFullYear() - s.getFullYear()) * 12 + date.getMonth() - s.getMonth();
      if (months % n.interval !== 0) return false;
      // the 29th–31st fall back to the last day of shorter months
      const target = Math.min(s.getDate(), daysInMonth(date.getFullYear(), date.getMonth()));
      return date.getDate() === target;
    }
    case "year": {
      const years = date.getFullYear() - s.getFullYear();
      if (years % n.interval !== 0 || date.getMonth() !== s.getMonth()) return false;
      const target = Math.min(s.getDate(), daysInMonth(date.getFullYear(), date.getMonth()));
      return date.getDate() === target;
    }
  }
}

/** First occurrence on or after `from` (searches up to `horizonDays`). */
export function nextOccurrence(r: Recurrence | undefined, start: Ymd, from: Date, horizonDays = 366 * 5): Date | null {
  const s = parseYmd(start);
  let d = dayDiff(s, from) > 0 ? from : s;
  if (!r || r.freq === "none") return dayDiff(from, s) >= 0 ? s : null;
  for (let i = 0; i <= horizonDays; i++) {
    if (occursOn(r, start, d)) return d;
    d = addDays(d, 1);
  }
  return null;
}

export function describeRecurrence(r: Recurrence | undefined): string {
  if (!r || r.freq === "none") return "Does not repeat";
  const until = r.until ? ` until ${r.until}` : "";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days = r.weekdays?.length ? ` on ${r.weekdays.map((d) => names[d]).join(", ")}` : "";
  if (r.freq === "daily") return "Every day" + until;
  if (r.freq === "weekly") return "Every week" + days + until;
  if (r.freq === "monthly") return "Every month" + until;
  if (r.freq === "yearly") return "Every year" + until;
  const n = Math.max(1, r.interval || 1);
  const unit = r.unit || "day";
  return `Every ${n === 1 ? "" : n + " "}${unit}${n === 1 ? "" : "s"}${unit === "week" ? days : ""}${until}`;
}
