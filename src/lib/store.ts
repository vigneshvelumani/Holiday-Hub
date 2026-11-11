// Local-only persistence. Structured records live in IndexedDB, lightweight
// preferences in localStorage. Nothing is sent to a server and nothing expires:
// data stays until the visitor clears this site's browser data.

import { useSyncExternalStore } from "react";
import type { Recurrence } from "./recurrence.ts";
import type { Ymd } from "./dates.ts";
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
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("almanac-calendar") : null;

async function loadAll(): Promise<void> {
  try {
    const next: Partial<Collections> = {};
    for (const s of STORES) (next as Record<string, unknown>)[s] = (await tx(s, "readonly", (os) => os.getAll())) || [];
    state = { ...state, ...(next as Collections), ready: true, backend: "indexeddb" };
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
  // keep several open tabs in step
  channel?.addEventListener("message", () => void loadAll());
  // ask the browser not to evict this site's data under storage pressure
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}

function persist(store: StoreName, run: (s: IDBObjectStore) => void) {
  if (state.backend !== "indexeddb") return;
  tx(store, "readwrite", run)
    .then(() => channel?.postMessage(store))
    .catch((err) => console.error("Could not save to IndexedDB", err));
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

export function importData(json: string): number {
  const data = JSON.parse(json);
  if (!data || data.app !== "almanac-calendar") throw new Error("This file is not a calendar backup.");
  let n = 0;
  for (const s of STORES) {
    if (Array.isArray(data[s])) {
      const valid = data[s].filter((x: unknown) => x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string");
      replaceCollection(s, valid);
      n += valid.length;
    }
  }
  if (data.settings && typeof data.settings === "object") updateSettings(data.settings);
  return n;
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
  locationSource: "default" | "gps" | "manual";
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
export function resetSettings() {
  updateSettings(DEFAULT_SETTINGS);
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
