// Everything that can appear on a calendar day, gathered from every source.
// The office-Saturday rule is deliberately NOT part of this list: it is read
// straight from saturday.ts by the views and cannot be influenced by any item.

import { addDays, combine, dayDiff, daysInMonth, fmtTime, mkDate, parseYmd, startOfDay, today, uid, ymd, type Ymd } from "./dates.ts";
import { CATEGORY_LABEL, holidaysForYear, holidaysOn, primaryCategory, regionsOf, type Holiday } from "./holidays.ts";
import { nextOccurrence, occursOn, prevOccurrence, type Recurrence } from "./recurrence.ts";
import { saveItem, type Birthday, type CalEvent, type DataState, type Reminder, type Settings, type Task, type TaskStatus } from "./store.ts";

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

/** A task as stored, with the status it had before it was completed (so reopening can put it back). */
type TaskMemo = Task & { prevStatus?: TaskStatus };

/** The task after its checkbox is pressed for `date` — nothing is saved here. */
export function toggledTask(t: Task, date: Ymd): Task {
  if (t.recurrence.freq === "none") {
    const memo: TaskMemo = { ...t };
    if (t.status !== "done") {
      memo.prevStatus = t.status;
      memo.status = "done";
      memo.completedAt = Date.now();
    } else {
      // reopening restores "In progress" if that is what it was; otherwise it goes back to "To do"
      memo.status = memo.prevStatus === "in_progress" ? "in_progress" : "todo";
      memo.prevStatus = undefined;
      memo.completedAt = undefined;
    }
    return memo;
  }
  const has = t.doneDates.includes(date);
  return { ...t, doneDates: has ? t.doneDates.filter((d) => d !== date) : [...t.doneDates, date] };
}
export function toggleTask(t: Task, date: Ymd) {
  saveItem("tasks", toggledTask(t, date));
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

/** A task / reminder occurrence in the shape every list and calendar draws. */
export const taskItem = (t: Task, date: Ymd): DayItem => ({ key: "t:" + t.id, type: "task", title: t.title, tone: t.category === "Office" || t.category === "Meetings" ? "office" : "task", label: `${t.category} · ${t.priority}`, time: t.allDay ? undefined : t.startTime, done: taskDoneOn(t, date), date, task: t });
export const reminderItem = (r: Reminder, date: Ymd): DayItem => ({ key: "r:" + r.id, type: "reminder", title: r.message, tone: "reminder", label: "Reminder", time: r.time, done: reminderDoneOn(r, date), date, reminder: r });

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
      out.push(taskItem(t, key));
    }
  }
  if (want("reminder") && s.layers.reminders) {
    for (const r of data.reminders) {
      if (!occursOn(r.recurrence, r.date, date)) continue;
      out.push(reminderItem(r, key));
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

// ── list rows: one per task / reminder ───────────────────────────────────────
// The Tasks and Reminders pages, the dashboard and the sidebar badge all read these, so their numbers agree.
// They look at the stored items only — the calendar layer switches do not hide anything here.

/**
 * Where a repeating series stands today. The row is the latest occurrence up to today if it is still open
 * (today's when there is one); once that is ticked, the next open occurrence. Older missed occurrences are only
 * counted — they never come back as the row's date. A series with nothing open left is done, on its last date.
 */
function seriesState(rec: Recurrence, start: Ymd, doneDates: Ymd[], now: Date, handled?: (d: Ymd) => boolean): { date: Ymd; done: boolean; missed: number } {
  const isDone = (d: Date) => doneDates.includes(ymd(d));
  const openFrom = (from: Date): Date | null => {
    let d = nextOccurrence(rec, start, from);
    for (let i = 0; d && i < 400 && isDone(d); i++) d = nextOccurrence(rec, start, addDays(d, 1));
    return d;
  };
  const cur = prevOccurrence(rec, start, now);
  let at: Date;
  let done = false;
  if (cur && !isDone(cur)) at = (handled?.(ymd(cur)) && openFrom(addDays(cur, 1))) || cur;
  else {
    const next = openFrom(cur ? addDays(cur, 1) : now);
    if (next) at = next;
    else {
      // nothing open: the series has ended and its last occurrence is ticked
      at = cur ?? prevOccurrence(rec, start, addDays(now, 366 * 5)) ?? parseYmd(start);
      done = isDone(at);
    }
  }
  // occurrences missed in a row just before this one (back to the last one that was dealt with)
  let missed = 0;
  if (!done) {
    let p = prevOccurrence(rec, start, addDays(at, -1));
    while (p && missed < 999 && !isDone(p) && !handled?.(ymd(p))) {
      missed++;
      p = prevOccurrence(rec, start, addDays(p, -1));
    }
  }
  return { date: ymd(at), done, missed };
}

export interface TaskRow {
  t: Task;
  /** the due date; for a repeating task, the occurrence the row stands for */
  date: Ymd;
  done: boolean;
  overdue: boolean;
  /** repeating only: earlier occurrences in a row that were never ticked */
  missed: number;
}
export function taskRow(t: Task, now: Date = today()): TaskRow {
  const key = ymd(now);
  if (t.recurrence.freq === "none") {
    const done = t.status === "done";
    return { t, date: t.dueDate, done, overdue: !done && t.dueDate < key, missed: 0 };
  }
  const st = seriesState(t.recurrence, t.dueDate, t.doneDates, startOfDay(now));
  return { t, ...st, overdue: !st.done && st.date < key };
}
export const taskRows = (tasks: Task[], now: Date = today()): TaskRow[] => tasks.map((t) => taskRow(t, now));
/** Open tasks, most overdue first, then by date and priority. */
export const openTaskRows = (tasks: Task[], now: Date = today()): TaskRow[] =>
  taskRows(tasks, now)
    .filter((r) => !r.done)
    .sort((a, b) => a.date.localeCompare(b.date) || PRIORITY_RANK[a.t.priority] - PRIORITY_RANK[b.t.priority]);

export interface ReminderRow {
  r: Reminder;
  date: Ymd;
  /** the scheduled moment of this occurrence */
  at: Date;
  done: boolean;
  overdue: boolean;
  missed: number;
}
export function reminderRow(r: Reminder, now: Date = new Date()): ReminderRow {
  if (r.recurrence.freq === "none") {
    const at = combine(r.date, r.time);
    return { r, date: r.date, at, done: r.done, overdue: !r.done && at < now, missed: 0 };
  }
  // a past occurrence that already notified is dealt with: the next one is what matters
  const notified = (d: Ymd) => combine(d, r.time) < now && r.fired.includes(d);
  const st = seriesState(r.recurrence, r.date, r.doneDates, startOfDay(now), notified);
  const at = combine(st.date, r.time);
  return { r, ...st, at, overdue: !st.done && at < now };
}
export const reminderRows = (reminders: Reminder[], now: Date = new Date()): ReminderRow[] => reminders.map((r) => reminderRow(r, now));
/** Open reminders, overdue ones first, then in time order. */
export const openReminderRows = (reminders: Reminder[], now: Date = new Date()): ReminderRow[] =>
  reminderRows(reminders, now)
    .filter((x) => !x.done)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

export const timeLabel = (i: DayItem, hour12: boolean) => (i.time ? fmtTime(i.time, hour12) : "");

// ── moving things (drag & drop) ──────────────────────────────────────────────
export const isRepeating = (item: DayItem): boolean => ((item.task || item.reminder || item.event)?.recurrence.freq ?? "none") !== "none";

/**
 * Reschedule a user item to another day. Holidays, salary day and the Saturday rule are not movable.
 * A repeating item is refused: moving one occurrence would shift the whole series and wipe its history,
 * so its dates are changed by editing it instead.
 */
export function moveItem(item: DayItem, to: Ymd): boolean {
  if (item.date === to || isRepeating(item)) return false;
  const shift = dayDiff(parseYmd(item.date), parseYmd(to));
  const move = (k: Ymd) => ymd(addDays(parseYmd(k), shift));
  if (item.task) {
    const t = item.task;
    saveItem("tasks", { ...t, dueDate: move(t.dueDate), startDate: t.startDate ? move(t.startDate) : undefined });
    return true;
  }
  if (item.reminder) {
    saveItem("reminders", { ...item.reminder, date: move(item.reminder.date), fired: [] });
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
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** "dec", "sept", "december" → 11; anything that is not the start of a month name → -1. */
const monthIndex = (word: string) => (word.length < 3 ? -1 : MONTH_NAMES.findIndex((m) => m.startsWith(word)));

/**
 * "2027-03-14", "14 Mar 2027", "March 2030", "2031" → a date to jump to.
 * Without a year ("25 dec", "dec 25", "december") it is the next such date from `now` (today counts).
 */
export function parseDateQuery(q: string, now: Date = today()): Date | null {
  const s = q.trim().toLowerCase();
  const dayMonth = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,})\.?$/);
  const monthDay = s.match(/^([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/);
  if (dayMonth || monthDay) {
    const mi = monthIndex(dayMonth ? dayMonth[2] : monthDay![1]);
    const day = +(dayMonth ? dayMonth[1] : monthDay![2]);
    if (mi < 0) return null;
    // up to 8 years ahead, so 29 Feb finds its next leap year
    for (let y = now.getFullYear(); y <= now.getFullYear() + 8; y++) {
      const d = validDate(y, mi, day);
      if (d && dayDiff(now, d) >= 0) return d;
    }
    return null;
  }
  const monthOnly = s.match(/^([a-z]{3,})\.?$/);
  if (monthOnly) {
    const mi = monthIndex(monthOnly[1]);
    if (mi < 0) return null;
    // the month in progress counts as the next one
    return validDate(now.getFullYear() + (mi < now.getMonth() ? 1 : 0), mi, 1);
  }
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
