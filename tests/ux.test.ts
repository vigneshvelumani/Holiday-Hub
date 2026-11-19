// UX-logic checks: `npm test` (Node ≥ 22.18 runs TypeScript directly).
// Covers the backup validator, clearing data, and "today at the chosen location".
import { DEFAULT_SETTINGS, applyBackup, clearAllData, exportData, getData, getSettings, parseBackup, resetSettings, saveItem, updateSettings, validateSettings, type Reminder, type Task } from "../src/lib/store.ts";
import { keyDayDiff, placeToday, relPlaceDays } from "../src/lib/placeDate.ts";

let pass = 0;
let fail = 0;
/** JSON with object keys in a fixed order, so two records with the same fields compare equal. */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
function eq(label: string, got: unknown, want: unknown) {
  if (canon(got) === canon(want)) pass++;
  else {
    fail++;
    console.log(`FAIL ${label}: got ${canon(got)}, want ${canon(want)}`);
  }
}
/** The message a call throws, or null when it does not throw. */
function thrown(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
function rejects(label: string, json: string, mention?: RegExp) {
  const msg = thrown(() => parseBackup(json));
  if (msg && (!mention || mention.test(msg))) pass++;
  else {
    fail++;
    console.log(`FAIL ${label}: ${msg === null ? "was accepted" : `message was "${msg}"`}`);
  }
}

// ── a real export round-trips ──
const task: Task = { id: "t1", title: "File the report", dueDate: "2026-11-20", startDate: "2026-11-20", allDay: false, startTime: "09:30", endTime: "10:00", priority: "high", category: "Office", status: "todo", recurrence: { freq: "weekly", weekdays: [1, 3] }, doneDates: ["2026-11-13"], createdAt: 1794000000000 };
const reminder: Reminder = { id: "r1", message: "Call home", date: "2026-11-19", time: "18:00", lead: 15, recurrence: { freq: "none" }, done: false, doneDates: [], fired: [], createdAt: 1794000000001 };
saveItem("tasks", task);
saveItem("reminders", reminder);
saveItem("notes", { id: "2026-11-18", content: "A note", updatedAt: 1794000000002 });
saveItem("moods", { id: "2026-11-18", mood: "happy" });
saveItem("birthdays", { id: "b1", name: "Asha", month: 2, day: 29, year: 1992 });
saveItem("events", { id: "e1", title: "Review", date: "2026-12-01", allDay: true, category: "Meetings", recurrence: { freq: "custom", interval: 2, unit: "week", until: "2027-01-31" }, createdAt: 1794000000003 });
saveItem("notifications", { id: "n1", title: "Reminder", body: "Call home", at: 1794000000004, read: false, dateKey: "2026-11-19" });
saveItem("bookmarks", { id: "abc123", link: "https://example.org/story", title: "A story", source: "Example", pubDate: null, summary: "", savedAt: 1794000000005 });
updateSettings({ theme: "dark", salaryDay: 28, customCategories: ["Garden"], zodiac: "Leo" });

const exported = exportData();
const back = parseBackup(exported);
const original = JSON.parse(exported);
eq("export → import keeps every task", back.collections.tasks, original.tasks);
eq("export → import keeps every reminder", back.collections.reminders, original.reminders);
eq("export → import keeps every event", back.collections.events, original.events);
eq("export → import keeps notes", back.collections.notes, original.notes);
eq("export → import keeps moods", back.collections.moods, original.moods);
eq("export → import keeps birthdays", back.collections.birthdays, original.birthdays);
eq("export → import keeps notifications", back.collections.notifications, original.notifications);
eq("export → import keeps bookmarks", back.collections.bookmarks, original.bookmarks);
eq("export → import keeps settings", back.settings, original.settings);
eq("export → import counts records", back.total, 8);
eq("export → import reads the export time", back.exportedAt, original.exportedAt);

// ── clearing and restoring ──
clearAllData();
eq("clear all data empties every collection", [getData().tasks.length, getData().reminders.length, getData().events.length, getData().notes.length, getData().moods.length, getData().birthdays.length, getData().notifications.length, getData().bookmarks.length], [0, 0, 0, 0, 0, 0, 0, 0]);
eq("clear all data keeps settings", getSettings().salaryDay, 28);
resetSettings();
eq("reset settings returns to the defaults", getSettings(), DEFAULT_SETTINGS);
applyBackup(back);
eq("applying a backup restores the task", getData().tasks, [task]);
eq("applying a backup restores the reminder", getData().reminders, [reminder]);
eq("applying a backup restores settings", [getSettings().theme, getSettings().salaryDay, getSettings().customCategories, getSettings().zodiac], ["dark", 28, ["Garden"], "Leo"]);

// ── malformed input is refused, and refusing changes nothing ──
const base = () => JSON.parse(exported);
const withTask = (patch: Record<string, unknown>) => {
  const d = base();
  d.tasks = [{ ...d.tasks[0], ...patch }];
  return JSON.stringify(d);
};
const withSettings = (patch: Record<string, unknown>) => {
  const d = base();
  d.settings = { ...d.settings, ...patch };
  return JSON.stringify(d);
};
rejects("not JSON", "{ nope", /JSON/);
rejects("JSON that is not an object", "[1, 2, 3]");
rejects("null", "null");
rejects("another app's file", JSON.stringify({ app: "something-else", version: 1, tasks: [] }), /not a Holiday Hub backup/);
rejects("unknown version", JSON.stringify({ app: "almanac-calendar", version: 2, tasks: [] }), /version/);
rejects("no data and no settings", JSON.stringify({ app: "almanac-calendar", version: 1 }), /empty/);
rejects("a collection that is not a list", JSON.stringify({ app: "almanac-calendar", version: 1, tasks: { id: "x" } }), /not a list/);
rejects("a record that is not an object", JSON.stringify({ app: "almanac-calendar", version: 1, tasks: ["x"] }), /task 1/);
rejects("task without an id", withTask({ id: undefined }), /"id"/);
rejects("task with a numeric id", withTask({ id: 7 }));
rejects("task with an impossible date", withTask({ dueDate: "2026-02-30" }), /dueDate/);
rejects("task with a bad time", withTask({ startTime: "25:00" }), /startTime/);
rejects("task with an unknown priority", withTask({ priority: "urgent" }), /priority/);
rejects("task with an unknown status", withTask({ status: "archived" }));
rejects("task with a bad recurrence", withTask({ recurrence: { freq: "hourly" } }), /recurrence/);
rejects("task with no recurrence", withTask({ recurrence: null }), /recurrence/);
rejects("task whose title is not text", withTask({ title: { toString: "x" } }), /title/);
rejects("task with non-date doneDates", withTask({ doneDates: ["soon"] }));
rejects("repeated ids", JSON.stringify({ ...base(), tasks: [base().tasks[0], base().tasks[0]] }), /repeated/);
rejects("bookmark with a script link", JSON.stringify({ ...base(), bookmarks: [{ ...base().bookmarks[0], link: "javascript:alert(1)" }] }), /link/);
rejects("mood that is not one of the three", JSON.stringify({ ...base(), moods: [{ id: "2026-11-18", mood: "ecstatic" }] }));
rejects("birthday on month 13", JSON.stringify({ ...base(), birthdays: [{ id: "b", name: "X", month: 13, day: 1 }] }), /month/);
rejects("settings that are not an object", JSON.stringify({ ...base(), settings: "dark" }), /settings/);
rejects("settings: unknown theme", withSettings({ theme: "neon" }), /theme/);
rejects("settings: salary day 40", withSettings({ salaryDay: 40 }), /salaryDay/);
rejects("settings: salary day as text", withSettings({ salaryDay: "5" }));
rejects("settings: week start 3", withSettings({ weekStartsOn: 3 }));
rejects("settings: location without coordinates", withSettings({ location: { name: "Nowhere", tz: "Asia/Kolkata" } }), /lat/);
rejects("settings: location with an unknown zone", withSettings({ location: { name: "X", lat: 1, lon: 1, tz: "Mars/Olympus" } }), /time zone/);
rejects("settings: location off the globe", withSettings({ location: { name: "X", lat: 91, lon: 0, tz: "UTC" } }));
rejects("settings: layer switch that is not true/false", withSettings({ layers: { tasks: "yes" } }));
rejects("settings: alert time that is not a time", withSettings({ notify: { salaryTime: "9am" } }));
rejects("settings: world clock with a bad zone", withSettings({ worldClocks: [{ tz: "Nope/Zone", label: "X" }] }));
rejects("settings: categories that are not names", withSettings({ customCategories: [1, 2] }));
rejects("settings: unknown zodiac sign", withSettings({ zodiac: "Ophiuchus" }));
eq("a refused file leaves the data alone", getData().tasks, [task]);
eq("a refused file leaves the settings alone", getSettings().salaryDay, 28);

// ── unknown keys never get in ──
const sneaky = base();
sneaky.tasks[0].isAdmin = true;
sneaky.tasks[0].__proto__ = { polluted: true };
sneaky.somethingElse = [{ id: "x" }];
sneaky.settings.officeSaturday = "off";
sneaky.settings.officeSaturdayReference = { year: 2026, month: 11, day: 21, status: "working" };
sneaky.settings.saturdayOverride = { "2026-11-14": "off" };
sneaky.settings.OFFICE_SATURDAY_REFERENCE = { year: 2026, month: 11, day: 21, status: "working" };
sneaky.settings.layers.secret = true;
sneaky.settings.widgets.tracker = true;
sneaky.settings.categories.made_up = true;
sneaky.settings.notify.extra = "x";
sneaky.settings.location.note = "x";
const clean = parseBackup(JSON.stringify(sneaky));
eq("unknown record keys are dropped", Object.keys(clean.collections.tasks![0]).sort(), Object.keys(task).sort());
eq("unknown collections are ignored", "somethingElse" in clean.collections, false);
eq("unknown settings keys are dropped", Object.keys(clean.settings!).filter((k) => !(k in DEFAULT_SETTINGS)), []);
eq("no Saturday key survives validation", Object.keys(clean.settings!).filter((k) => /saturday/i.test(k)), []);
eq("unknown layer is dropped", "secret" in clean.settings!.layers!, false);
eq("unknown widget is dropped", "tracker" in clean.settings!.widgets!, false);
eq("unknown category is dropped", "made_up" in clean.settings!.categories!, false);
eq("unknown notify key is dropped", "extra" in clean.settings!.notify!, false);
eq("unknown location key is dropped", "note" in clean.settings!.location!, false);
resetSettings();
applyBackup(clean);
eq("applying it stores no Saturday setting", Object.keys(getSettings()).filter((k) => /saturday/i.test(k)), []);
eq("applying it stores only known settings", Object.keys(getSettings()).sort(), Object.keys(DEFAULT_SETTINGS).sort());
eq("the office-Saturday layer stays a plain on/off display switch", typeof getSettings().layers.officeSaturday, "boolean");
eq("validateSettings on only-unknown keys returns nothing", validateSettings({ officeSaturday: "off", foo: 1 }), {});
eq("a settings-only backup is accepted", parseBackup(JSON.stringify({ app: "almanac-calendar", version: 1, settings: { theme: "light" } })).settings, { theme: "light" });
eq("a partial backup only carries what it has", Object.keys(parseBackup(JSON.stringify({ app: "almanac-calendar", version: 1, notes: [] })).collections), ["notes"]);
eq("an empty time from a form is treated as no time", "startTime" in parseBackup(withTask({ startTime: "" })).collections.tasks![0], false);

// ── today at the chosen location ──
// 18 Nov 2026, 05:30 in India is still 17 Nov in Honolulu, and already 18 Nov in Tokyo
const morningIST = new Date(Date.UTC(2026, 10, 18, 0, 0)); // 05:30 IST
eq("today in Chennai", placeToday("Asia/Kolkata", morningIST), "2026-11-18");
eq("today in Honolulu is still yesterday", placeToday("Pacific/Honolulu", morningIST), "2026-11-17");
eq("today in Tokyo", placeToday("Asia/Tokyo", morningIST), "2026-11-18");
const eveningIST = new Date(Date.UTC(2026, 10, 18, 16, 0)); // 21:30 IST
eq("today in Auckland is already tomorrow", placeToday("Pacific/Auckland", eveningIST), "2026-11-19");
eq("today in UTC", placeToday("UTC", eveningIST), "2026-11-18");
eq("year rollover at the place", placeToday("Pacific/Kiritimati", new Date(Date.UTC(2026, 11, 31, 11, 0))), "2027-01-01");
eq("leap day at the place", placeToday("Asia/Kolkata", new Date(Date.UTC(2028, 1, 28, 20, 0))), "2028-02-29");
const deviceKey = `${String(eveningIST.getFullYear()).padStart(4, "0")}-${String(eveningIST.getMonth() + 1).padStart(2, "0")}-${String(eveningIST.getDate()).padStart(2, "0")}`;
eq("an unknown zone falls back to the device's date", placeToday("Not/AZone", eveningIST), deviceKey);
eq("day difference forwards", keyDayDiff("2026-11-17", "2026-11-18"), 1);
eq("day difference backwards", keyDayDiff("2026-11-18", "2026-11-17"), -1);
eq("day difference across a leap day", keyDayDiff("2028-02-28", "2028-03-01"), 2);
eq("day difference across a year", keyDayDiff("2026-12-31", "2027-01-01"), 1);
eq("the place's today reads Today", relPlaceDays("2026-11-17", placeToday("Pacific/Honolulu", morningIST)), "Today");
eq("the device's date is Tomorrow there", relPlaceDays("2026-11-18", placeToday("Pacific/Honolulu", morningIST)), "Tomorrow");
eq("yesterday", relPlaceDays("2026-11-16", "2026-11-17"), "Yesterday");
eq("days ahead", relPlaceDays("2026-11-27", "2026-11-17"), "in 10 days");
eq("days ago", relPlaceDays("2026-11-07", "2026-11-17"), "10 days ago");

console.log(`\nux: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
