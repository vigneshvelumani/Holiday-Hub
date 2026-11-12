// Pure helpers behind the time converter and meeting planner (no React, no DOM),
// so they can be unit tested. Everything goes through the zone's real offset at
// the instant in question — never "today's" offset.

import { tzOffset, zoneParts } from "./clock.ts";

const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;

export type WallStatus = "ok" | "gap" | "ambiguous";

export interface WallResult {
  /** The instant used. */
  instant: Date;
  /**
   * ok        – the wall-clock time happens exactly once.
   * gap       – it never happens (clocks spring forward over it); `instant` is the same
   *             reading moved forward by the size of the gap (02:30 → 03:30).
   * ambiguous – it happens twice (clocks fall back); `instant` is the first
   *             occurrence and `later` is the second.
   */
  status: WallStatus;
  later?: Date;
  /** Minutes the wall-clock reading was moved forward to get out of a gap (0 otherwise). */
  shiftMin: number;
}

/** Instant at which a wall-clock date and time occurs in a zone, DST-aware. */
export function wallToInstant(tz: string, y: number, m: number, d: number, h: number, min: number): WallResult {
  const guess = Date.UTC(y, m - 1, d, h, min);
  // The true instant is within 14 h of `guess`, so the offsets a day either side
  // are the offsets before and after any transition that could affect it.
  const before = tzOffset(tz, new Date(guess - DAY));
  const after = tzOffset(tz, new Date(guess + DAY));
  const valid: number[] = [];
  for (const off of before === after ? [before] : [before, after]) {
    const t = guess - off * MIN;
    if (tzOffset(tz, new Date(t)) === off) valid.push(t);
  }
  valid.sort((a, b) => a - b);
  if (valid.length === 1) return { instant: new Date(valid[0]), status: "ok", shiftMin: 0 };
  if (valid.length > 1) return { instant: new Date(valid[0]), later: new Date(valid[1]), status: "ambiguous", shiftMin: 0 };
  // Nonexistent time: read it with the offset that applied before the jump, which
  // lands the same distance after the gap as the request was into it.
  return { instant: new Date(guess - before * MIN), status: "gap", shiftMin: Math.abs(after - before) };
}

export const parseDate = (s: string): [number, number, number] | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? [y, mo, d] : null;
};
export const parseTime = (s: string): [number, number] | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m && +m[1] < 24 && +m[2] < 60 ? [+m[1], +m[2]] : null;
};

const p2 = (n: number) => String(n).padStart(2, "0");
/** "YYYY-MM-DD" of an instant in a zone. */
export function zoneDate(tz: string, at: Date): string {
  const p = zoneParts(tz, at);
  return `${p.year}-${p2(p.month)}-${p2(p.day)}`;
}
/** "HH:MM" (24 h) of an instant in a zone. */
export function zoneTime(tz: string, at: Date): string {
  const p = zoneParts(tz, at);
  return `${p2(p.hour)}:${p2(p.minute)}`;
}

/** Whole calendar days between two "YYYY-MM-DD" strings (b − a). */
export function dateDiff(a: string, b: string): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  if (!pa || !pb) return 0;
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / DAY);
}

/** Calendar-day difference of a zone against a base zone at one instant: usually −1, 0 or +1. */
export const dayDiff = (tz: string, baseTz: string, at: Date): number => dateDiff(zoneDate(baseTz, at), zoneDate(tz, at));

export interface Conversion extends WallResult {
  /** Local date and 24 h time in the target zone. */
  date: string;
  time: string;
  /** Target date minus the source date in days. */
  dayDiff: number;
}

/** A date ("YYYY-MM-DD") and time ("HH:MM") in one zone, as seen in another. Null if the input is not a real date/time. */
export function convertWall(fromTz: string, date: string, time: string, toTz: string): Conversion | null {
  const d = parseDate(date);
  const t = parseTime(time);
  if (!d || !t) return null;
  const w = wallToInstant(fromTz, d[0], d[1], d[2], t[0], t[1]);
  return { ...w, date: zoneDate(toTz, w.instant), time: zoneTime(toTz, w.instant), dayDiff: dayDiff(toTz, fromTz, w.instant) };
}

// ── meeting planner ──

export const WORK_START = 9 * 60;
export const WORK_END = 18 * 60;
const EARLY_START = 7 * 60;
const LATE_END = 22 * 60;

/** work = 09:00–18:00, early = 07:00–09:00, late = 18:00–22:00, night = 22:00–07:00 (all local). */
export type HourKind = "work" | "early" | "late" | "night";
export const KIND_LABEL: Record<HourKind, string> = { work: "Working hours", early: "Early", late: "Late", night: "Night" };

/**
 * Classify a one-hour slot by the local minute of day it starts at. It only counts
 * as "work" if the whole hour is inside 09:00–18:00, so 17:30–18:30 is "late".
 */
export function slotKind(startMin: number, lengthMin = 60): HourKind {
  if (startMin >= WORK_START && startMin + lengthMin <= WORK_END) return "work";
  if (startMin >= EARLY_START && startMin < WORK_START) return "early";
  if (startMin >= WORK_START && startMin < LATE_END) return "late";
  return "night";
}

export interface PlanCell {
  /** Local minute of day the slot starts at in this zone. */
  startMin: number;
  /** Local "YYYY-MM-DD" in this zone. */
  date: string;
  kind: HourKind;
}
export interface PlanSlot {
  start: Date;
  /** Hour and minute on the planner's own (base zone) clock. */
  baseHour: number;
  baseMin: number;
  /** One per zone, in the order given. */
  cells: PlanCell[];
  /** How many zones are inside working hours for this whole hour. */
  workCount: number;
}
export interface DayPlan {
  slots: PlanSlot[];
  /** True when at least one hour has every zone in working hours. */
  common: boolean;
  /** The highest number of zones in working hours in any one hour. */
  maxCount: number;
  /** Indexes of the slots reaching `maxCount` (empty if no zone is ever in working hours). */
  best: number[];
}

/**
 * The hours of one calendar day in `baseTz` (23, 24 or 25 of them when the clocks
 * change that day), each seen from every zone in `zones`.
 */
export function planDay(baseTz: string, date: string, zones: string[]): DayPlan {
  const d = parseDate(date);
  const slots: PlanSlot[] = [];
  if (d) {
    let t = wallToInstant(baseTz, d[0], d[1], d[2], 0, 0).instant.getTime();
    const day = zoneDate(baseTz, new Date(t));
    for (let i = 0; i < 26 && zoneDate(baseTz, new Date(t)) === day; i++, t += HOUR) {
      const start = new Date(t);
      const bp = zoneParts(baseTz, start);
      const cells = zones.map((tz): PlanCell => {
        const p = zoneParts(tz, start);
        const startMin = p.hour * 60 + p.minute;
        return { startMin, date: `${p.year}-${p2(p.month)}-${p2(p.day)}`, kind: slotKind(startMin) };
      });
      slots.push({ start, baseHour: bp.hour, baseMin: bp.minute, cells, workCount: cells.filter((c) => c.kind === "work").length });
    }
  }
  const maxCount = slots.reduce((mx, s) => Math.max(mx, s.workCount), 0);
  const best = maxCount > 0 ? slots.flatMap((s, i) => (s.workCount === maxCount ? [i] : [])) : [];
  return { slots, common: zones.length > 0 && maxCount === zones.length, maxCount, best };
}

/** Group sorted slot indexes into runs of consecutive hours: [15,16,17,20] → [[15,17],[20,20]]. */
export function runs(idx: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const i of idx) {
    const last = out[out.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else out.push([i, i]);
  }
  return out;
}
