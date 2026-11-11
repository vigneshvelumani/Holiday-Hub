// ─────────────────────────────────────────────────────────────────────────────
// PROTECTED SYSTEM RULE — alternating office Saturdays
//
// Saturdays alternate WORKING → OFF → WORKING → … forever, counted from one fixed
// reference Saturday. The rule is pure arithmetic on the calendar date: it never
// reads user data, settings, storage, the current date or the viewed week, and no
// UI in the app writes to it. The only way to change the schedule is to edit the
// constant below in source code.
// ─────────────────────────────────────────────────────────────────────────────

import { addDays, startOfDay } from "./dates.ts";

/** Developer-controlled configuration. Saturday 14 November 2026 is a WORKING Saturday. */
export const OFFICE_SATURDAY_REFERENCE = Object.freeze({ year: 2026, month: 11, day: 14, status: "working" as const });

export type SaturdayStatus = "working" | "off";

const REF_UTC = Date.UTC(OFFICE_SATURDAY_REFERENCE.year, OFFICE_SATURDAY_REFERENCE.month - 1, OFFICE_SATURDAY_REFERENCE.day);

/** Office status for a date, or null when the date is not a Saturday. */
export function officeSaturday(date: Date): SaturdayStatus | null {
  if (date.getDay() !== 6) return null;
  const weeks = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - REF_UTC) / (7 * 86400000));
  const sameParity = ((weeks % 2) + 2) % 2 === 0;
  return sameParity ? "working" : "off";
}

/** The next Saturday on/after `from` with the requested status. */
export function nextOfficeSaturday(status: SaturdayStatus, from: Date = new Date()): Date {
  let d = startOfDay(from);
  d = addDays(d, (6 - d.getDay() + 7) % 7);
  while (officeSaturday(d) !== status) d = addDays(d, 7);
  return d;
}

/** Bank Saturday rule carried over from the original site: 2nd and 4th Saturdays are closed. */
export function bankSaturday(date: Date): "open" | "closed" | null {
  if (date.getDay() !== 6) return null;
  const nth = Math.ceil(date.getDate() / 7);
  return nth === 2 || nth === 4 ? "closed" : "open";
}

export const SATURDAY_LABEL: Record<SaturdayStatus, { long: string; short: string; tiny: string }> = {
  working: { long: "Working Saturday", short: "Working Sat", tiny: "WORK" },
  off: { long: "Non-working Saturday", short: "Off Saturday", tiny: "OFF" },
};
