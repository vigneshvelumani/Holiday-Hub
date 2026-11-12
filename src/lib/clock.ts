// Live time: a ticking "now" for the UI, and time-zone helpers for the world clock.

import { useEffect, useState } from "react";

/** Re-renders the caller every `stepMs`, aligned to the wall clock (1000 = on each second, 60000 = on each minute). */
export function useNow(stepMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number;
    const arm = () => {
      const wait = stepMs - (Date.now() % stepMs) + 5;
      timer = window.setTimeout(() => {
        setNow(new Date());
        arm();
      }, wait);
    };
    arm();
    const onShow = () => document.visibilityState === "visible" && setNow(new Date());
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [stepMs]);
  return now;
}

/** "YYYY-MM-DD" of the local day; changes exactly when the date rolls over. */
export function useTodayKey(): string {
  const now = useNow(60000);
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

export const LOCAL_TZ: string = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const partsCache = new Map<string, Intl.DateTimeFormat>();
export function zoneParts(tz: string, d: Date) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
    partsCache.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return { year: +o.year, month: +o.month, day: +o.day, hour: +o.hour, minute: +o.minute, second: +o.second, weekday: o.weekday };
}

/** Minutes east of UTC for a zone at an instant (India = 330). */
export function tzOffset(tz: string, d: Date): number {
  const p = zoneParts(tz, d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

export function gmtLabel(offsetMin: number): string {
  const sign = offsetMin < 0 ? "−" : "+";
  const a = Math.abs(offsetMin);
  return `GMT${sign}${Math.floor(a / 60)}${a % 60 ? ":" + String(a % 60).padStart(2, "0") : ""}`;
}

const nameCache = new Map<string, string>();
/** "India Standard Time", "Eastern Standard Time" … */
export function tzName(tz: string, d: Date = new Date(), style: "long" | "short" = "long"): string {
  // keyed by the offset in force at `d`, so a daylight-saving change inside a month gets the right name
  let off = 0;
  try {
    off = tzOffset(tz, d);
  } catch {
    /* unknown zone: falls through to the plain id below */
  }
  const key = `${tz}|${style}|${off}`;
  let v = nameCache.get(key);
  if (!v) {
    try {
      // abbreviations (IST, EST, BST…) only exist in the locale of the region that uses them
      const loc = (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") ? "en-IN" : tz.startsWith("Europe/") ? "en-GB" : tz.startsWith("Australia/") ? "en-AU" : "en-US";
      v = new Intl.DateTimeFormat(style === "short" ? loc : "en-GB", { timeZone: tz, timeZoneName: style }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value || tz;
    } catch {
      v = tz;
    }
    nameCache.set(key, v);
  }
  return v;
}

/** Human label for a zone: "India Standard Time · GMT+5:30". */
export const tzLabel = (tz: string, d: Date = new Date()) => `${tzName(tz, d)} · ${gmtLabel(tzOffset(tz, d))}`;

/** "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export const tzCity = (tz: string) => (tz.split("/").pop() || tz).replace(/_/g, " ").replace(/^Calcutta$/, "Kolkata");
export const tzRegion = (tz: string) => (tz.includes("/") ? tz.split("/")[0] : "Other");

let zones: string[] | null = null;
export function allTimeZones(): string[] {
  if (!zones) {
    try {
      zones = (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
    } catch {
      zones = ["UTC", "Asia/Kolkata", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];
    }
    if (!zones.includes("UTC")) zones = ["UTC", ...zones];
  }
  return zones;
}

export function fmtZone(d: Date, tz: string, hour12: boolean, seconds = false): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit", second: seconds ? "2-digit" : undefined, hour12 }).format(d);
}
export function fmtZoneDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
}

/** "5h 30m ahead", "10h 30m behind", "Same time". */
export function diffLabel(tz: string, base: string, d: Date): string {
  const m = tzOffset(tz, d) - tzOffset(base, d);
  if (m === 0) return "Same time";
  const a = Math.abs(m);
  return `${Math.floor(a / 60) ? Math.floor(a / 60) + "h " : ""}${a % 60 ? (a % 60) + "m " : ""}${m > 0 ? "ahead" : "behind"}`;
}

/** Instant at which a wall-clock time occurs in a zone. */
export function instantIn(tz: string, y: number, m: number, d: number, h: number, min: number): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess;
  for (let i = 0; i < 2; i++) t = guess - tzOffset(tz, new Date(t)) * 60000;
  return new Date(t);
}

export interface WorldClock {
  tz: string;
  label: string;
  /** known for cities added by search — enables sunrise / sunset */
  lat?: number;
  lon?: number;
}
export const DEFAULT_CLOCKS: WorldClock[] = [
  { tz: "America/New_York", label: "New York", lat: 40.7128, lon: -74.006 },
  { tz: "America/Los_Angeles", label: "Los Angeles", lat: 34.0522, lon: -118.2437 },
  { tz: "Europe/London", label: "London", lat: 51.5072, lon: -0.1276 },
  { tz: "Asia/Dubai", label: "Dubai", lat: 25.2048, lon: 55.2708 },
  { tz: "Asia/Singapore", label: "Singapore", lat: 1.3521, lon: 103.8198 },
  { tz: "Asia/Tokyo", label: "Tokyo", lat: 35.6762, lon: 139.6503 },
  { tz: "Australia/Sydney", label: "Sydney", lat: -33.8688, lon: 151.2093 },
];

/**
 * The next daylight-saving change in a zone within a year, found from the zone's own
 * rules (the browser's time-zone database) — not from a table of dates.
 */
export function nextDstChange(tz: string, from: Date = new Date()): { at: Date; deltaMin: number } | null {
  const base = tzOffset(tz, from);
  let lo = from.getTime();
  let hi = lo;
  let found = false;
  for (let i = 1; i <= 370; i++) {
    hi = from.getTime() + i * 86400000;
    if (tzOffset(tz, new Date(hi)) !== base) {
      found = true;
      break;
    }
    lo = hi;
  }
  if (!found) return null;
  while (hi - lo > 60000) {
    const mid = Math.floor((lo + hi) / 2);
    if (tzOffset(tz, new Date(mid)) === base) lo = mid;
    else hi = mid;
  }
  return { at: new Date(hi), deltaMin: tzOffset(tz, new Date(hi)) - base };
}

/** Calendar-day difference between a zone and the device: -1, 0 or +1. */
export function dayShift(tz: string, d: Date): number {
  const a = zoneParts(tz, d);
  const b = zoneParts(LOCAL_TZ, d);
  return Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86400000);
}


/** Name for "here": the chosen location when it shares this device's clock, otherwise the zone's city. */
export function hereName(location: { name: string; tz: string }, d: Date = new Date()): string {
  return tzOffset(location.tz, d) === tzOffset(LOCAL_TZ, d) ? location.name.split(",")[0] : tzCity(LOCAL_TZ);
}
