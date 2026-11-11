// Reminder scheduler. It runs while the app is open in a tab (foreground or
// background). There is deliberately no server and no push service, so nothing
// can fire while the browser is fully closed — anything that came due in the
// meantime is delivered as "missed" the next time the app is opened.

import { addDays, combine, dayDiff, today, uid, ymd } from "./dates.ts";
import { birthdayOn, nextSalary, reminderDoneOn, reminderFireTime } from "./items.ts";
import { occursOn } from "./recurrence.ts";
import { getData, getSettings, saveItem, type AppNotification } from "./store.ts";

export type Toast = { id: string; title: string; body?: string; tone?: "info" | "ok" | "warn" };
const toastListeners = new Set<(t: Toast) => void>();
export const onToast = (fn: (t: Toast) => void) => {
  toastListeners.add(fn);
  return () => void toastListeners.delete(fn);
};
export function toast(title: string, body?: string, tone: Toast["tone"] = "info") {
  const t = { id: uid(), title, body, tone };
  toastListeners.forEach((l) => l(t));
}

export const notificationsSupported = () => typeof window !== "undefined" && "Notification" in window;
export const notificationPermission = (): NotificationPermission | "unsupported" => (notificationsSupported() ? Notification.permission : "unsupported");

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Deliver a notification: always to the in-app centre, and to the OS if permitted. */
export function notify(title: string, body: string, dateKey?: string, quiet = false) {
  const n: AppNotification = { id: uid(), title, body, at: Date.now(), read: false, dateKey };
  saveItem("notifications", n);
  if (!quiet) toast(title, body, "info");
  if (notificationsSupported() && Notification.permission === "granted") {
    try {
      new Notification(title, { body, icon: "/favicon.svg", tag: n.id });
    } catch {
      /* some mobile browsers only allow notifications from a service worker */
    }
  }
}

// one-per-day markers for the settings-driven alerts (salary / birthdays / events)
const FIRED_KEY = "almanac.fired.v1";
function firedSet(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function once(key: string): boolean {
  const all = firedSet();
  if (all[key]) return false;
  all[key] = Date.now();
  const cutoff = Date.now() - 90 * 86400000;
  for (const k of Object.keys(all)) if (all[k] < cutoff) delete all[k];
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  return true;
}

const reached = (hhmm: string, now: Date) => now.getTime() >= combine(ymd(now), hhmm).getTime();
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function tick(now = new Date()) {
  const data = getData();
  if (!data.ready) return;
  const s = getSettings();
  const t0 = today();

  // ── user reminders ──
  for (const r of data.reminders) {
    const span = Math.ceil(r.lead / 1440) + 1;
    for (let i = -1; i <= span; i++) {
      const day = addDays(t0, i);
      const key = ymd(day);
      if (!occursOn(r.recurrence, r.date, day) || r.fired.includes(key) || reminderDoneOn(r, key)) continue;
      const at = reminderFireTime(r, key);
      const late = now.getTime() - at.getTime();
      if (late < 0 || late > 36 * 3600000) continue;
      const when = combine(key, r.time);
      // "missed" only when the scheduled moment itself has passed, not when an early alert arrives late
      const missed = late > 5 * 60000 && now.getTime() > when.getTime() + 5 * 60000;
      const lead = r.lead ? ` (${r.lead >= 1440 ? plural(Math.round(r.lead / 1440), "day") : r.lead >= 60 ? plural(Math.round(r.lead / 60), "hour") : plural(r.lead, "minute")} before)` : "";
      notify(missed ? "Missed reminder" : "Reminder", `${r.message} — ${when.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: s.hour12 })}${lead}`, key);
      // re-read: an earlier iteration may already have saved this reminder
      const cur = getData().reminders.find((x) => x.id === r.id) || r;
      saveItem("reminders", { ...cur, fired: [...cur.fired, key].slice(-60) });
    }
  }

  // ── salary day ──
  const todayKey = ymd(t0);
  if (s.notify.salary && reached(s.notify.salaryTime, now)) {
    const pay = nextSalary(s.salaryDay, t0);
    const days = dayDiff(t0, pay);
    if (days === 0 && once(`salary:${todayKey}`)) notify("Salary day", "Today is your salary day.", todayKey);
    else if (days > 0 && days === s.notify.salaryLead && once(`salary-lead:${todayKey}`)) notify("Salary coming up", `Salary day is in ${plural(days, "day")}.`, ymd(pay));
  }
  // ── birthdays ──
  if (s.notify.birthday && reached(s.notify.birthdayTime, now)) {
    for (const b of data.birthdays) {
      if (birthdayOn(b, t0) && once(`bday:${b.id}:${todayKey}`)) notify("Birthday today!", `${b.name}'s birthday is today.`, todayKey);
      const ahead = addDays(t0, s.notify.birthdayLead);
      if (s.notify.birthdayLead > 0 && birthdayOn(b, ahead) && once(`bday-lead:${b.id}:${todayKey}`)) notify("Birthday coming up", `${b.name}'s birthday is in ${plural(s.notify.birthdayLead, "day")}.`, ymd(ahead));
    }
  }
  // ── events ──
  if (s.notify.events && reached(s.notify.eventTime, now)) {
    const target = addDays(t0, s.notify.eventLead);
    for (const e of data.events) {
      if (occursOn(e.recurrence, e.date, target) && once(`event:${e.id}:${ymd(target)}`))
        notify(s.notify.eventLead ? "Event coming up" : "Event today", s.notify.eventLead ? `${e.title} is in ${plural(s.notify.eventLead, "day")}.` : e.title, ymd(target));
    }
  }
}

let timer: number | undefined;
export function startScheduler() {
  if (timer !== undefined) return;
  const run = () => {
    try {
      tick();
    } catch (err) {
      console.error("Reminder check failed", err);
    }
  };
  timer = window.setInterval(run, 15000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && run());
  window.setTimeout(run, 1500);
}
