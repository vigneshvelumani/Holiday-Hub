// Everything that can appear on a calendar day, gathered from every source.
// The office-Saturday rule is deliberately NOT part of this list: it is read
// straight from saturday.ts by the views and cannot be influenced by any item.

import { addDays, combine, dayDiff, daysInMonth, fmtTime, mkDate, parseYmd, today, uid, ymd, type Ymd } from "./dates.ts";
import { CATEGORY_LABEL, holidaysForYear, holidaysOn, primaryCategory, regionsOf, type Holiday } from "./holidays.ts";
import { nextOccurrence, occursOn } from "./recurrence.ts";
import { saveItem, type Birthday, type CalEvent, type DataState, type Reminder, type Settings, type Task } from "./store.ts";

export type ItemType = "holiday" | "task" | "reminder" | "event" | "birthday" | "salary";

export interface DayItem {
  key: string;
  type: ItemType;
  title: string;
  /** css colour token name, e.g. "india", "task" */
  tone: string;
  label: string;
  time?: string;
  done?: boolean;
  date: Ymd;
  holiday?: Holiday;
  task?: Task;
  reminder?: Reminder;
  event?: CalEvent;
  birthday?: Birthday;
}

export interface ItemFilter {
  types?: Set<ItemType>;
  taskCategory?: string;
  priority?: string;
  text?: string;
}

export const enabledCategories = (s: Settings): Set<string> => new Set(Object.keys(s.categories).filter((k) => s.categories[k]));

export function taskDoneOn(t: Task, date: Ymd): boolean {
  return t.recurrence.freq === "none" ? t.status === "done" : t.doneDates.includes(date);
}
export function reminderDoneOn(r: Reminder, date: Ymd): boolean {
  return r.recurrence.freq === "none" ? r.done : r.doneDates.includes(date);
}

export function toggleTask(t: Task, date: Ymd) {
  if (t.recurrence.freq === "none") {
    const done = t.status !== "done";
    saveItem("tasks", { ...t, status: done ? "done" : "todo", completedAt: done ? Date.now() : undefined });
  } else {
    const has = t.doneDates.includes(date);
    saveItem("tasks", { ...t, doneDates: has ? t.doneDates.filter((d) => d !== date) : [...t.doneDates, date] });
  }
}
export function toggleReminder(r: Reminder, date: Ymd) {
  if (r.recurrence.freq === "none") saveItem("reminders", { ...r, done: !r.done });
  else {
    const has = r.doneDates.includes(date);
    saveItem("reminders", { ...r, doneDates: has ? r.doneDates.filter((d) => d !== date) : [...r.doneDates, date] });
  }
}

export function birthdayOn(b: Birthday, date: Date): boolean {
  const day = Math.min(b.day, daysInMonth(date.getFullYear(), b.month - 1));
  return date.getMonth() === b.month - 1 && date.getDate() === day;
}
export function nextBirthday(b: Birthday, from = today()): Date {
  for (let y = from.getFullYear(); ; y++) {
    const d = mkDate(y, b.month - 1, Math.min(b.day, daysInMonth(y, b.month - 1)));
    if (dayDiff(from, d) >= 0) return d;
  }
}
export function salaryDate(y: number, m0: number, salaryDay: number): Date {
  return mkDate(y, m0, Math.min(salaryDay, daysInMonth(y, m0)));
}
export function nextSalary(salaryDay: number, from = today()): Date {
  const a = salaryDate(from.getFullYear(), from.getMonth(), salaryDay);
  return dayDiff(from, a) >= 0 ? a : salaryDate(from.getFullYear(), from.getMonth() + 1, salaryDay);
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export function itemsOn(date: Date, data: DataState, s: Settings, f: ItemFilter = {}): DayItem[] {
  const key = ymd(date);
  const out: DayItem[] = [];
  const want = (t: ItemType) => !f.types || f.types.has(t);
  const cats = enabledCategories(s);

  if (want("holiday")) {
    for (const h of holidaysOn(date, cats)) {
      const c = primaryCategory(h, cats);
      out.push({ key: "h:" + h.id, type: "holiday", title: h.name, tone: c, label: `${CATEGORY_LABEL[c]} · ${regionsOf(h)}`, date: key, holiday: h });
    }
  }
  if (want("birthday") && s.categories.birthday) {
    for (const b of data.birthdays) {
      if (!birthdayOn(b, date)) continue;
      const age = b.year ? date.getFullYear() - b.year : null;
      out.push({ key: "b:" + b.id, type: "birthday", title: `${b.name}'s birthday${age && age > 0 ? ` (${age})` : ""}`, tone: "birthday", label: "Birthday", date: key, birthday: b });
    }
  }
  if (want("salary") && s.layers.salary && ymd(salaryDate(date.getFullYear(), date.getMonth(), s.salaryDay)) === key) {
    out.push({ key: "s:" + key, type: "salary", title: "Salary day", tone: "salary", label: "Salary", date: key });
  }
  if (want("event") && s.layers.events) {
    for (const e of data.events) {
      if (!occursOn(e.recurrence, e.date, date)) continue;
      out.push({ key: "e:" + e.id, type: "event", title: e.title, tone: "event", label: e.category || "Event", time: e.allDay ? undefined : e.startTime, date: key, event: e });
    }
  }
  if (want("task") && s.layers.tasks) {
    for (const t of data.tasks) {
      if (!occursOn(t.recurrence, t.dueDate, date)) continue;
      if (f.taskCategory && t.category !== f.taskCategory) continue;
      if (f.priority && t.priority !== f.priority) continue;
      out.push({ key: "t:" + t.id, type: "task", title: t.title, tone: t.category === "Office" || t.category === "Meetings" ? "office" : "task", label: `${t.category} · ${t.priority}`, time: t.allDay ? undefined : t.startTime, done: taskDoneOn(t, key), date: key, task: t });
    }
  }
  if (want("reminder") && s.layers.reminders) {
    for (const r of data.reminders) {
      if (!occursOn(r.recurrence, r.date, date)) continue;
      out.push({ key: "r:" + r.id, type: "reminder", title: r.message, tone: "reminder", label: "Reminder", time: r.time, done: reminderDoneOn(r, key), date: key, reminder: r });
    }
  }
  const q = f.text?.trim().toLowerCase();
  const list = q ? out.filter((i) => (i.title + " " + i.label + " " + (i.task?.description || "") + " " + (i.holiday?.description || "")).toLowerCase().includes(q)) : out;
  const order: ItemType[] = ["holiday", "birthday", "salary", "event", "task", "reminder"];
  return list.sort((a, b) => {
    const t = order.indexOf(a.type) - order.indexOf(b.type);
    if (t) return t;
    if (a.type === "holiday") return 0; // keep the engine order: public → festival → observance → bank
    if (a.task && b.task && a.task.priority !== b.task.priority) return PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority];
    return (a.time || "") < (b.time || "") ? -1 : (a.time || "") > (b.time || "") ? 1 : a.title.localeCompare(b.title);
  });
}

export function itemsBetween(from: Date, days: number, data: DataState, s: Settings, f: ItemFilter = {}): { date: Date; items: DayItem[] }[] {
  const out: { date: Date; items: DayItem[] }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const items = itemsOn(d, data, s, f);
    if (items.length) out.push({ date: d, items });
  }
  return out;
}

export const timeLabel = (i: DayItem, hour12: boolean) => (i.time ? fmtTime(i.time, hour12) : "");

// ── moving things (drag & drop) ──────────────────────────────────────────────
/** Reschedule a user item to another day. Holidays, salary day and the Saturday rule are not movable. */
export function moveItem(item: DayItem, to: Ymd): boolean {
  if (item.date === to) return false;
  const shift = dayDiff(parseYmd(item.date), parseYmd(to));
  const move = (k: Ymd) => ymd(addDays(parseYmd(k), shift));
  if (item.task) {
    const t = item.task;
    saveItem("tasks", { ...t, dueDate: move(t.dueDate), startDate: t.startDate ? move(t.startDate) : undefined, doneDates: [] });
    return true;
  }
  if (item.reminder) {
    saveItem("reminders", { ...item.reminder, date: move(item.reminder.date), fired: [], doneDates: [] });
    return true;
  }
  if (item.event) {
    saveItem("events", { ...item.event, date: move(item.event.date) });
    return true;
  }
  return false;
}

// ── search ───────────────────────────────────────────────────────────────────
export interface SearchHit {
  key: string;
  type: ItemType | "note" | "date";
  title: string;
  sub: string;
  date: Date;
  tone: string;
}

const MONTH_ALIASES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "2027-03-14", "14 Mar 2027", "March 2030", "2031" → a date to jump to. */
export function parseDateQuery(q: string): Date | null {
  const s = q.trim().toLowerCase();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validDate(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return validDate(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{1,2})\s+([a-z]{3,})\.?,?\s+(\d{4})$/) || null;
  if (m) {
    const mi = MONTH_ALIASES.indexOf(m[2].slice(0, 3));
    if (mi >= 0) return validDate(+m[3], mi, +m[1]);
  }
  m = s.match(/^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/) || null;
  if (m) {
    const mi = MONTH_ALIASES.indexOf(m[1].slice(0, 3));
    if (mi >= 0) return validDate(+m[3], mi, +m[2]);
  }
  m = s.match(/^([a-z]{3,})\.?\s+(\d{4})$/) || null;
  if (m) {
    const mi = MONTH_ALIASES.indexOf(m[1].slice(0, 3));
    if (mi >= 0) return validDate(+m[2], mi, 1);
  }
  m = s.match(/^(\d{4})$/);
  if (m) return validDate(+m[1], 0, 1);
  return null;
}
function validDate(y: number, m0: number, d: number): Date | null {
  if (m0 < 0 || m0 > 11 || d < 1 || d > daysInMonth(y, m0) || y < 1 || y > 9999) return null;
  return mkDate(y, m0, d);
}

export function search(q: string, data: DataState, s: Settings, limit = 40): SearchHit[] {
  const text = q.trim().toLowerCase();
  if (text.length < 2) return [];
  const hits: SearchHit[] = [];
  const now = today();
  const jump = parseDateQuery(q);
  if (jump) hits.push({ key: "date", type: "date", title: `Go to ${jump.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`, sub: "Jump to date", date: jump, tone: "ink" });
  const has = (...parts: (string | undefined)[]) => parts.some((p) => p && p.toLowerCase().includes(text));

  for (const t of data.tasks) {
    if (!has(t.title, t.description, t.notes, t.category)) continue;
    const d = nextOccurrence(t.recurrence, t.dueDate, now) || parseYmd(t.dueDate);
    hits.push({ key: "t:" + t.id, type: "task", title: t.title, sub: `Task · ${t.category} · ${t.priority} priority`, date: d, tone: "task" });
  }
  for (const r of data.reminders) {
    if (!has(r.message)) continue;
    hits.push({ key: "r:" + r.id, type: "reminder", title: r.message, sub: "Reminder", date: nextOccurrence(r.recurrence, r.date, now) || parseYmd(r.date), tone: "reminder" });
  }
  for (const e of data.events) {
    if (!has(e.title, e.description, e.category)) continue;
    hits.push({ key: "e:" + e.id, type: "event", title: e.title, sub: "Event", date: nextOccurrence(e.recurrence, e.date, now) || parseYmd(e.date), tone: "event" });
  }
  for (const n of data.notes) {
    if (!has(n.content)) continue;
    hits.push({ key: "n:" + n.id, type: "note", title: n.content.slice(0, 80), sub: "Note", date: parseYmd(n.id), tone: "ink" });
  }
  for (const b of data.birthdays) {
    if (!has(b.name, "birthday")) continue;
    hits.push({ key: "b:" + b.id, type: "birthday", title: `${b.name}'s birthday`, sub: "Birthday", date: nextBirthday(b, now), tone: "birthday" });
  }
  // holidays: this year and next, upcoming first; every category is searchable
  const y = now.getFullYear();
  const seen = new Set<string>();
  for (const h of [...holidaysForYear(y), ...holidaysForYear(y + 1)]) {
    if (h.kind === "bank" || !has(h.name, h.description, regionsOf(h))) continue;
    const d = parseYmd(h.date);
    if (dayDiff(now, d) < 0 && holidaysForYear(y + 1).some((x) => x.name === h.name)) continue; // already passed → show next year's
    if (seen.has(h.name)) continue;
    seen.add(h.name);
    const c = primaryCategory(h);
    hits.push({ key: "h:" + h.id, type: "holiday", title: h.name, sub: `Holiday · ${regionsOf(h)}`, date: d, tone: c });
  }
  return hits.slice(0, limit);
}

// ── factories ────────────────────────────────────────────────────────────────
export function newTask(date: Ymd, patch: Partial<Task> = {}): Task {
  return { id: uid(), title: "", dueDate: date, startDate: date, allDay: true, priority: "medium", category: "Personal", status: "todo", recurrence: { freq: "none" }, doneDates: [], createdAt: Date.now(), ...patch };
}
export function newReminder(date: Ymd, patch: Partial<Reminder> = {}): Reminder {
  return { id: uid(), message: "", date, time: "09:00", lead: 0, recurrence: { freq: "none" }, done: false, doneDates: [], fired: [], createdAt: Date.now(), ...patch };
}
export function newEvent(date: Ymd, patch: Partial<CalEvent> = {}): CalEvent {
  return { id: uid(), title: "", date, allDay: true, category: "Personal", recurrence: { freq: "none" }, createdAt: Date.now(), ...patch };
}

/** When a reminder occurrence should notify. */
export const reminderFireTime = (r: Reminder, occurrence: Ymd): Date => new Date(combine(occurrence, r.time).getTime() - r.lead * 60000);
