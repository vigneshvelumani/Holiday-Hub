// Local-only persistence. Structured records live in IndexedDB, lightweight
// preferences in localStorage. Nothing is sent to a server and nothing expires:
// data stays until the visitor clears this site's browser data.

import { useSyncExternalStore } from "react";
import type { Recurrence } from "./recurrence.ts";
import { isValidYmd, type Ymd } from "./dates.ts";
import { CHENNAI, type Place } from "./astro.ts";
import { DEFAULT_CLOCKS, type WorldClock } from "./clock.ts";

// ── record types ─────────────────────────────────────────────────────────────
export type Priority = "high" | "medium" | "low";
export type TaskStatus = "todo" | "in_progress" | "done";

export interface Task {
  id: string;
  title: string;
  description?: string;
  notes?: string;
  startDate?: Ymd;
  /** the day the task is shown on (and the anchor of a recurring series) */
  dueDate: Ymd;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  priority: Priority;
  category: string;
  status: TaskStatus;
  recurrence: Recurrence;
  /** completed occurrences of a recurring task */
  doneDates: Ymd[];
  createdAt: number;
  completedAt?: number;
}

export interface Reminder {
  id: string;
  message: string;
  date: Ymd;
  time: string;
  /** minutes before the scheduled time at which to notify */
  lead: number;
  recurrence: Recurrence;
  done: boolean;
  doneDates: Ymd[];
  /** occurrence dates that have already produced a notification */
  fired: Ymd[];
  createdAt: number;
}

export interface CalEvent {
  id: string;
  title: string;
  description?: string;
  date: Ymd;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  category: string;
  recurrence: Recurrence;
  createdAt: number;
}

export interface Note {
  id: Ymd;
  content: string;
  updatedAt: number;
}
export type MoodValue = "happy" | "neutral" | "sad";
export interface Mood {
  id: Ymd;
  mood: MoodValue;
  note?: string;
}
export interface Birthday {
  id: string;
  name: string;
  month: number;
  day: number;
  year?: number;
  notes?: string;
}
export interface AppNotification {
  id: string;
  title: string;
  body: string;
  at: number;
  read: boolean;
  dateKey?: Ymd;
}

export interface Bookmark {
  id: string;
  link: string;
  title: string;
  source: string;
  pubDate: string | null;
  summary: string;
  image?: string;
  category?: string;
  savedAt: number;
}

export interface Collections {
  tasks: Task[];
  reminders: Reminder[];
  events: CalEvent[];
  notes: Note[];
  moods: Mood[];
  birthdays: Birthday[];
  notifications: AppNotification[];
  bookmarks: Bookmark[];
}
export type StoreName = keyof Collections;
const STORES: StoreName[] = ["tasks", "reminders", "events", "notes", "moods", "birthdays", "notifications", "bookmarks"];

export interface DataState extends Collections {
  ready: boolean;
  /** "indexeddb" normally; "memory" when the browser refuses storage (data then lasts only for this tab) */
  backend: "indexeddb" | "memory";
}

// ── IndexedDB ────────────────────────────────────────────────────────────────
const DB_NAME = "almanac-calendar";
const DB_VERSION = 2; // v2 adds "bookmarks"
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("IndexedDB blocked"));
    });
  }
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

// ── in-memory mirror + subscriptions ─────────────────────────────────────────
let state: DataState = { tasks: [], reminders: [], events: [], notes: [], moods: [], birthdays: [], notifications: [], bookmarks: [], ready: false, backend: "indexeddb" };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
// only in a browser tab: under Node (the unit tests) an open channel would keep the process alive
const channel = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("almanac-calendar") : null;

// A read from the database must never overwrite something this tab has written since the read
// began. Each local write bumps the store's counter and is counted as pending until its
// transaction completes; a read that overlapped a write is thrown away and repeated afterwards.
const zeroes = (): Record<StoreName, number> => ({ tasks: 0, reminders: 0, events: 0, notes: 0, moods: 0, birthdays: 0, notifications: 0, bookmarks: 0 });
const writeSeq = zeroes();
const pendingWrites = zeroes();
const reloadWanted = new Set<StoreName>();

/** Re-read one collection (another tab changed it), unless a local write is newer than the read. */
async function reloadStore(store: StoreName): Promise<void> {
  if (state.backend !== "indexeddb") return;
  if (pendingWrites[store] > 0) {
    reloadWanted.add(store); // picked up when the write lands
    return;
  }
  const seq = writeSeq[store];
  let rows: unknown;
  try {
    rows = (await tx(store, "readonly", (os) => os.getAll())) || [];
  } catch (err) {
    console.warn("Could not re-read", store, err);
    return;
  }
  if (writeSeq[store] !== seq || pendingWrites[store] > 0) {
    // written locally while reading: this snapshot is older than what is on screen
    if (pendingWrites[store] > 0) reloadWanted.add(store);
    else void reloadStore(store);
    return;
  }
  state = { ...state, [store]: rows };
  emit();
}

async function loadAll(): Promise<void> {
  try {
    const seqs = { ...writeSeq };
    const lists = await Promise.all(STORES.map((s) => tx(s, "readonly", (os) => os.getAll())));
    const next: Record<string, unknown> = {};
    const redo: StoreName[] = [];
    STORES.forEach((s, i) => {
      if (writeSeq[s] === seqs[s] && pendingWrites[s] === 0) next[s] = lists[i] || [];
      else redo.push(s);
    });
    state = { ...state, ...(next as Partial<Collections>), ready: true, backend: "indexeddb" };
    emit();
    for (const s of redo) void reloadStore(s);
    return;
  } catch (err) {
    console.warn("Local database unavailable; keeping data in memory for this tab only.", err);
    state = { ...state, ready: true, backend: "memory" };
  }
  emit();
}

let started = false;
export function initStore() {
  if (started) return;
  started = true;
  void loadAll();
  // keep several open tabs in step: the message names the collection that changed
  channel?.addEventListener("message", (e: MessageEvent) => void (STORES.includes(e.data as StoreName) ? reloadStore(e.data as StoreName) : loadAll()));
  // ask the browser not to evict this site's data under storage pressure
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}

function persist(store: StoreName, run: (s: IDBObjectStore) => void) {
  writeSeq[store]++;
  if (state.backend !== "indexeddb" || typeof indexedDB === "undefined") return;
  pendingWrites[store]++;
  tx(store, "readwrite", run)
    .then(() => channel?.postMessage(store))
    .catch((err) => console.error("Could not save to IndexedDB", err))
    .finally(() => {
      pendingWrites[store]--;
      if (pendingWrites[store] === 0 && reloadWanted.delete(store)) void reloadStore(store);
    });
}

export function saveItem<K extends StoreName>(store: K, item: Collections[K][number]) {
  const list = state[store] as { id: string }[];
  const i = list.findIndex((x) => x.id === item.id);
  const next = i >= 0 ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
  state = { ...state, [store]: next };
  emit();
  persist(store, (os) => void os.put(item));
}

export function removeItem(store: StoreName, id: string) {
  state = { ...state, [store]: (state[store] as { id: string }[]).filter((x) => x.id !== id) };
  emit();
  persist(store, (os) => void os.delete(id));
}

export function replaceCollection<K extends StoreName>(store: K, items: Collections[K]) {
  state = { ...state, [store]: items };
  emit();
  persist(store, (os) => {
    os.clear();
    for (const it of items) os.put(it);
  });
}

export function clearAllData() {
  for (const s of STORES) replaceCollection(s, []);
}

export function exportData(): string {
  const out: Record<string, unknown> = { app: "almanac-calendar", version: 1, exportedAt: new Date().toISOString(), settings: getSettings() };
  for (const s of STORES) out[s] = state[s];
  return JSON.stringify(out, null, 2);
}

// ── backup files ─────────────────────────────────────────────────────────────
// A backup is only ever applied after every part of it has been checked. Records are rebuilt
// field by field, so a key this app does not know (for example anything trying to configure
// the fixed office-Saturday schedule) is never copied into storage.

export interface Backup {
  exportedAt: string | null;
  /** only the collections the file contains */
  collections: Partial<Collections>;
  /** only the settings the file contains, each one validated; null when it has none */
  settings: Partial<Settings> | null;
  counts: Record<StoreName, number>;
  total: number;
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const httpUrl = (v: string) => /^https?:\/\/[^\s]+$/i.test(v);

/** Typed, checked access to the fields of one object from the file. */
function fields(o: Obj, where: string) {
  const fail = (k: string, want: string): never => {
    throw new Error(`This backup can't be used: ${where} has a "${k}" that is not ${want}.`);
  };
  const has = (k: string) => o[k] !== undefined && o[k] !== null;
  const str = (k: string, max = 10000): string => {
    const v = o[k];
    return typeof v === "string" && v.length <= max ? v : fail(k, `text of at most ${max} characters`);
  };
  const num = (k: string, min = -Infinity, max = Infinity): number => {
    const v = o[k];
    return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fail(k, min === -Infinity ? "a number" : `a number from ${min} to ${max}`);
  };
  const int = (k: string, min: number, max: number): number => {
    const v = o[k];
    return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fail(k, `a whole number from ${min} to ${max}`);
  };
  const bool = (k: string): boolean => {
    const v = o[k];
    return typeof v === "boolean" ? v : fail(k, "true or false");
  };
  const oneOf = <T extends string | number>(k: string, list: readonly T[]): T => {
    const v = o[k];
    return list.includes(v as T) ? (v as T) : fail(k, `one of ${list.join(", ")}`);
  };
  const date = (k: string): Ymd => {
    const v = o[k];
    return typeof v === "string" && isValidYmd(v) ? v : fail(k, "a date written YYYY-MM-DD");
  };
  const time = (k: string): string => {
    const v = o[k];
    return typeof v === "string" && HHMM.test(v) ? v : fail(k, "a time written HH:MM");
  };
  const dates = (k: string): Ymd[] => {
    const v = o[k];
    return Array.isArray(v) && v.length <= 5000 && v.every((x) => typeof x === "string" && isValidYmd(x)) ? (v as Ymd[]) : fail(k, "a list of dates written YYYY-MM-DD");
  };
  const obj = (k: string): Obj => {
    const v = o[k];
    return isObj(v) ? v : fail(k, "a group of values");
  };
  const opt = <T>(k: string, read: (k: string) => T): T | undefined => (has(k) ? read(k) : undefined);
  return { fail, has, str, num, int, bool, oneOf, date, time, dates, obj, opt };
}
type Fields = ReturnType<typeof fields>;
/** Drops keys whose value is undefined, so a restored record looks exactly like a saved one. */
const compact = <T extends object>(x: T): T => {
  for (const k of Object.keys(x) as (keyof T)[]) if (x[k] === undefined) delete x[k];
  return x;
};
const text = (f: Fields, k: string, max = 10000) => f.opt(k, (x) => f.str(x, max));
const anyNum = (f: Fields, k: string) => f.opt(k, (x) => f.num(x));
/** A time field that the forms may have left empty. */
const optTime = (f: Fields, o: Obj, k: string) => (o[k] === "" ? undefined : f.opt(k, f.time));

function readRecurrence(v: unknown, where: string): Recurrence {
  if (!isObj(v)) throw new Error(`This backup can't be used: ${where} has no valid "recurrence".`);
  const f = fields(v, `${where} (recurrence)`);
  const weekdays = f.opt("weekdays", (k) => {
    const w = v[k];
    return Array.isArray(w) && w.length <= 7 && w.every((n) => Number.isInteger(n) && n >= 0 && n <= 6) ? (w as number[]) : f.fail(k, "a list of weekdays 0 to 6");
  });
  return compact<Recurrence>({
    freq: f.oneOf("freq", ["none", "daily", "weekly", "monthly", "yearly", "custom"] as const),
    interval: f.opt("interval", (k) => f.int(k, 1, 1000)),
    unit: f.opt("unit", (k) => f.oneOf(k, ["day", "week", "month", "year"] as const)),
    weekdays,
    until: f.opt("until", f.date),
  });
}

const RECORD: { [K in StoreName]: (o: Obj, where: string) => Collections[K][number] } = {
  tasks: (o, w) => {
    const f = fields(o, w);
    return compact<Task>({
      id: f.str("id", 100), title: f.str("title", 2000), description: text(f, "description"), notes: text(f, "notes"),
      startDate: f.opt("startDate", f.date), dueDate: f.date("dueDate"), allDay: f.bool("allDay"), startTime: optTime(f, o, "startTime"), endTime: optTime(f, o, "endTime"),
      priority: f.oneOf("priority", ["high", "medium", "low"] as const), category: f.str("category", 100), status: f.oneOf("status", ["todo", "in_progress", "done"] as const),
      recurrence: readRecurrence(o.recurrence, w), doneDates: f.dates("doneDates"), createdAt: f.num("createdAt"), completedAt: anyNum(f, "completedAt"),
    });
  },
  reminders: (o, w) => {
    const f = fields(o, w);
    return { id: f.str("id", 100), message: f.str("message", 2000), date: f.date("date"), time: f.time("time"), lead: f.int("lead", 0, 525600), recurrence: readRecurrence(o.recurrence, w), done: f.bool("done"), doneDates: f.dates("doneDates"), fired: f.dates("fired"), createdAt: f.num("createdAt") };
  },
  events: (o, w) => {
    const f = fields(o, w);
    return compact<CalEvent>({
      id: f.str("id", 100), title: f.str("title", 2000), description: text(f, "description"), date: f.date("date"), allDay: f.bool("allDay"),
      startTime: optTime(f, o, "startTime"), endTime: optTime(f, o, "endTime"), category: f.str("category", 100), recurrence: readRecurrence(o.recurrence, w), createdAt: f.num("createdAt"),
    });
  },
  notes: (o, w) => {
    const f = fields(o, w);
    return { id: f.date("id"), content: f.str("content", 20000), updatedAt: f.num("updatedAt") };
  },
  moods: (o, w) => {
    const f = fields(o, w);
    return compact<Mood>({ id: f.date("id"), mood: f.oneOf("mood", ["happy", "neutral", "sad"] as const), note: text(f, "note") });
  },
  birthdays: (o, w) => {
    const f = fields(o, w);
    return compact<Birthday>({ id: f.str("id", 100), name: f.str("name", 500), month: f.int("month", 1, 12), day: f.int("day", 1, 31), year: f.opt("year", (k) => f.int(k, 1, 9999)), notes: text(f, "notes") });
  },
  notifications: (o, w) => {
    const f = fields(o, w);
    return compact<AppNotification>({ id: f.str("id", 100), title: f.str("title", 2000), body: f.str("body"), at: f.num("at"), read: f.bool("read"), dateKey: f.opt("dateKey", f.date) });
  },
  bookmarks: (o, w) => {
    const f = fields(o, w);
    const link = f.str("link", 4000);
    if (!httpUrl(link)) f.fail("link", "a web address starting with http:// or https://");
    const image = text(f, "image", 4000);
    return compact<Bookmark>({
      id: f.str("id", 200), link, title: f.str("title", 2000), source: f.str("source", 500), pubDate: f.has("pubDate") ? f.str("pubDate", 100) : null, summary: f.str("summary", 50000),
      image: image && httpUrl(image) ? image : undefined, // a picture that is not a plain web address is left out
      category: text(f, "category", 100), savedAt: f.num("savedAt"),
    });
  },
};
const STORE_LABEL: Record<StoreName, string> = { tasks: "task", reminders: "reminder", events: "event", notes: "note", moods: "mood", birthdays: "birthday", notifications: "notification", bookmarks: "saved article" };
const VIEWS: readonly ViewName[] = ["month", "week", "day", "year", "agenda", "upcoming"];
const SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];

/** The known switches of a group; anything else in the file is ignored, anything not true/false is refused. */
function readFlags(o: Obj, known: Record<string, boolean>, where: string): Record<string, boolean> {
  const f = fields(o, where);
  const out: Record<string, boolean> = {};
  for (const k of Object.keys(known)) if (f.has(k)) out[k] = f.bool(k);
  return out;
}
function readPlace(o: Obj, where: string): Place {
  const f = fields(o, where);
  const tz = f.str("tz", 100);
  if (!validTz(tz)) f.fail("tz", "a known time zone");
  return compact<Place>({ name: f.str("name", 300), lat: f.num("lat", -90, 90), lon: f.num("lon", -180, 180), tz, city: text(f, "city", 300), region: text(f, "region", 300), country: text(f, "country", 300), countryCode: text(f, "countryCode", 3) });
}

/**
 * Checks the settings block of a backup. Returns only settings this app has, each with a valid
 * value; unknown keys are ignored and a known key with a wrong value refuses the whole file.
 */
export function validateSettings(raw: unknown): Partial<Settings> {
  if (!isObj(raw)) throw new Error("This backup can't be used: its settings are not a group of values.");
  const f = fields(raw, "settings");
  const out: Partial<Settings> = {};
  if (f.has("theme")) out.theme = f.oneOf("theme", ["system", "light", "dark"] as const);
  if (f.has("weekStartsOn")) out.weekStartsOn = f.oneOf("weekStartsOn", [0, 1] as const);
  if (f.has("hour12")) out.hour12 = f.bool("hour12");
  if (f.has("tempUnit")) out.tempUnit = f.oneOf("tempUnit", ["C", "F"] as const);
  if (f.has("defaultView")) out.defaultView = f.oneOf("defaultView", VIEWS);
  if (f.has("location")) out.location = readPlace(f.obj("location"), "settings (location)");
  if (f.has("locationSource")) out.locationSource = f.oneOf("locationSource", ["default", "gps", "network", "manual"] as const);
  if (raw.locationUpdatedAt === null) out.locationUpdatedAt = null;
  else if (f.has("locationUpdatedAt")) out.locationUpdatedAt = f.num("locationUpdatedAt", 0, 8.64e15);
  if (f.has("locationPrompted")) out.locationPrompted = f.bool("locationPrompted");
  if (f.has("categories")) out.categories = { ...DEFAULT_SETTINGS.categories, ...readFlags(f.obj("categories"), DEFAULT_SETTINGS.categories, "settings (categories)") };
  if (f.has("layers")) out.layers = { ...DEFAULT_SETTINGS.layers, ...readFlags(f.obj("layers"), DEFAULT_SETTINGS.layers, "settings (layers)") };
  if (f.has("widgets")) out.widgets = { ...DEFAULT_SETTINGS.widgets, ...readFlags(f.obj("widgets"), DEFAULT_SETTINGS.widgets, "settings (widgets)") };
  if (f.has("salaryDay")) out.salaryDay = f.int("salaryDay", 1, 31);
  if (raw.zodiac === null) out.zodiac = null;
  else if (f.has("zodiac")) out.zodiac = f.oneOf("zodiac", SIGNS);
  if (f.has("notify")) {
    const g = fields(f.obj("notify"), "settings (notify)");
    const d = DEFAULT_SETTINGS.notify;
    out.notify = {
      salary: g.opt("salary", g.bool) ?? d.salary, birthday: g.opt("birthday", g.bool) ?? d.birthday, events: g.opt("events", g.bool) ?? d.events,
      salaryTime: g.opt("salaryTime", g.time) ?? d.salaryTime, birthdayTime: g.opt("birthdayTime", g.time) ?? d.birthdayTime, eventTime: g.opt("eventTime", g.time) ?? d.eventTime,
      salaryLead: g.opt("salaryLead", (k) => g.int(k, 0, 7)) ?? d.salaryLead, birthdayLead: g.opt("birthdayLead", (k) => g.int(k, 0, 30)) ?? d.birthdayLead, eventLead: g.opt("eventLead", (k) => g.int(k, 0, 14)) ?? d.eventLead,
    };
  }
  if (f.has("customCategories")) {
    const v = raw.customCategories;
    if (!Array.isArray(v) || v.length > 100 || !v.every((c) => typeof c === "string" && c.trim().length > 0 && c.length <= 30)) f.fail("customCategories", "a list of short category names");
    out.customCategories = [...new Set((v as string[]).map((c) => c.trim()))];
  }
  if (f.has("sidebarCollapsed")) out.sidebarCollapsed = f.bool("sidebarCollapsed");
  if (f.has("worldClocks")) {
    const v = raw.worldClocks;
    if (!Array.isArray(v) || v.length > 200) f.fail("worldClocks", "a list of clocks");
    out.worldClocks = (v as unknown[]).map((c, i) => {
      const where = `settings (world clock ${i + 1})`;
      if (!isObj(c)) throw new Error(`This backup can't be used: ${where} is not a clock.`);
      const g = fields(c, where);
      const tz = g.str("tz", 100);
      if (!validTz(tz)) g.fail("tz", "a known time zone");
      return compact<WorldClock>({ tz, label: g.str("label", 200), lat: g.opt("lat", (k) => g.num(k, -90, 90)), lon: g.opt("lon", (k) => g.num(k, -180, 180)) });
    });
  }
  return out;
}

/** Reads and fully validates a backup file. Throws an Error with a message for the reader if anything is wrong; changes nothing. */
export function parseBackup(json: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("This file isn't a Holiday Hub backup: it could not be read as JSON.");
  }
  if (!isObj(data) || data.app !== "almanac-calendar") throw new Error("This file is not a Holiday Hub backup.");
  if (data.version !== 1) throw new Error("This backup was made by a version of Holiday Hub that this one can't read.");
  const collections: Partial<Collections> = {};
  const counts = zeroes();
  let total = 0;
  for (const s of STORES) {
    const list = data[s];
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw new Error(`This backup can't be used: its ${STORE_LABEL[s]}s are not a list.`);
    if (list.length > 20000) throw new Error(`This backup can't be used: it has too many ${STORE_LABEL[s]}s.`);
    const seen = new Set<string>();
    const rows = list.map((x: unknown, i: number) => {
      const where = `${STORE_LABEL[s]} ${i + 1}`;
      if (!isObj(x)) throw new Error(`This backup can't be used: ${where} is not a record.`);
      const row = RECORD[s](x, where);
      if (!row.id || seen.has(row.id)) throw new Error(`This backup can't be used: ${where} has a missing or repeated "id".`);
      seen.add(row.id);
      return row;
    });
    (collections as Record<string, unknown>)[s] = rows;
    counts[s] = rows.length;
    total += rows.length;
  }
  const settingsIn = data.settings === undefined || data.settings === null ? null : validateSettings(data.settings);
  if (!Object.keys(collections).length && !settingsIn) throw new Error("This backup is empty: it has no data and no settings.");
  return { exportedAt: typeof data.exportedAt === "string" && !Number.isNaN(Date.parse(data.exportedAt)) ? data.exportedAt : null, collections, settings: settingsIn, counts, total };
}

/** Applies a backup that parseBackup has already checked: each collection in it replaces the one here. */
export function applyBackup(b: Backup) {
  for (const s of STORES) {
    const rows = b.collections[s];
    if (rows) replaceCollection(s, rows as never);
  }
  if (b.settings && Object.keys(b.settings).length) updateSettings(b.settings);
}

export function importData(json: string): number {
  const b = parseBackup(json);
  applyBackup(b);
  return b.total;
}

export const getData = () => state;
export function useData(): DataState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

// ── settings (localStorage) ──────────────────────────────────────────────────
export type ViewName = "month" | "week" | "day" | "year" | "agenda" | "upcoming";
export interface Settings {
  theme: "system" | "light" | "dark";
  weekStartsOn: 0 | 1;
  hour12: boolean;
  tempUnit: "C" | "F";
  defaultView: ViewName;
  location: Place;
  /** how the active location was chosen — "default" means nobody has chosen yet */
  locationSource: "default" | "gps" | "network" | "manual";
  locationUpdatedAt: number | null;
  /** the first-visit location question has been shown */
  locationPrompted: boolean;
  /** holiday categories + "birthday" */
  categories: Record<string, boolean>;
  layers: { tasks: boolean; reminders: boolean; events: boolean; officeSaturday: boolean; bankSaturday: boolean; weather: boolean; salary: boolean; notes: boolean };
  salaryDay: number;
  zodiac: string | null;
  notify: {
    salary: boolean; birthday: boolean; events: boolean;
    salaryTime: string; birthdayTime: string; eventTime: string;
    salaryLead: number; birthdayLead: number; eventLead: number;
  };
  widgets: Record<string, boolean>;
  customCategories: string[];
  sidebarCollapsed: boolean;
  worldClocks: WorldClock[];
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  weekStartsOn: 0,
  hour12: true,
  tempUnit: "C",
  defaultView: "month",
  location: CHENNAI,
  locationSource: "default",
  locationUpdatedAt: null,
  locationPrompted: false,
  categories: { international: true, india: true, tamilnadu: true, us: true, birthday: true, bank_govt: true, bank_private: true },
  layers: { tasks: true, reminders: true, events: true, officeSaturday: true, bankSaturday: true, weather: true, salary: true, notes: true },
  salaryDay: 5,
  zodiac: null,
  notify: { salary: true, birthday: true, events: true, salaryTime: "09:00", birthdayTime: "09:00", eventTime: "09:00", salaryLead: 1, birthdayLead: 7, eventLead: 0 },
  widgets: { quote: true, salary: true, weather: true, zodiac: true, news: true, panchangam: true, stats: true, worldclock: true },
  customCategories: [],
  sidebarCollapsed: false,
  worldClocks: DEFAULT_CLOCKS,
};

const SETTINGS_KEY = "almanac.settings.v1";
function readSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (raw && typeof raw === "object") {
      return {
        ...DEFAULT_SETTINGS,
        ...raw,
        categories: { ...DEFAULT_SETTINGS.categories, ...raw.categories },
        layers: { ...DEFAULT_SETTINGS.layers, ...raw.layers },
        notify: { ...DEFAULT_SETTINGS.notify, ...raw.notify },
        widgets: { ...DEFAULT_SETTINGS.widgets, ...raw.widgets },
        location: raw.location && typeof raw.location.lat === "number" ? raw.location : DEFAULT_SETTINGS.location,
        // clocks saved before coordinates existed pick them up from the built-in list
        worldClocks: Array.isArray(raw.worldClocks)
          ? raw.worldClocks.filter((c: WorldClock) => c && typeof c.tz === "string").map((c: WorldClock) => (c.lat == null ? { ...c, ...(DEFAULT_CLOCKS.find((d) => d.tz === c.tz && d.label === c.label) || {}) } : c))
          : DEFAULT_SETTINGS.worldClocks,
      };
    }
  } catch {
    /* unreadable → defaults */
  }
  return DEFAULT_SETTINGS;
}

let settings: Settings = typeof localStorage !== "undefined" ? readSettings() : DEFAULT_SETTINGS;
const settingsListeners = new Set<() => void>();

export const getSettings = () => settings;
export function updateSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage full or blocked — the setting still applies for this visit */
  }
  settingsListeners.forEach((l) => l());
}
/** Back to the defaults exactly — nothing left over from what was stored before. */
export function resetSettings() {
  settings = DEFAULT_SETTINGS;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage full or blocked — the reset still applies for this visit */
  }
  settingsListeners.forEach((l) => l());
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === SETTINGS_KEY) {
      settings = readSettings();
      settingsListeners.forEach((l) => l());
    }
  });
}
export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      settingsListeners.add(cb);
      return () => settingsListeners.delete(cb);
    },
    () => settings,
  );
}

export const TASK_CATEGORIES = ["Personal", "Office", "Meetings", "Important", "Family", "Travel", "Health", "Other"];
export const allCategories = (s: Settings) => [...TASK_CATEGORIES, ...s.customCategories.filter((c) => !TASK_CATEGORIES.includes(c))];

/** Small JSON cache in localStorage for API responses. */
export function cacheGet<T>(key: string, maxAgeMs: number): { value: T; at: number; fresh: boolean } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "null");
    if (raw && typeof raw.at === "number") return { value: raw.value as T, at: raw.at, fresh: Date.now() - raw.at < maxAgeMs };
  } catch {
    /* ignore */
  }
  return null;
}
export function cacheSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* ignore */
  }
}
